/**
 * vine-orders.js
 * Content script that runs on amazon.com/vine/orders page.
 * Extracts Vine order data from the orders table.
 *
 * Captures: ASIN, product name/URL, order date, FMV, order ID, thumbnail
 * Sends to: background.js via VINE_ORDERS_CAPTURED message
 *
 * Selectors verified against live /vine/orders HTML (June 2026):
 *   tr.vvp-orders-table--row              one row per order
 *   .vvp-orders-table--image-col img      product thumbnail
 *   a.a-link-normal[href*="/dp/"]         product link (contains ASIN)
 *   .a-truncate-full                      full untruncated title
 *   td[data-order-timestamp]              date cell; attr holds epoch ms
 *   td.vvp-text-align-right               FMV column
 *   a[name="vvp-orders-table--order-details-btn"]  order details link
 *
 * If a selector breaks, open DevTools → Elements → Ctrl+F and search
 * for the class name to find the updated one.
 *
 * Note: Depends on utils.js being loaded first (via manifest.json order)
 */

function extractVineOrders() {
  const rows = document.querySelectorAll('tr.vvp-orders-table--row');

  if (rows.length === 0) {
    console.warn('[Into the Grape Vine] No rows found — Amazon may have changed their markup.');
    return [];
  }

  const results = [];

  rows.forEach((row, index) => {
    try {
      const thumbnail = row.querySelector('.vvp-orders-table--image-col img')?.src ?? null;

      // Product link contains the ASIN in /dp/XXXXXXXXXX/
      const titleAnchor = row.querySelector('a.a-link-normal[href*="/dp/"]');
      const url = titleAnchor?.href ?? null;
      const asin = url ? extractASIN(url) : null; // from utils.js

      // .a-truncate-full is the hidden span with the complete untruncated title
      const name = titleAnchor?.querySelector('.a-truncate-full')?.textContent?.trim() ?? null;

      // The date <td> carries data-order-timestamp (epoch ms) and visible date text
      const dateTd = row.querySelector('td[data-order-timestamp]');
      const order_date = dateTd?.textContent?.trim() ?? null;
      const order_timestamp = dateTd?.dataset?.orderTimestamp
        ? parseInt(dateTd.dataset.orderTimestamp, 10)
        : null;

      // FMV is the right-aligned dollar amount in the 4th column
      const fmvRaw = row.querySelector('td.vvp-text-align-right')?.textContent?.trim() ?? null;
      const fmv = fmvRaw ? parseFloat(fmvRaw.replace(/[^0-9.]/g, '')) : null;

      // Order ID lives in the "Order details" link query string
      const orderDetailsHref = row.querySelector('a[name="vvp-orders-table--order-details-btn"]')?.href ?? null;
      const order_id = orderDetailsHref?.match(/orderID=([0-9-]+)/)?.[1] ?? null;

      results.push({ asin, name, url, order_date, order_timestamp, fmv, order_id, thumbnail, captured_at: new Date().toISOString() });
    } catch (err) {
      console.error(`[Into the Grape Vine] Error on row ${index}:`, err);
    }
  });

  console.log(`[Into the Grape Vine] Extracted ${results.length} Vine orders.`);
  return results;
}

(function main() {
  if (!isVineOrdersPage()) return;
  setTimeout(() => {
    const vineOrders = extractVineOrders();
    if (vineOrders.length) {
      chrome.runtime.sendMessage({ action: 'VINE_ORDERS_CAPTURED', data: vineOrders });
    }
  }, 1000);
})();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action !== 'MANUAL_EXTRACT_VINE') return;

  if (!isVineOrdersPage()) {
    sendResponse({ ok: false, reason: 'Navigate to amazon.com/vine/orders first.' });
    return;
  }

  const vineOrders = extractVineOrders();
  chrome.runtime.sendMessage({ action: 'VINE_ORDERS_CAPTURED', data: vineOrders });
  sendResponse({ ok: true, count: vineOrders.length });
});
