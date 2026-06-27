"""Fetch product prices from Amazon product pages.

This module scrapes Amazon product pages to extract current prices.
"""

from __future__ import annotations

import logging
import re
import time
from typing import Any

import requests

logger = logging.getLogger(__name__)

# User agent to avoid blocking
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


def extract_price_from_html(html: str) -> float | None:
    """Extract price from Amazon product page HTML.

    Tries multiple price selectors in order of reliability.

    Args:
        html: HTML content of the product page.

    Returns:
        Price as float, or None if not found.
    """
    # Try multiple price patterns in order
    patterns = [
        # Standard price span (most common)
        r'<span class="a-price-whole">(\d+)</span>.*?<span class="a-price-fraction">(\d+)</span>',
        # Compact price format
        r'<span class="a-offscreen">\$(\d+\.\d+)</span>',
        # Price in JSON-LD structured data
        r'"price":"(\d+\.\d+)"',
        # Another common format
        r'<span id="priceblock_ourprice".*?>.*?\$(\d+\.\d+).*?</span>',
    ]

    for pattern in patterns:
        match = re.search(pattern, html, re.DOTALL)
        if match:
            try:
                if len(match.groups()) == 2:
                    # Format: whole and fraction parts
                    dollars = match.group(1)
                    cents = match.group(2)
                    return float(f"{dollars}.{cents}")
                else:
                    # Format: single decimal number
                    return float(match.group(1))
            except (ValueError, IndexError):
                continue

    return None


def fetch_product_price(asin: str, retries: int = 2, delay: float = 1.0) -> float | None:
    """Fetch current price for a product from Amazon.

    Args:
        asin: The Amazon ASIN to fetch.
        retries: Number of retry attempts if request fails.
        delay: Delay between requests in seconds (be nice to Amazon).

    Returns:
        Current price as float, or None if unavailable/failed.
    """
    url = f"https://www.amazon.com/dp/{asin}"

    for attempt in range(retries + 1):
        try:
            # Add delay to avoid rate limiting
            if attempt > 0:
                time.sleep(delay * attempt)

            response = requests.get(url, headers=HEADERS, timeout=10)

            if response.status_code == 404:
                logger.warning("ASIN %s: Product not found (404)", asin)
                return None

            if response.status_code != 200:
                logger.warning(
                    "ASIN %s: HTTP %d (attempt %d/%d)",
                    asin,
                    response.status_code,
                    attempt + 1,
                    retries + 1,
                )
                continue

            price = extract_price_from_html(response.text)

            if price:
                logger.info("ASIN %s: Found price $%.2f", asin, price)
                return price
            else:
                logger.warning("ASIN %s: Price not found in HTML", asin)
                return None

        except requests.RequestException as e:
            logger.warning("ASIN %s: Request failed - %s (attempt %d/%d)", asin, e, attempt + 1, retries + 1)
            if attempt == retries:
                return None

    return None


def fetch_multiple_prices(asins: list[str], delay: float = 1.5) -> dict[str, float | None]:
    """Fetch prices for multiple ASINs.

    Args:
        asins: List of ASINs to fetch.
        delay: Delay between requests in seconds (default 1.5s to be respectful).

    Returns:
        Dict mapping ASIN to price (or None if unavailable).
    """
    results: dict[str, float | None] = {}

    for i, asin in enumerate(asins):
        logger.info("Fetching price %d/%d: %s", i + 1, len(asins), asin)

        # Add delay between requests (except first one)
        if i > 0:
            time.sleep(delay)

        price = fetch_product_price(asin)
        results[asin] = price

    return results
