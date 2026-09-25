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


def extract_price_from_html(html: str, asin: str) -> float | None:
    """Extract price from Amazon product page HTML."""
    patterns = [
        (
            "a-price-whole/fraction",
            r'<span class="a-price-whole">(\d+)</span>.*?<span class="a-price-fraction">(\d+)</span>',
        ),
        ("a-offscreen", r'<span class="a-offscreen">\$(\d+\.\d+)</span>'),
        ("JSON-LD price", r'"price":"(\d+\.\d+)"'),
        (
            "priceblock_ourprice",
            r'<span id="priceblock_ourprice".*?>.*?\$(\d+\.\d+).*?</span>',
        ),
    ]

    for pattern_name, pattern in patterns:
        match = re.search(pattern, html, re.DOTALL)
        if match:
            try:
                if len(match.groups()) == 2:
                    dollars = match.group(1)
                    cents = match.group(2)
                    price = float(f"{dollars}.{cents}")
                    logger.info(
                        "ASIN %s: Extracted $%.2f using pattern '%s'",
                        asin,
                        price,
                        pattern_name,
                    )
                    return price
                else:
                    price = float(match.group(1))
                    logger.info(
                        "ASIN %s: Extracted $%.2f using pattern '%s'",
                        asin,
                        price,
                        pattern_name,
                    )
                    return price
            except (ValueError, IndexError) as e:
                logger.warning(
                    "ASIN %s: Pattern '%s' matched but failed to parse: %s",
                    asin,
                    pattern_name,
                    e,
                )
                continue

    logger.warning(
        "ASIN %s: No price pattern matched in HTML (length: %d chars)", asin, len(html)
    )
    return None


def fetch_product_price(
    asin: str, retries: int = 2, delay: float = 1.0
) -> float | None:
    """Fetch current price for a product from Amazon."""
    url = f"https://www.amazon.com/dp/{asin}"
    logger.info("ASIN %s: Fetching from %s", asin, url)

    for attempt in range(retries + 1):
        try:
            if attempt > 0:
                wait_time = delay * attempt
                logger.info(
                    "ASIN %s: Retry attempt %d/%d (waiting %.1fs)",
                    asin,
                    attempt + 1,
                    retries + 1,
                    wait_time,
                )
                time.sleep(wait_time)

            logger.info(
                "ASIN %s: Sending HTTP GET request (attempt %d/%d)",
                asin,
                attempt + 1,
                retries + 1,
            )
            response = requests.get(url, headers=HEADERS, timeout=10)
            logger.info(
                "ASIN %s: Received HTTP %d (content length: %d bytes)",
                asin,
                response.status_code,
                len(response.text),
            )

            if response.status_code == 404:
                logger.error(
                    "ASIN %s: Product not found (404) - likely delisted or invalid ASIN",
                    asin,
                )
                return None

            if response.status_code == 503:
                logger.warning(
                    "ASIN %s: Service unavailable (503) - Amazon may be blocking (attempt %d/%d)",
                    asin,
                    attempt + 1,
                    retries + 1,
                )
                continue

            if response.status_code != 200:
                logger.warning(
                    "ASIN %s: Unexpected HTTP %d (attempt %d/%d)",
                    asin,
                    response.status_code,
                    attempt + 1,
                    retries + 1,
                )
                continue

            price = extract_price_from_html(response.text, asin)

            if price:
                logger.info("✓ ASIN %s: Successfully fetched price $%.2f", asin, price)
                return price
            else:
                logger.error(
                    "✗ ASIN %s: Price extraction failed - page structure may have changed",
                    asin,
                )
                return None

        except requests.Timeout:
            logger.warning(
                "ASIN %s: Request timeout (10s exceeded) - attempt %d/%d",
                asin,
                attempt + 1,
                retries + 1,
            )
            if attempt == retries:
                logger.error(
                    "✗ ASIN %s: Failed after %d timeout attempts", asin, retries + 1
                )
                return None
        except requests.RequestException as e:
            logger.warning(
                "ASIN %s: Request error - %s: %s (attempt %d/%d)",
                asin,
                type(e).__name__,
                str(e),
                attempt + 1,
                retries + 1,
            )
            if attempt == retries:
                logger.error("✗ ASIN %s: Failed after %d attempts", asin, retries + 1)
                return None

    logger.error("✗ ASIN %s: Exhausted all retry attempts", asin)
    return None


def fetch_multiple_prices(
    asins: list[str], delay: float = 1.5
) -> dict[str, float | None]:
    """Fetch prices for multiple ASINs."""
    results: dict[str, float | None] = {}
    logger.info("=" * 80)
    logger.info("PRICE FETCH: Starting batch of %d ASINs", len(asins))
    logger.info("=" * 80)

    for i, asin in enumerate(asins):
        logger.info("")
        logger.info("PRICE FETCH [%d/%d]: %s", i + 1, len(asins), asin)

        if i > 0:
            logger.info("Waiting %.1fs before next request...", delay)
            time.sleep(delay)

        price = fetch_product_price(asin)
        results[asin] = price

        if price:
            logger.info("RESULT: $%.2f", price)
        else:
            logger.warning("RESULT: Failed to fetch")

    logger.info("")
    logger.info("=" * 80)
    success_count = sum(1 for p in results.values() if p is not None)
    logger.info("PRICE FETCH COMPLETE: %d/%d successful", success_count, len(asins))
    logger.info("=" * 80)

    return results
