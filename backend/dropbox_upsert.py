"""Upserts new Vine orders into the inventory sheet of the Dropbox Excel file.

Upsert key: ASIN extracted from the product URL.
- If a row with that ASIN already exists: skip it (never overwrite manual fields).
- If new: append in ascending order_date order (oldest first).

Columns written on insert (all others left blank for manual entry):
    order_date, url, name, FMV

Columns intentionally left blank on insert (filled manually or future TODO):
    delivered_date  — requires order detail page visit (TODO)
    price           — requires product listing page visit (TODO)
    rating          — filled after review
    reviewed        — filled after review
    verbatim        — filled after review
    sold            — out of scope
    sell_price      — out of scope
"""

from __future__ import annotations

import io
import os
import re
from datetime import datetime
from typing import Any

import dropbox
import dropbox.exceptions
import dropbox.files
from dotenv import load_dotenv
from openpyxl import load_workbook
from openpyxl.workbook import Workbook
from openpyxl.worksheet.worksheet import Worksheet

from dropbox_auth import get_dropbox_client

load_dotenv()

# Matches /dp/XXXXXXXXXX/ in an Amazon product URL
_ASIN_PATTERN: re.Pattern[str] = re.compile(r"/dp/([A-Z0-9]{10})")

# Column index mapping (1-based, matching the inventory sheet header row)
_COL_ORDER_DATE: int = 1
_COL_DELIVERED_DATE: int = 2
_COL_URL: int = 3
_COL_NAME: int = 4
_COL_FMV: int = 5
_COL_PRICE: int = 6
_COL_RATING: int = 7
_COL_REVIEWED: int = 8
_COL_VERBATIM: int = 9
_COL_SOLD: int = 10
_COL_SELL_PRICE: int = 11

INVENTORY_SHEET: str = "inventory"


def extract_asin(url: str) -> str | None:
    """Extract the ASIN from an Amazon product URL.

    Args:
        url: Amazon product URL containing /dp/XXXXXXXXXX/.

    Returns:
        The 10-character ASIN string, or None if not found.
    """
    match = _ASIN_PATTERN.search(url)
    return match.group(1) if match else None


def get_existing_asins(sheet: Worksheet) -> set[str]:
    """Return the set of ASINs already present in the inventory sheet.

    Reads column C (url) for every data row and extracts ASINs.

    Args:
        sheet: The openpyxl inventory worksheet.

    Returns:
        Set of ASIN strings currently in the sheet.
    """
    asins: set[str] = set()
    for row in sheet.iter_rows(min_row=2, values_only=True):
        url = row[_COL_URL - 1]
        if url and isinstance(url, str):
            asin = extract_asin(url=url)
            if asin:
                asins.add(asin)
    return asins


def parse_order_date(order: dict[str, Any]) -> datetime | None:
    """Parse an order's date into a datetime for sorting and cell writing.

    Prefers order_timestamp (epoch ms) over order_date string.

    Args:
        order: Order dict from the extension queue.

    Returns:
        datetime object or None if unparseable.
    """
    if order.get("order_timestamp"):
        return datetime.fromtimestamp(order["order_timestamp"] / 1000)

    date_str: str | None = order.get("order_date")
    if not date_str:
        return None

    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%B %d, %Y"):
        try:
            return datetime.strptime(date_str, fmt)
        except ValueError:
            continue

    return None


def build_new_rows(
    orders: list[dict[str, Any]],
    existing_asins: set[str],
) -> list[dict[str, Any]]:
    """Filter and sort orders that are not already in the inventory sheet.

    Args:
        orders: List of order dicts from the extension queue.
        existing_asins: ASINs already present in the sheet.

    Returns:
        New orders sorted oldest-first, ready to append.
    """
    new_orders: list[dict[str, Any]] = []

    for order in orders:
        url: str | None = order.get("url")
        if not url:
            continue

        asin = extract_asin(url=url)
        if not asin or asin in existing_asins:
            continue

        new_orders.append(order)

    new_orders.sort(key=lambda o: parse_order_date(order=o) or datetime.min)
    return new_orders


def append_orders_to_sheet(
    sheet: Worksheet,
    orders: list[dict[str, Any]],
) -> int:
    """Append new orders as rows to the inventory sheet.

    Args:
        sheet: The openpyxl inventory worksheet.
        orders: New orders to append, already sorted oldest-first.

    Returns:
        Number of rows appended.
    """
    next_row: int = sheet.max_row + 1

    for order in orders:
        parsed_date = parse_order_date(order=order)

        sheet.cell(row=next_row, column=_COL_ORDER_DATE, value=parsed_date)
        sheet.cell(row=next_row, column=_COL_URL, value=order.get("url"))
        sheet.cell(row=next_row, column=_COL_NAME, value=order.get("name"))
        sheet.cell(row=next_row, column=_COL_FMV, value=order.get("fmv"))
        # _COL_DELIVERED_DATE, _COL_PRICE: TODO — requires additional page visits
        # All other columns left blank for manual entry

        next_row += 1

    return len(orders)


def upload_workbook(
    client: dropbox.Dropbox,
    workbook: Workbook,
    file_path: str,
) -> None:
    """Serialize and upload the workbook back to Dropbox, overwriting the existing file.

    Args:
        client: Authenticated Dropbox client.
        workbook: The modified openpyxl Workbook.
        file_path: Absolute Dropbox path to overwrite.
    """
    buffer = io.BytesIO()
    workbook.save(buffer)
    buffer.seek(0)

    client.files_upload(
        f=buffer.read(),
        path=file_path,
        mode=dropbox.files.WriteMode.overwrite,
    )


def upsert_orders(orders: list[dict[str, Any]]) -> None:
    """Main entry point: upsert a list of orders into the Dropbox inventory sheet.

    Args:
        orders: List of order dicts from the extension queue. Each dict must
                contain at minimum: url, name, fmv, order_date or order_timestamp.
    """
    file_path: str | None = os.getenv("DROPBOX_FILE_PATH")
    if not file_path:
        raise EnvironmentError("DROPBOX_FILE_PATH is not set in .env")

    print("── Connecting to Dropbox ──")
    client: dropbox.Dropbox = get_dropbox_client()
    print(f"✓ Connected as: {client.users_get_current_account().name.display_name}")

    print(f"\n── Downloading {file_path} ──")
    _, response = client.files_download(path=file_path)
    workbook: Workbook = load_workbook(filename=io.BytesIO(response.content))

    if INVENTORY_SHEET not in workbook.sheetnames:
        raise ValueError(
            f"Sheet '{INVENTORY_SHEET}' not found. "
            f"Available sheets: {workbook.sheetnames}"
        )

    sheet: Worksheet = workbook[INVENTORY_SHEET]
    existing_asins: set[str] = get_existing_asins(sheet=sheet)
    print(f"✓ Found {len(existing_asins)} existing ASINs in inventory")

    new_rows = build_new_rows(orders=orders, existing_asins=existing_asins)
    print(f"→ {len(new_rows)} new orders to insert "
          f"({len(orders) - len(new_rows)} already present, skipped)")

    if not new_rows:
        print("✓ Nothing to do.")
        return

    appended = append_orders_to_sheet(sheet=sheet, orders=new_rows)

    print(f"\n── Uploading updated file ──")
    upload_workbook(client=client, workbook=workbook, file_path=file_path)
    print(f"✓ Uploaded — {appended} rows added to '{INVENTORY_SHEET}'")


if __name__ == "__main__":
    # Smoke test: upsert a single fake order to verify the pipeline works.
    # Replace with real orders from the extension queue in production.
    _test_orders: list[dict[str, Any]] = [
        {
            "asin": "B0TEST00001",
            "name": "Test Product — delete this row",
            "url": "https://www.amazon.com/dp/B0TEST00001",
            "fmv": 9.99,
            "order_date": "1/1/2025",
            "order_timestamp": None,
        }
    ]
    upsert_orders(orders=_test_orders)
