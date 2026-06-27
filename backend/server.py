"""FastAPI server for browser extension to sync data to Dropbox.

Provides HTTP endpoints that the extension can call instead of
accessing Dropbox directly. This keeps credentials secure in Python.

Usage:
    uv run python server.py
"""

from __future__ import annotations

import logging
from typing import Any

import dropbox
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from openpyxl.worksheet.worksheet import Worksheet
from pydantic import BaseModel

from dropbox_upsert import (
    INVENTORY_SHEET,
    _COL_DELIVERED_DATE,
    _COL_NAME,
    _COL_ORDER_DATE,
    _COL_PRICE,
    _COL_URL,
    extract_asin,
)
from dropbox_utils import download_workbook, get_client, upload_workbook
from fetch_prices import fetch_multiple_prices

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


class SyncResponse(BaseModel):
    """Response from sync endpoint."""

    success: bool
    filled: int
    cancelled: int
    cancelled_items: list[dict[str, str]]
    dry_run: bool = False
    changes: list[dict[str, str]] = []


def parse_delivery_date(order: AccountOrder) -> Any:
    """Parse delivery date from account order."""
    if not order.delivery_date_parsed:
        return None
    from datetime import datetime

    return datetime.fromisoformat(order.delivery_date_parsed.replace("Z", "+00:00"))


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
                date_str = delivery_date.strftime("%Y-%m-%d")
                changes.append({
                    "row": str(row_idx),
                    "asin": asin,
                    "action": f"fill delivery date: {date_str}",
                    "product": name or "Unknown",
                })

                if not dry_run:
                    sheet.cell(row=row_idx, column=_COL_DELIVERED_DATE, value=delivery_date)

                action = "Would fill" if dry_run else "Filled"
                logger.info("Row %d (%s): %s delivery date %s", row_idx, asin, action, date_str)

        elif order.delivery_status == "cancelled":
            cancelled += 1
            cancelled_items.append({"asin": asin, "name": name or "Unknown"})
            changes.append({
                "row": str(row_idx),
                "asin": asin,
                "action": "mark as cancelled (manual deletion recommended)",
                "product": name or "Unknown",
            })
            log_msg = f"Row {row_idx} ({asin}): Order cancelled"
            logger.warning(log_msg)

    return filled, cancelled, cancelled_items, changes


@app.post("/sync-delivery-dates", response_model=SyncResponse)
async def sync_delivery_dates(request: SyncRequest, dry_run: bool = False) -> SyncResponse:
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
            raise HTTPException(status_code=500, detail="DROPBOX_FILE_PATH not configured")

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
            logger.info("DRY RUN: Would fill %d, would mark %d as cancelled", filled, cancelled)

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


class FetchPricesResponse(BaseModel):
    """Response from fetch-prices endpoint."""

    success: bool
    fetched: int
    failed: int
    skipped: int
    dry_run: bool = False


@app.post("/fetch-prices", response_model=FetchPricesResponse)
async def fetch_prices(
    dry_run: bool = False,
    days_back: int = 14,
    max_items: int = 50,
) -> FetchPricesResponse:
    """Fetch prices from Amazon product pages for items missing prices.

    This endpoint:
    1. Downloads the Excel file from Dropbox
    2. Finds all rows with blank price column (within date threshold)
    3. Fetches current price from Amazon product pages
    4. Updates the price column (or marks as -1 if failed)
    5. Uploads the updated file back to Dropbox (unless dry_run=true)

    Args:
        dry_run: If True, only report what would be fetched without modifying the file
        days_back: Only fetch prices for orders within this many days (default 14)
        max_items: Maximum number of items to fetch in one run (default 50)
    """
    try:
        import os
        from datetime import datetime, timedelta

        logger.info(
            "Starting price fetch (dry_run=%s, days_back=%d, max_items=%d)",
            dry_run,
            days_back,
            max_items,
        )

        # Get Dropbox client
        client: dropbox.Dropbox = get_client()
        account = client.users_get_current_account()
        logger.info("Connected to Dropbox as %s", account.name.display_name)

        # Download workbook
        file_path: str | None = os.getenv("DROPBOX_FILE_PATH")
        if not file_path:
            raise HTTPException(status_code=500, detail="DROPBOX_FILE_PATH not configured")

        workbook = download_workbook(client=client, file_path=file_path)

        if INVENTORY_SHEET not in workbook.sheetnames:
            raise HTTPException(
                status_code=500,
                detail=f"Sheet '{INVENTORY_SHEET}' not found in workbook",
            )

        sheet: Worksheet = workbook[INVENTORY_SHEET]

        # Calculate cutoff date
        cutoff_date = datetime.now() - timedelta(days=days_back)
        logger.info(
            "Only fetching prices for orders after %s",
            cutoff_date.strftime("%Y-%m-%d"),
        )

        # Find rows with missing prices (within date threshold)
        asins_to_fetch: list[tuple[int, str]] = []  # (row_idx, asin)

        for row_idx in range(2, sheet.max_row + 1):
            price_cell = sheet.cell(row=row_idx, column=_COL_PRICE)

            # Skip if already has a price (including -1 for failed attempts)
            if price_cell.value is not None:
                continue

            # Check order date
            order_date_cell = sheet.cell(row=row_idx, column=_COL_ORDER_DATE)
            if order_date_cell.value:
                try:
                    if isinstance(order_date_cell.value, datetime):
                        order_date = order_date_cell.value
                    else:
                        # Try parsing if it's a string
                        order_date = datetime.strptime(str(order_date_cell.value), "%m/%d/%Y")

                    # Skip if too old
                    if order_date < cutoff_date:
                        continue
                except (ValueError, AttributeError):
                    # Can't parse date, skip this row
                    logger.warning("Row %d: Could not parse order date", row_idx)
                    continue

            url = sheet.cell(row=row_idx, column=_COL_URL).value
            if not url or not isinstance(url, str):
                continue

            asin = extract_asin(url=url)
            if asin:
                asins_to_fetch.append((row_idx, asin))

                # Stop at max_items limit
                if len(asins_to_fetch) >= max_items:
                    logger.info("Reached max_items limit (%d), stopping scan", max_items)
                    break

        if not asins_to_fetch:
            logger.info("No items need price fetching")
            return FetchPricesResponse(
                success=True,
                fetched=0,
                failed=0,
                skipped=0,
                dry_run=dry_run,
            )

        logger.info("Found %d items needing prices", len(asins_to_fetch))

        if dry_run:
            logger.info("DRY RUN: Would fetch prices for %d items", len(asins_to_fetch))
            return FetchPricesResponse(
                success=True,
                fetched=0,
                failed=0,
                skipped=len(asins_to_fetch),
                dry_run=True,
            )

        # Fetch prices from Amazon
        asins_only = [asin for _, asin in asins_to_fetch]
        prices = fetch_multiple_prices(asins_only)

        # Update sheet
        fetched = 0
        failed = 0

        for row_idx, asin in asins_to_fetch:
            price = prices.get(asin)
            if price is not None:
                sheet.cell(row=row_idx, column=_COL_PRICE, value=price)
                fetched += 1
                logger.info("Row %d (%s): Set price $%.2f", row_idx, asin, price)
            else:
                # Mark as -1 to indicate we tried and failed
                # This prevents retrying the same item every time
                sheet.cell(row=row_idx, column=_COL_PRICE, value=-1)
                failed += 1
                logger.warning("Row %d (%s): Failed to fetch price, marked as -1", row_idx, asin)

        # Upload updated workbook (even if some failed, to save -1 markers)
        if fetched > 0 or failed > 0:
            upload_workbook(client=client, workbook=workbook, file_path=file_path)
            logger.info("Price fetch complete: %d fetched, %d failed", fetched, failed)

        return FetchPricesResponse(
            success=True,
            fetched=fetched,
            failed=failed,
            skipped=0,
            dry_run=False,
        )

    except Exception as e:
        logger.exception("Price fetch failed")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
async def health_check() -> dict[str, str]:
    """Health check endpoint."""
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    logger.info("Starting server on http://localhost:8000")
    uvicorn.run(app, host="127.0.0.1", port=8000)
