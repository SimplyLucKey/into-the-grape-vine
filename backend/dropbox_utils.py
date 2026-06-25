"""Shared Dropbox client and workbook helpers."""

from __future__ import annotations

import io
import logging

import dropbox
import dropbox.exceptions
import dropbox.files
from openpyxl import load_workbook
from openpyxl.workbook import Workbook

from dropbox_auth import get_dropbox_client

logger = logging.getLogger(__name__)


def get_client() -> dropbox.Dropbox:
    """Return an authenticated Dropbox client.

    Thin wrapper around get_dropbox_client() so callers import from one place.
    """
    return get_dropbox_client()


def download_workbook(
    client: dropbox.Dropbox,
    file_path: str,
) -> Workbook:
    """Download an Excel file from Dropbox and return it as a Workbook.

    Args:
        client: Authenticated Dropbox client.
        file_path: Absolute path to the file within the user's Dropbox.

    Raises:
        dropbox.exceptions.ApiError: If the file cannot be found or accessed.
    """
    _, response = client.files_download(path=file_path)
    logger.debug("Downloaded %s (%d bytes)", file_path, len(response.content))
    return load_workbook(filename=io.BytesIO(response.content))


def upload_workbook(
    client: dropbox.Dropbox,
    workbook: Workbook,
    file_path: str,
) -> None:
    """Serialize and upload a workbook to Dropbox, overwriting the existing file.

    Args:
        client: Authenticated Dropbox client.
        workbook: The modified openpyxl Workbook to upload.
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
    logger.debug("Uploaded workbook to %s", file_path)


def preview_workbook(workbook: Workbook, max_rows: int = 5) -> None:
    """Log a preview of each sheet — header plus up to max_rows data rows.

    Args:
        workbook: The loaded openpyxl Workbook.
        max_rows: Maximum number of data rows to log per sheet.
    """
    for sheet_name in workbook.sheetnames:
        sheet = workbook[sheet_name]
        logger.info("Sheet '%s' (%d rows × %d cols)", sheet_name, sheet.max_row, sheet.max_column)
        for row_index, row in enumerate(sheet.iter_rows(values_only=True)):
            if row_index > max_rows:
                logger.info("  ... (%d more rows)", sheet.max_row - max_rows - 1)
                break
            label = "header" if row_index == 0 else f"row {row_index:>3}"
            logger.info("  %s: %s", label, row)
