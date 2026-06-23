/**
 * content.js — Into the Grape Vine
 *
 * Runs on: https://www.amazon.com/vine/orders
 *
 * HOW IT WORKS:
 *   Amazon's Vine orders page (/vine/orders) renders a <table> with one
 *   <tr class="vvp-orders-table--row"> per order. This script reads each
 *   row and pulls out exactly what we need. No login, no navigation —
 *   it reads what is already on screen in your logged-in session.
 *
 * DATA EXTRACTED PER ROW:
 *   - name        — full product title (from .a-truncate-full, not the
 *                   truncated visible version)
 *   - asin        — parsed from the /dp/XXXXXXXXXX/ URL pattern
 *   - url         — full Amazon product URL (href on the title anchor)
 *   - order_date  — human-readable date text, e.g. "6/21/2026"
 *   - order_timestamp — raw epoch ms from data-order-timestamp attribute
 *                       (useful for sorting, more reliable than parsing dates)
 *   - fmv         — Fair Market Value, the dollar amount in the 4th column
 *   - order_id    — parsed from the "Order details" link href, e.g. "114-8084155-3450623"
 *   - thumbnail   — image src for the product photo
 *
 * SELECTORS — verified against live /vine/orders HTML (June 2026):
 *   .vvp-orders-table--row          each order row in the table
 *   .vvp-orders-table--image-col img  product thumbnail
 *   .a-link-normal[href*="/dp/"]    anchor wrapping the product title
 *   .a-truncate-full                untruncated full title text (hidden span)
 *   [data-order-timestamp]          <td> holding both the timestamp attr and date text
 *   .vvp-text-align-right           <td> containing the FMV dollar amount
 *   [name="vvp-orders-table--order-details-btn"]  "Order details" link (has orderID in href)
 *
 * IF A SELECTOR BREAKS (Amazon changed their markup):
 *   Open DevTools (F12) on /vine/orders → Elements tab → Ctrl+F
 *   Search for the class name to confirm it still exists or find the new one.
 */

// ---------------------------------------------------------------------------
// Page detection — only run on the Vine orders page
// ---------------------------------------------------------------------------

function isVineOrdersPage() {
  return window.location.href.includes('/vine/orders');
}

// ---------------------------------------------------------------------------
// Core extraction — reads the orders table
// ---------------------------------------------------------------------------

function extractVineOrders() {
  const rows = document.querySelectorAll('tr.vvp-orders-table--row');

  if (rows.length === 0) {
    console.warn(
      '[Into the Grape Vine] No rows found with selector "tr.vvp-orders-table--row". ' +
      'Check DevTools → Elements to see if Amazon changed their table markup.'
    );
    return [];
  }

  const results = [];

  rows.forEach((row, index) => {
    try {
      // --- Thumbnail ---
      const imgEl = row.querySelector('.vvp-orders-table--image-col img');
      const thumbnail = imgEl?.src ?? null;

      // --- Product URL and ASIN ---
      // The title is wrapped in <a href="https://www.amazon.com/dp/ASIN">
      const titleAnchor = row.querySelector('a.a-link-normal[href*="/dp/"]');
      const url = titleAnchor?.href ?? null;
      // ASIN is the 10-char alphanumeric segment after /dp/
      const asin = url?.match(/\/dp\/([A-Z0-9]{10})/)?.[1] ?? null;

      // --- Full product name ---
      // .a-truncate-full is the visually hidden span with the complete title.
      // We prefer this over .a-truncate-cut which is the truncated visible version.
      const nameEl = titleAnchor?.querySelector('.a-truncate-full');
      const name = nameEl?.textContent?.trim() ?? null;

      // --- Order date ---
      // The date <td> carries both a data-order-timestamp (epoch ms) attribute
      // and visible text like "6/21/2026". We capture both.
      const dateTd = row.querySelector('td[data-order-timestamp]');
      const order_date = dateTd?.textContent?.trim() ?? null;
      const order_timestamp = dateTd?.dataset?.orderTimestamp
        ? parseInt(dateTd.dataset.orderTimestamp, 10)
        : null;

      // --- Fair Market Value ---
      // 4th column: <td class="vvp-orders-table--text-col vvp-text-align-right">
      // Contains text like "$34.99". We strip the $ and parse to float.
      const fmvTd = row.querySelector('td.vvp-text-align-right');
      const fmvRaw = fmvTd?.textContent?.trim() ?? null;
      const fmv = fmvRaw ? parseFloat(fmvRaw.replace(/[^0-9.]/g, '')) : null;

      // --- Order ID ---
      // The "Order details" button links to:
      // /gp/your-account/order-details?orderID=114-8084155-3450623
      const orderDetailsLink = row.querySelector(
        'a[name="vvp-orders-table--order-details-btn"]'
      );
      const orderDetailsHref = orderDetailsLink?.href ?? null;
      const order_id =
        orderDetailsHref?.match(/orderID=([0-9\-]+)/)?.[1] ?? null;

      results.push({
        asin,
        name,
        url,
        order_date,
        order_timestamp,
        fmv,
        order_id,
        thumbnail,
        captured_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error(`[Into the Grape Vine] Error parsing row ${index}:`, err);
    }
  });

  console.log(`[Into the Grape Vine] Extracted ${results.length} orders from page.`);
  return results;
}

// ---------------------------------------------------------------------------
// Main — fires once when the page is idle
// ---------------------------------------------------------------------------

(function main() {
  if (!isVineOrdersPage()) return;

  // Small delay to allow any deferred rendering to settle
  setTimeout(() => {
    const data = extractVineOrders();
    if (data.length === 0) return;

    chrome.runtime.sendMessage({
      action: 'DATA_CAPTURED',
      data,
    });
  }, 1000);
})();

// ---------------------------------------------------------------------------
// Manual trigger — popup sends MANUAL_EXTRACT when user clicks "Extract"
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'MANUAL_EXTRACT') {
    if (!isVineOrdersPage()) {
      sendResponse({
        ok: false,
        reason: 'Navigate to amazon.com/vine/orders first.',
      });
      return;
    }

    const data = extractVineOrders();

    chrome.runtime.sendMessage({ action: 'DATA_CAPTURED', data });
    sendResponse({ ok: true, count: data.length });
  }
});
