/**
 * background.js
 * Background service worker that manages data storage and message routing.
 * Runs persistently in the browser to handle messages from content scripts and popup.
 *
 * Responsibilities:
 * - Deduplicate captured orders (by order_id/ASIN)
 * - Store Vine orders and account orders separately
 * - Route messages between content scripts and popup
 * - Fetch product prices with the user's own Amazon session
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

  if (message.action === 'FETCH_PRODUCT_PRICES') {
    fetchProductPrices(message)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

// ---------------------------------------------------------------------------
// Product prices
// ---------------------------------------------------------------------------

const BACKEND_URL = 'http://localhost:8000';
const PRICE_FETCH_DELAY_MS = 2000;

const PRICE_PATTERNS = [
  /<span class="a-price-whole">(\d+)<\/span>[\s\S]*?<span class="a-price-fraction">(\d+)<\/span>/,
  /<span class="a-offscreen">\$(\d+\.\d+)<\/span>/,
  /"price":"(\d+\.\d+)"/,
  /<span id="priceblock_ourprice"[\s\S]*?>[\s\S]*?\$(\d+\.\d+)[\s\S]*?<\/span>/,
];

const BOT_CHECK_MARKERS = ['validateCaptcha', 'Robot Check', 'api-services-support@amazon.com'];

/** Read a price from product page HTML. Returns { price } or { reason, botCheck }. */
function parseProductPrice(html) {
  for (const pattern of PRICE_PATTERNS) {
    const match = html.match(pattern);
    if (!match) continue;
    const text = match[2] ? `${match[1]}.${match[2]}` : match[1];
    const price = parseFloat(text);
    if (!Number.isNaN(price)) return { price };
  }
  if (BOT_CHECK_MARKERS.some((marker) => html.includes(marker))) {
    return { reason: 'Amazon showed a bot check', botCheck: true };
  }
  if (/currently unavailable/i.test(html)) {
    return { reason: 'currently unavailable' };
  }
  return { reason: 'no price on page' };
}

async function postJson(path, body) {
  const response = await fetch(`${BACKEND_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || `Backend returned HTTP ${response.status}`);
  }
  return response.json();
}

/** Tell the popup what is happening. The popup may be closed, so ignore errors. */
function reportPriceProgress(text) {
  console.log(`[Into the Grape Vine] ${text}`);
  chrome.runtime.sendMessage({ action: 'PRICE_FETCH_PROGRESS', text }).catch(() => {});
}

/** Ask the backend which rows need prices, read each product page, then save the prices. */
async function fetchProductPrices({ dryRun, daysBack, maxItems }) {
  const query = new URLSearchParams({ days_back: daysBack, max_items: maxItems });
  console.log(`[Into the Grape Vine] Price fetch started (dry run: ${dryRun})`);
  const { targets } = await postJson(`/price-targets?${query}`);
  if (!targets.length) return { ok: true, total: 0, found: [], missing: [] };

  const found = [];
  const missing = [];
  let stoppedByBotCheck = false;

  for (const [i, target] of targets.entries()) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, PRICE_FETCH_DELAY_MS));
    reportPriceProgress(`Price ${i + 1}/${targets.length}: ${target.name.slice(0, 40)}`);

    let result;
    try {
      const page = await fetch(`https://www.amazon.com/dp/${target.asin}`, { credentials: 'include' });
      result = page.ok ? parseProductPrice(await page.text()) : { reason: `HTTP ${page.status}` };
    } catch (err) {
      result = { reason: err.message };
    }

    // Show each result in the server terminal too. A failed log call must not stop the run.
    postJson('/price-progress', {
      index: i + 1,
      total: targets.length,
      asin: target.asin,
      name: target.name,
      price: result.price ?? null,
      reason: result.reason ?? null,
    }).catch(() => {});

    if (result.price !== undefined) {
      found.push({ asin: target.asin, price: result.price, name: target.name });
      console.log(`[Into the Grape Vine] ✓ ${target.asin} $${result.price} - ${target.name}`);
    } else {
      missing.push({ asin: target.asin, reason: result.reason, name: target.name });
      console.warn(`[Into the Grape Vine] ✗ ${target.asin} ${result.reason} - ${target.name}`);
    }

    // Once Amazon shows a bot check, the next pages will show it too
    if (result.botCheck) {
      console.warn('[Into the Grape Vine] Stopping: Amazon showed a bot check');
      stoppedByBotCheck = true;
      break;
    }
  }

  const prices = found.map(({ asin, price }) => ({ asin, price }));
  const { saved } = await postJson(`/save-prices?dry_run=${dryRun}`, { prices });
  return { ok: true, total: targets.length, found, missing, saved, stoppedByBotCheck };
}

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
