"""
dropbox_auth.py
Builds an authenticated Dropbox client from environment variables.
The SDK handles access token refresh automatically using the refresh token.
"""

import os
import dropbox
from dotenv import load_dotenv

load_dotenv()

def get_dropbox_client() -> dropbox.Dropbox:
    app_key = os.getenv("DROPBOX_APP_KEY")
    app_secret = os.getenv("DROPBOX_APP_SECRET")
    refresh_token = os.getenv("DROPBOX_REFRESH_TOKEN")

    missing = [
        k for k, v in {
            "DROPBOX_APP_KEY": app_key,
            "DROPBOX_APP_SECRET": app_secret,
            "DROPBOX_REFRESH_TOKEN": refresh_token,
        }.items() if not v
    ]

    if missing:
        raise EnvironmentError(
            f"Missing required environment variables: {', '.join(missing)}\n"
            "Copy .env.template to .env and fill in the values."
        )

    return dropbox.Dropbox(
        oauth2_refresh_token=refresh_token,
        app_key=app_key,
        app_secret=app_secret,
    )
