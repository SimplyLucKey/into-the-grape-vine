/**
 * account-orders.js
 * Runs on amazon.com/order-history. Extracts delivery dates and status
 * to sync with the Vine inventory spreadsheet.
 *
 * Selectors verified against live /order-history HTML (June 2026):
 *   .order-card                           one card per order
 *   .delivery-box__primary-text           "Delivered April 9" or "Cancelled"
 *   .yohtmlc-product-title a              product name and link (contains ASIN)
 *   a[href*="orderId="]                   action buttons with order ID
 *
 * Note: Depends on utils.js being loaded first (via manifest.json order)
 */

function extractOrderID(card) {
  // Look for orderID or orderId in any action link
  const links = card.querySelectorAll('a[href*="orderId="], a[href*="orderID="]');
  for (const link of links) {
    const match = link.href.match(/order[Ii][Dd]=([0-9-]+)/);
    if (match) return match[1];
  }
  return null;
}

function extractAccountOrders() {
  const cards = document.querySelectorAll('.order-card');

  if (cards.length === 0) {
    console.warn('[Into the Grape Vine] No order cards found — Amazon may have changed their markup.');
    return [];
  }

  const results = [];

  cards.forEach((card, index) => {
    try {
      // Each card can have multiple delivery boxes (shipments)
      const deliveryBoxes = card.querySelectorAll('.delivery-box');

      deliveryBoxes.forEach((box) => {
        const statusText = box.querySelector('.delivery-box__primary-text')?.textContent?.trim() ?? null;
        if (!statusText) return;

        const isCancelled = statusText.toLowerCase().includes('cancelled');
        const isDelivered = statusText.toLowerCase().includes('delivered');

        // Extract delivery date if delivered
        let deliveryDate = null;
        let deliveryDateParsed = null;
        if (isDelivered) {
          const match = statusText.match(/Delivered\s+(.+)/i);
          if (match) {
            deliveryDate = match[1].trim(); // "April 9"
            deliveryDateParsed = inferYear(deliveryDate); // from utils.js
          }
        }

        // Get product info from this delivery box
        const productLink = box.querySelector('.yohtmlc-product-title a[href*="/dp/"], .product-image a[href*="/dp/"]');
        const url = productLink?.href ?? null;
        const asin = url ? extractASIN(url) : null; // from utils.js
        const name = box.querySelector('.yohtmlc-product-title a')?.textContent?.trim() ?? null;

        // Extract thumbnail image (look for Amazon CDN images)
        const imgEl = box.querySelector('img[src*="media-amazon.com"]');
        const thumbnail = imgEl?.src || null;

        // Order ID is at the card level, not per shipment
        const orderId = extractOrderID(card);

        results.push({
          asin,
          name,
          url,
          thumbnail,
          order_id: orderId,
          delivery_status: isCancelled ? 'cancelled' : (isDelivered ? 'delivered' : 'other'),
          delivery_date: deliveryDate,
          delivery_date_parsed: deliveryDateParsed ? deliveryDateParsed.toISOString() : null,
          captured_at: new Date().toISOString()
        });
      });
    } catch (err) {
      console.error(`[Into the Grape Vine] Error on order card ${index}:`, err);
    }
  });

  console.log(`[Into the Grape Vine] Extracted ${results.length} order items.`);
  return results;
}

(function main() {
  if (!isYourOrdersPage()) return; // from utils.js

  // Auto-extract on page load (after a short delay for dynamic content)
  setTimeout(() => {
    const data = extractAccountOrders();
    if (data.length) chrome.runtime.sendMessage({ action: 'ACCOUNT_ORDERS_CAPTURED', data });
  }, 1500);
})();

// Listen for manual extraction trigger from popup
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action !== 'MANUAL_EXTRACT_ORDERS') return;

  if (!isYourOrdersPage()) { // from utils.js
    sendResponse({ ok: false, reason: 'Navigate to amazon.com/order-history first.' });
    return;
  }

  const data = extractAccountOrders();
  chrome.runtime.sendMessage({ action: 'ACCOUNT_ORDERS_CAPTURED', data });
  sendResponse({ ok: true, count: data.length });
});
