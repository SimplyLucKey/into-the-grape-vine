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
    _COL_URL,
    extract_asin,
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


def parse_delivery_date(order: AccountOrder) -> Any:
    """Parse delivery date from account order."""
    if not order.delivery_date_parsed:
        return None
    from datetime import datetime

    return datetime.fromisoformat(order.delivery_date_parsed.replace("Z", "+00:00"))


def sync_delivery_dates_to_sheet(
    sheet: Worksheet,
    account_orders: list[AccountOrder],
) -> tuple[int, int, list[dict[str, str]]]:
    """Update blank delivered_date cells based on account orders.

    Args:
        sheet: The openpyxl inventory worksheet.
        account_orders: List of account orders from extension.

    Returns:
        Tuple of (filled_count, cancelled_count, cancelled_items).
    """
    # Index by ASIN for fast lookup
    orders_by_asin: dict[str, AccountOrder] = {}
    for order in account_orders:
        if order.asin:
            orders_by_asin[order.asin] = order

    filled = 0
    cancelled = 0
    cancelled_items: list[dict[str, str]] = []

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
                sheet.cell(row=row_idx, column=_COL_DELIVERED_DATE, value=delivery_date)
                filled += 1
                logger.info(
                    "Row %d (%s): Filled delivery date %s",
                    row_idx,
                    asin,
                    delivery_date.strftime("%Y-%m-%d"),
                )

        elif order.delivery_status == "cancelled":
            cancelled += 1
            cancelled_items.append({"asin": asin, "name": name or "Unknown"})
            logger.warning("Row %d (%s): Order cancelled", row_idx, asin)

    return filled, cancelled, cancelled_items


@app.post("/sync-delivery-dates", response_model=SyncResponse)
async def sync_delivery_dates(request: SyncRequest) -> SyncResponse:
    """Sync delivery dates from account orders to Dropbox Excel file.

    This endpoint:
    1. Downloads the Excel file from Dropbox
    2. Matches account orders by ASIN
    3. Fills blank delivered_date cells for delivered items
    4. Uploads the updated file back to Dropbox
    """
    try:
        logger.info("Received %d account orders to sync", len(request.account_orders))

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
        filled, cancelled, cancelled_items = sync_delivery_dates_to_sheet(
            sheet=sheet,
            account_orders=request.account_orders,
        )

        if filled == 0 and cancelled == 0:
            logger.info("No updates needed")
            return SyncResponse(
                success=True,
                filled=0,
                cancelled=0,
                cancelled_items=[],
            )

        # Upload updated workbook
        upload_workbook(client=client, workbook=workbook, file_path=file_path)
        logger.info("Sync complete: %d filled, %d cancelled", filled, cancelled)

        return SyncResponse(
            success=True,
            filled=filled,
            cancelled=cancelled,
            cancelled_items=cancelled_items,
        )

    except Exception as e:
        logger.exception("Sync failed")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
async def health_check() -> dict[str, str]:
    """Health check endpoint."""
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    logger.info("Starting server on http://localhost:8000")
    uvicorn.run(app, host="127.0.0.1", port=8000)
