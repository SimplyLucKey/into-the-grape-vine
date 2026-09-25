"""FastAPI server for browser extension to sync data to Dropbox.

Provides HTTP endpoints that the extension can call instead of
accessing Dropbox directly. This keeps credentials secure in Python.

Usage:
    uv run python server.py
"""

from __future__ import annotations

import logging
from datetime import datetime

import dropbox
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from openpyxl.workbook import Workbook
from openpyxl.worksheet.worksheet import Worksheet
from pydantic import BaseModel

from dropbox_upsert import (
    INVENTORY_SHEET,
    _COL_DELIVERED_DATE,
    _COL_NAME,
    _COL_ORDER_DATE,
    _COL_PRICE,
    _COL_URL,
    append_orders_to_sheet,
    build_new_rows,
    extract_asin,
    get_existing_asins,
)
from dropbox_utils import download_workbook, get_client, upload_workbook

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

app = FastAPI(title="Into the Grape Vine API")

# Allow extension to call this server from browser
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Extension can call from any page
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class VineOrder(BaseModel):
    """Vine order data from extension."""

    asin: str | None
    name: str | None
    url: str | None
    thumbnail: str | None
    fmv: float | None
    order_date: str | None
    order_timestamp: int | None
    order_id: str | None
    captured_at: str


class AccountOrder(BaseModel):
    """Account order data from extension."""

    asin: str | None
    name: str | None
    url: str | None
    order_id: str | None
    delivery_status: str
    delivery_date: str | None
    delivery_date_parsed: str | None
    captured_at: str


class SyncRequest(BaseModel):
    """Request body for sync endpoint."""

    account_orders: list[AccountOrder]


class SyncVineOrdersRequest(BaseModel):
    """Request body for sync-vine-orders endpoint."""

    vine_orders: list[VineOrder]


class SyncVineOrdersResponse(BaseModel):
    """Response from sync-vine-orders endpoint."""

    success: bool
    added: int
    skipped: int
    dry_run: bool = False
    new_items: list[dict[str, str]] = []


class SyncResponse(BaseModel):
    """Response from sync endpoint."""

    success: bool
    filled: int
    cancelled: int
    cancelled_items: list[dict[str, str]]
    dry_run: bool = False
    changes: list[dict[str, str]] = []


def parse_delivery_date(order: AccountOrder) -> str | None:
    """Parse delivery date from account order, returning M/D/YYYY string."""
    if not order.delivery_date_parsed:
        return None

    dt = datetime.fromisoformat(order.delivery_date_parsed.replace("Z", "+00:00"))
    return dt.strftime("%-m/%-d/%Y")


def sync_delivery_dates_to_sheet(
    sheet: Worksheet,
    account_orders: list[AccountOrder],
    dry_run: bool = False,
) -> tuple[int, int, list[dict[str, str]], list[dict[str, str]]]:
    """Update blank delivered_date cells based on account orders.

    Args:
        sheet: The openpyxl inventory worksheet.
        account_orders: List of account orders from extension.
        dry_run: If True, don't actually modify the sheet, just report what would change.

    Returns:
        Tuple of (filled_count, cancelled_count, cancelled_items, changes).
    """
    # Index by ASIN for fast lookup
    orders_by_asin: dict[str, AccountOrder] = {}
    for order in account_orders:
        if order.asin:
            orders_by_asin[order.asin] = order

    filled = 0
    cancelled = 0
    cancelled_items: list[dict[str, str]] = []
    changes: list[dict[str, str]] = []

    # Iterate through Excel rows (skip header at row 1)
    for row_idx in range(2, sheet.max_row + 1):
        delivered_cell = sheet.cell(row=row_idx, column=_COL_DELIVERED_DATE)
        if delivered_cell.value:
            # Already has a delivery date
            continue

        url = sheet.cell(row=row_idx, column=_COL_URL).value
        if not url or not isinstance(url, str):
            continue

        asin = extract_asin(url=url)
        if not asin or asin not in orders_by_asin:
            continue

        order = orders_by_asin[asin]
        name = sheet.cell(row=row_idx, column=_COL_NAME).value

        if order.delivery_status == "delivered":
            delivery_date = parse_delivery_date(order)
            if delivery_date:
                filled += 1
                changes.append(
                    {
                        "row": str(row_idx),
                        "asin": asin,
                        "action": f"fill delivery date: {delivery_date}",
                        "product": name or "Unknown",
                    }
                )

                if not dry_run:
                    sheet.cell(
                        row=row_idx, column=_COL_DELIVERED_DATE, value=delivery_date
                    )

                action = "Would fill" if dry_run else "Filled"
                product_name = (name[:40] + "...") if name and len(name) > 40 else name
                logger.info(
                    "  → Row %d | %s | %s | %s delivery date: %s",
                    row_idx,
                    asin,
                    product_name or "Unknown",
                    action,
                    delivery_date,
                )

        elif order.delivery_status == "cancelled":
            cancelled += 1
            cancelled_items.append({"asin": asin, "name": name or "Unknown"})
            changes.append(
                {
                    "row": str(row_idx),
                    "asin": asin,
                    "action": "mark as cancelled (manual deletion recommended)",
                    "product": name or "Unknown",
                }
            )
            log_msg = f"Row {row_idx} ({asin}): Order cancelled"
            logger.warning(log_msg)

    return filled, cancelled, cancelled_items, changes


@app.post("/sync-vine-orders", response_model=SyncVineOrdersResponse)
async def sync_vine_orders(
    request: SyncVineOrdersRequest, dry_run: bool = False
) -> SyncVineOrdersResponse:
    """Sync Vine orders to Dropbox Excel file.

    This endpoint:
    1. Downloads the Excel file from Dropbox
    2. Checks which ASINs are already present
    3. Appends new Vine orders (order_date, url, name, FMV)
    4. Uploads the updated file back to Dropbox (unless dry_run=true)

    Args:
        request: Contains list of Vine orders to sync
        dry_run: If True, only report what would change without modifying the file
    """
    try:
        logger.info(
            "Received %d Vine orders to sync (dry_run=%s)",
            len(request.vine_orders),
            dry_run,
        )

        # Get Dropbox client
        client: dropbox.Dropbox = get_client()
        account = client.users_get_current_account()
        logger.info("Connected to Dropbox as %s", account.name.display_name)

        # Download workbook
        import os

        file_path: str | None = os.getenv("DROPBOX_FILE_PATH")
        if not file_path:
            raise HTTPException(
                status_code=500, detail="DROPBOX_FILE_PATH not configured"
            )

        workbook = download_workbook(client=client, file_path=file_path)

        if INVENTORY_SHEET not in workbook.sheetnames:
            raise HTTPException(
                status_code=500,
                detail=f"Sheet '{INVENTORY_SHEET}' not found in workbook",
            )

        sheet: Worksheet = workbook[INVENTORY_SHEET]

        # Get existing ASINs
        existing_asins = get_existing_asins(sheet=sheet)
        logger.info("Found %d existing ASINs in inventory", len(existing_asins))

        # Convert Pydantic models to dicts for dropbox_upsert functions
        orders_dicts = [order.model_dump() for order in request.vine_orders]

        # Build new rows (filters out existing ASINs)
        new_rows = build_new_rows(orders=orders_dicts, existing_asins=existing_asins)
        skipped = len(orders_dicts) - len(new_rows)

        logger.info(
            "%d new orders to insert, %d already present (skipped)",
            len(new_rows),
            skipped,
        )

        # Log each new order to be added
        new_items = []
        for order in new_rows:
            asin = order.get("asin", "")
            name = order.get("name", "Unknown")
            order_date = order.get("order_date", "")
            fmv = order.get("fmv")

            logger.info(
                "  → Adding: %s | %s | FMV: $%.2f | Date: %s",
                asin,
                name[:50] + "..." if len(name) > 50 else name,
                fmv if fmv else 0,
                order_date,
            )

            new_items.append(
                {
                    "asin": asin,
                    "name": name,
                    "order_date": order_date,
                }
            )

        if len(new_rows) == 0:
            logger.info("No new orders to add")
            return SyncVineOrdersResponse(
                success=True,
                added=0,
                skipped=skipped,
                dry_run=dry_run,
                new_items=[],
            )

        # Append orders (unless dry run)
        if not dry_run:
            logger.info("Adding %d orders to spreadsheet...", len(new_rows))
            added = append_orders_to_sheet(sheet=sheet, orders=new_rows)
            logger.info("Uploading modified spreadsheet to Dropbox...")
            upload_workbook(client=client, workbook=workbook, file_path=file_path)
            logger.info("✓ Vine sync complete: %d orders added to inventory", added)
        else:
            added = len(new_rows)
            logger.info("✓ DRY RUN: Would add %d orders to inventory", added)

        return SyncVineOrdersResponse(
            success=True,
            added=added,
            skipped=skipped,
            dry_run=dry_run,
            new_items=new_items,
        )

    except Exception as e:
        logger.exception("Vine order sync failed")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/sync-delivery-dates", response_model=SyncResponse)
async def sync_delivery_dates(
    request: SyncRequest, dry_run: bool = False
) -> SyncResponse:
    """Sync delivery dates from account orders to Dropbox Excel file.

    This endpoint:
    1. Downloads the Excel file from Dropbox
    2. Matches account orders by ASIN
    3. Fills blank delivered_date cells for delivered items
    4. Uploads the updated file back to Dropbox (unless dry_run=true)

    Args:
        request: Contains list of account orders to sync
        dry_run: If True, only report what would change without modifying the file
    """
    try:
        logger.info(
            "Received %d account orders to sync (dry_run=%s)",
            len(request.account_orders),
            dry_run,
        )

        # Get Dropbox client
        client: dropbox.Dropbox = get_client()
        account = client.users_get_current_account()
        logger.info("Connected to Dropbox as %s", account.name.display_name)

        # Download workbook
        import os

        file_path: str | None = os.getenv("DROPBOX_FILE_PATH")
        if not file_path:
            raise HTTPException(
                status_code=500, detail="DROPBOX_FILE_PATH not configured"
            )

        workbook = download_workbook(client=client, file_path=file_path)

        if INVENTORY_SHEET not in workbook.sheetnames:
            raise HTTPException(
                status_code=500,
                detail=f"Sheet '{INVENTORY_SHEET}' not found in workbook",
            )

        sheet: Worksheet = workbook[INVENTORY_SHEET]

        # Sync delivery dates
        filled, cancelled, cancelled_items, changes = sync_delivery_dates_to_sheet(
            sheet=sheet,
            account_orders=request.account_orders,
            dry_run=dry_run,
        )

        if filled == 0 and cancelled == 0:
            logger.info("No updates needed")
            return SyncResponse(
                success=True,
                filled=0,
                cancelled=0,
                cancelled_items=[],
                dry_run=dry_run,
                changes=[],
            )

        # Upload updated workbook (unless dry run)
        if not dry_run:
            upload_workbook(client=client, workbook=workbook, file_path=file_path)
            logger.info("Sync complete: %d filled, %d cancelled", filled, cancelled)
        else:
            logger.info(
                "DRY RUN: Would fill %d, would mark %d as cancelled", filled, cancelled
            )

        return SyncResponse(
            success=True,
            filled=filled,
            cancelled=cancelled,
            cancelled_items=cancelled_items,
            dry_run=dry_run,
            changes=changes,
        )

    except Exception as e:
        logger.exception("Sync failed")
        raise HTTPException(status_code=500, detail=str(e))


def _open_inventory() -> tuple[dropbox.Dropbox, str, Workbook, Worksheet]:
    """Download the workbook and return (client, file_path, workbook, inventory sheet)."""
    import os

    file_path: str | None = os.getenv("DROPBOX_FILE_PATH")
    if not file_path:
        raise HTTPException(status_code=500, detail="DROPBOX_FILE_PATH not configured")

    client: dropbox.Dropbox = get_client()
    workbook = download_workbook(client=client, file_path=file_path)
    if INVENTORY_SHEET not in workbook.sheetnames:
        raise HTTPException(
            status_code=500, detail=f"Sheet '{INVENTORY_SHEET}' not found in workbook"
        )
    return client, file_path, workbook, workbook[INVENTORY_SHEET]


def _needs_price(sheet: Worksheet, row_idx: int) -> bool:
    """True if the price cell is blank. -1 is an old "failed" marker, so it counts as blank."""
    value = sheet.cell(row=row_idx, column=_COL_PRICE).value
    return value is None or value == -1


class PriceTarget(BaseModel):
    """A sheet row that needs a product price."""

    row: int
    asin: str
    name: str


class PriceTargetsResponse(BaseModel):
    """Response from price-targets endpoint."""

    targets: list[PriceTarget]


@app.post("/price-targets", response_model=PriceTargetsResponse)
async def price_targets(days_back: int = 14, max_items: int = 50) -> PriceTargetsResponse:
    """List rows with a blank price, ordered within the last days_back days."""
    try:
        from datetime import timedelta

        logger.info(
            "Finding rows that need prices (days_back=%d, max_items=%d)", days_back, max_items
        )
        _, _, _, sheet = _open_inventory()
        cutoff_date = datetime.now() - timedelta(days=days_back)

        targets: list[PriceTarget] = []
        for row_idx in range(2, sheet.max_row + 1):
            if not _needs_price(sheet, row_idx):
                continue

            order_date = sheet.cell(row=row_idx, column=_COL_ORDER_DATE).value
            if order_date:
                try:
                    if not isinstance(order_date, datetime):
                        order_date = datetime.strptime(str(order_date), "%m/%d/%Y")
                except ValueError:
                    logger.warning("Row %d: Could not parse order date", row_idx)
                    continue
                if order_date < cutoff_date:
                    continue

            url = sheet.cell(row=row_idx, column=_COL_URL).value
            asin = extract_asin(url=url) if isinstance(url, str) else None
            if not asin:
                continue

            name = sheet.cell(row=row_idx, column=_COL_NAME).value or "Unknown"
            targets.append(PriceTarget(row=row_idx, asin=asin, name=name))
            logger.info("  Row %d: %s - %s", row_idx, asin, name[:50])
            if len(targets) >= max_items:
                logger.info("Reached max_items limit (%d)", max_items)
                break

        logger.info("Found %d rows that need prices", len(targets))
        return PriceTargetsResponse(targets=targets)

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Finding price targets failed")
        raise HTTPException(status_code=500, detail=str(e))


class FoundPrice(BaseModel):
    """A price the extension read from a product page."""

    asin: str
    price: float


class SavePricesRequest(BaseModel):
    """Prices to write to the sheet."""

    prices: list[FoundPrice]


class SavePricesResponse(BaseModel):
    """Response from save-prices endpoint."""

    success: bool
    saved: int
    dry_run: bool = False


@app.post("/save-prices", response_model=SavePricesResponse)
async def save_prices(request: SavePricesRequest, dry_run: bool = False) -> SavePricesResponse:
    """Write prices to rows with a blank price, matched by ASIN. Uploads once, unless dry_run."""
    try:
        logger.info("Saving %d prices (dry_run=%s)", len(request.prices), dry_run)
        if not request.prices:
            return SavePricesResponse(success=True, saved=0, dry_run=dry_run)

        # Download again and match by ASIN, since rows can move between the two calls
        client, file_path, workbook, sheet = _open_inventory()
        price_by_asin = {p.asin: p.price for p in request.prices}

        saved = 0
        for row_idx in range(2, sheet.max_row + 1):
            url = sheet.cell(row=row_idx, column=_COL_URL).value
            asin = extract_asin(url=url) if isinstance(url, str) else None
            if asin not in price_by_asin or not _needs_price(sheet, row_idx):
                continue

            price = price_by_asin[asin]
            name = str(sheet.cell(row=row_idx, column=_COL_NAME).value or "Unknown")[:50]
            prefix = "DRY RUN - Would set" if dry_run else "Set"
            logger.info("%s row %d (%s - %s) to $%.2f", prefix, row_idx, asin, name, price)
            if not dry_run:
                sheet.cell(row=row_idx, column=_COL_PRICE, value=price)
            saved += 1

        if saved and not dry_run:
            upload_workbook(client=client, workbook=workbook, file_path=file_path)
        logger.info("Price save complete: %d rows%s", saved, " (dry run)" if dry_run else "")
        return SavePricesResponse(success=True, saved=saved, dry_run=dry_run)

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Saving prices failed")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
async def health_check() -> dict[str, str]:
    """Health check endpoint."""
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    logger.info("Starting server on http://localhost:8000")
    uvicorn.run(app, host="127.0.0.1", port=8000)
