"""
setup_verify.py
Run this after filling in .env to confirm everything is wired up correctly.

    python setup_verify.py

Checks:
  1. Auth — can we connect to Dropbox at all?
  2. Identity — confirms which account you're connected to
  3. File access — can we find and download the spreadsheet at DROPBOX_FILE_PATH?
"""

import os
import dropbox
from dotenv import load_dotenv
from dropbox_auth import get_dropbox_client

load_dotenv()

def main():
    print("── Checking Dropbox auth ──")
    try:
        dbx = get_dropbox_client()
        account = dbx.users_get_current_account()
        print(f"✓ Connected as: {account.name.display_name} ({account.email})")
    except Exception as e:
        print(f"✗ Auth failed: {e}")
        return

    print("\n── Checking file access ──")
    file_path = os.getenv("DROPBOX_FILE_PATH")
    if not file_path:
        print("✗ DROPBOX_FILE_PATH is not set in .env")
        return

    try:
        metadata = dbx.files_get_metadata(file_path)
        size_kb = getattr(metadata, 'size', 0) // 1024
        print(f"✓ Found file: {metadata.name} ({size_kb} KB) at {file_path}")
    except dropbox.exceptions.ApiError as e:
        if "not_found" in str(e):
            print(f"✗ File not found at '{file_path}' — double-check DROPBOX_FILE_PATH in .env")
            print("  Tip: the path is relative to your Dropbox root, e.g. /Vine/orders.xlsx")
        else:
            print(f"✗ API error: {e}")
        return

    print("\n✓ All checks passed — Dropbox is ready.")

if __name__ == "__main__":
    main()
