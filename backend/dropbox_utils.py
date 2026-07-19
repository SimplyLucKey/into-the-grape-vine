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
    logger.info("Downloading workbook from Dropbox: %s", file_path)
    try:
        _, response = client.files_download(path=file_path)
        size_mb = len(response.content) / (1024 * 1024)
        logger.info("✓ Downloaded %s (%.2f MB)", file_path, size_mb)
        return load_workbook(filename=io.BytesIO(response.content))
    except dropbox.exceptions.ApiError as e:
        logger.error("✗ Failed to download: %s", str(e))
        raise


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
    import time

    buffer = io.BytesIO()
    workbook.save(buffer)
    buffer.seek(0)
    content = buffer.read()
    file_size_mb = len(content) / (1024 * 1024)

    logger.info("Preparing upload: %s (%.2f MB)", file_path, file_size_mb)

    # Retry logic for flaky connections and rate limits
    max_retries = 5
    for attempt in range(max_retries):
        try:
            logger.info(
                "Upload attempt %d/%d... (Press Ctrl+C to abort)",
                attempt + 1,
                max_retries,
            )
            client.files_upload(
                f=content,
                path=file_path,
                mode=dropbox.files.WriteMode.overwrite,
            )
            logger.info("✓ Successfully uploaded workbook to %s", file_path)
            return
        except KeyboardInterrupt:
            logger.warning("⚠ Upload interrupted by user (Ctrl+C)")
            raise
        except dropbox.exceptions.RateLimitError as e:
            # Extract all available error information
            retry_after = getattr(e, "retry_after", None) or (2 ** (attempt + 1))
            status_code = getattr(e, "status_code", "unknown")
            reason = getattr(e, "reason", "unknown")
            error_obj = getattr(e, "error", None)

            logger.error("=" * 80)
            logger.error("✗ RATE LIMIT ERROR (attempt %d/%d)", attempt + 1, max_retries)
            logger.error("   Status code: %s", status_code)
            logger.error("   Reason: %s", reason)
            logger.error("   Error object: %s", error_obj)
            logger.error("   Full error: %s", str(e))
            logger.error("   Error type: %s", type(e).__name__)
            logger.error("   Retry after: %s seconds", retry_after)

            if attempt < max_retries - 1:
                logger.warning(
                    "   → Waiting %ds before retry (Press Ctrl+C to abort)...",
                    retry_after,
                )
                try:
                    time.sleep(retry_after)
                except KeyboardInterrupt:
                    logger.warning("⚠ Retry aborted by user")
                    raise
            else:
                logger.error("=" * 80)
                logger.error(
                    "✗✗✗ UPLOAD FAILED: Rate limited after %d attempts", max_retries
                )
                logger.error("=" * 80)
                raise
        except dropbox.exceptions.ApiError as e:
            error_msg = str(e.error) if hasattr(e, "error") else str(e)
            status_code = getattr(e, "status_code", "unknown")
            logger.error(
                "✗ Dropbox API error (attempt %d/%d) - Status: %s",
                attempt + 1,
                max_retries,
                status_code,
            )
            logger.error("   Error: %s", error_msg)
            if attempt < max_retries - 1:
                wait_time = 2 ** (attempt + 1)
                logger.warning("   Retrying in %ds...", wait_time)
                time.sleep(wait_time)
            else:
                raise
        except ConnectionError as e:
            logger.error(
                "✗ Connection error (attempt %d/%d): %s",
                attempt + 1,
                max_retries,
                type(e).__name__,
            )
            logger.error("   Details: %s", str(e))
            if attempt < max_retries - 1:
                wait_time = 2 ** (attempt + 1)
                logger.warning("   Retrying in %ds...", wait_time)
                time.sleep(wait_time)
            else:
                logger.error("✗ Upload failed after %d attempts", max_retries)
                raise
        except Exception as e:
            logger.error(
                "✗ Unexpected error (attempt %d/%d): %s",
                attempt + 1,
                max_retries,
                type(e).__name__,
            )
            logger.error("   Details: %s", str(e))
            if attempt < max_retries - 1:
                wait_time = 2 ** (attempt + 1)
                logger.warning("   Retrying in %ds...", wait_time)
                time.sleep(wait_time)
            else:
                raise


def preview_workbook(workbook: Workbook, max_rows: int = 5) -> None:
    """Log a preview of each sheet — header plus up to max_rows data rows.

    Args:
        workbook: The loaded openpyxl Workbook.
        max_rows: Maximum number of data rows to log per sheet.
    """
    for sheet_name in workbook.sheetnames:
        sheet = workbook[sheet_name]
        logger.info(
            "Sheet '%s' (%d rows × %d cols)",
            sheet_name,
            sheet.max_row,
            sheet.max_column,
        )
        for row_index, row in enumerate(sheet.iter_rows(values_only=True)):
            if row_index > max_rows:
                logger.info("  ... (%d more rows)", sheet.max_row - max_rows - 1)
                break
            label = "header" if row_index == 0 else f"row {row_index:>3}"
            logger.info("  %s: %s", label, row)
