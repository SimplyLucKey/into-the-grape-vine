/**
 * background.js — Into the Grape Vine
 *
 * Phase 1 responsibilities:
 *   - Receive DATA_CAPTURED messages from content.js
 *   - Merge incoming orders into the local queue, deduped by order_id
 *   - Serve the queue to the popup on request
 *
 * Phase 3 will add:
 *   - Dropbox API calls to write to your Excel file
 *   - Alarm-based daily/weekly scheduler
 */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'DATA_CAPTURED') {
    handleCapturedData(message.data);
    sendResponse({ ok: true });
  }

  if (message.action === 'GET_QUEUE') {
    chrome.storage.local.get(['capturedOrders'], (result) => {
      sendResponse({ orders: result.capturedOrders ?? [] });
    });
    return true; // keep message channel open for async response
  }

  if (message.action === 'CLEAR_QUEUE') {
    chrome.storage.local.set({ capturedOrders: [] }, () => {
      sendResponse({ ok: true });
    });
    return true;
  }
});

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

async function handleCapturedData(newOrders) {
  const existing = await getQueue();

  // Deduplicate by order_id — if it's already in the queue, skip it.
  // Falls back to ASIN if order_id is null for some reason.
  const existingKeys = new Set(
    existing.map((o) => o.order_id ?? o.asin)
  );

  const fresh = newOrders.filter(
    (o) => !existingKeys.has(o.order_id ?? o.asin)
  );

  if (fresh.length === 0) {
    console.log('[Into the Grape Vine] No new orders to add — all already in queue.');
    return;
  }

  // Newest orders first
  const merged = [...fresh, ...existing].sort(
    (a, b) => (b.order_timestamp ?? 0) - (a.order_timestamp ?? 0)
  );

  await setQueue(merged);
  console.log(
    `[Into the Grape Vine] Added ${fresh.length} new orders. ` +
    `Total in queue: ${merged.length}.`
  );
}

function getQueue() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['capturedOrders'], (r) => {
      resolve(r.capturedOrders ?? []);
    });
  });
}

function setQueue(orders) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ capturedOrders: orders }, resolve);
  });
}
