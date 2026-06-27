/**
 * background.js
 * Background service worker that manages data storage and message routing.
 * Runs persistently in the browser to handle messages from content scripts and popup.
 *
 * Responsibilities:
 * - Deduplicate captured orders (by order_id/ASIN)
 * - Store Vine orders and account orders separately
 * - Route messages between content scripts and popup
 */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'VINE_ORDERS_CAPTURED') {
    handleVineOrdersCaptured(message.data);
    sendResponse({ ok: true });
  }

  if (message.action === 'ACCOUNT_ORDERS_CAPTURED') {
    handleAccountOrdersCaptured(message.data);
    sendResponse({ ok: true });
  }

  if (message.action === 'GET_VINE_ORDERS') {
    chrome.storage.local.get(['vineOrders'], (r) => {
      sendResponse({ orders: r.vineOrders ?? [] });
    });
    return true; // keep channel open for async response
  }

  if (message.action === 'GET_ACCOUNT_ORDERS') {
    chrome.storage.local.get(['accountOrders'], (r) => {
      sendResponse({ orders: r.accountOrders ?? [] });
    });
    return true;
  }

  if (message.action === 'CLEAR_VINE_ORDERS') {
    chrome.storage.local.set({ vineOrders: [] }, () => sendResponse({ ok: true }));
    return true;
  }

  if (message.action === 'CLEAR_ACCOUNT_ORDERS') {
    chrome.storage.local.set({ accountOrders: [] }, () => sendResponse({ ok: true }));
    return true;
  }
});

async function handleVineOrdersCaptured(newOrders) {
  const existing = await getVineOrders();
  const existingKeys = new Set(existing.map((o) => o.order_id ?? o.asin));
  const fresh = newOrders.filter((o) => !existingKeys.has(o.order_id ?? o.asin));

  if (!fresh.length) {
    console.log('[Into the Grape Vine] No new Vine orders — all already captured.');
    return;
  }

  const merged = [...fresh, ...existing].sort(
    (a, b) => (b.order_timestamp ?? 0) - (a.order_timestamp ?? 0)
  );

  await setVineOrders(merged);
  console.log(`[Into the Grape Vine] +${fresh.length} new Vine orders. Total: ${merged.length}.`);
}

async function handleAccountOrdersCaptured(newOrders) {
  const existing = await getAccountOrders();
  const existingKeys = new Set(existing.map((o) => o.asin ?? o.order_id));
  const fresh = newOrders.filter((o) => !existingKeys.has(o.asin ?? o.order_id));

  if (!fresh.length) {
    console.log('[Into the Grape Vine] No new account orders — all already captured.');
    return;
  }

  const merged = [...fresh, ...existing];
  await setAccountOrders(merged);
  console.log(`[Into the Grape Vine] +${fresh.length} new account orders. Total: ${merged.length}.`);
}

function getVineOrders() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['vineOrders'], (r) => resolve(r.vineOrders ?? []));
  });
}

function setVineOrders(orders) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ vineOrders: orders }, resolve);
  });
}

function getAccountOrders() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['accountOrders'], (r) => resolve(r.accountOrders ?? []));
  });
}

function setAccountOrders(orders) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ accountOrders: orders }, resolve);
  });
}
