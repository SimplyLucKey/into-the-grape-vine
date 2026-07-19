"""Builds an authenticated Dropbox client from environment variables."""

import os

import dropbox
from dotenv import load_dotenv

load_dotenv()


def get_dropbox_client() -> dropbox.Dropbox:
    """Return an authenticated Dropbox client using refresh-token OAuth.

    Disables SDK's built-in retry so our custom retry logic handles it.

    Raises:
        EnvironmentError: If any required environment variable is missing.
    """
    app_key: str | None = os.getenv("DROPBOX_APP_KEY")
    app_secret: str | None = os.getenv("DROPBOX_APP_SECRET")
    refresh_token: str | None = os.getenv("DROPBOX_REFRESH_TOKEN")

    missing: list[str] = [
        name
        for name, value in {
            "DROPBOX_APP_KEY": app_key,
            "DROPBOX_APP_SECRET": app_secret,
            "DROPBOX_REFRESH_TOKEN": refresh_token,
        }.items()
        if not value
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
        max_retries_on_error=0,
        max_retries_on_rate_limit=0,
    )
