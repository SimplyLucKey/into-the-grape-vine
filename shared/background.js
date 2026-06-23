/**
 * background.js
 * Receives captured orders, deduplicates by order_id, and stores them locally.
 * Acts as the data queue between extraction and future Dropbox sync.
 */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'DATA_CAPTURED') {
    handleCapturedData(message.data);
    sendResponse({ ok: true });
  }

  if (message.action === 'GET_QUEUE') {
    chrome.storage.local.get(['capturedOrders'], (r) => {
      sendResponse({ orders: r.capturedOrders ?? [] });
    });
    return true; // keep channel open for async response
  }

  if (message.action === 'CLEAR_QUEUE') {
    chrome.storage.local.set({ capturedOrders: [] }, () => sendResponse({ ok: true }));
    return true;
  }
});

async function handleCapturedData(newOrders) {
  const existing = await getQueue();
  const existingKeys = new Set(existing.map((o) => o.order_id ?? o.asin));
  const fresh = newOrders.filter((o) => !existingKeys.has(o.order_id ?? o.asin));

  if (!fresh.length) {
    console.log('[Into the Grape Vine] No new orders — all already captured.');
    return;
  }

  const merged = [...fresh, ...existing].sort(
    (a, b) => (b.order_timestamp ?? 0) - (a.order_timestamp ?? 0)
  );

  await setQueue(merged);
  console.log(`[Into the Grape Vine] +${fresh.length} new orders. Total: ${merged.length}.`);
}

function getQueue() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['capturedOrders'], (r) => resolve(r.capturedOrders ?? []));
  });
}

function setQueue(orders) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ capturedOrders: orders }, resolve);
  });
}
