/**
 * popup.js
 * UI logic for the extension popup window (opened when clicking the 🍇 icon).
 *
 * Responsibilities:
 * - Detect current page and enable/disable appropriate buttons
 * - Trigger manual extraction of Vine orders or account orders
 * - Display captured orders in lists
 * - Handle Dropbox settings configuration
 * - Trigger one-click sync to Dropbox
 */

// Status and hints
const statusEl          = document.getElementById('status');
const hintEl            = document.getElementById('page-hint');
const syncProgressEl    = document.getElementById('sync-progress');

// Vine orders section
const vineCountEl       = document.getElementById('queue-count');
const vineListEl        = document.getElementById('order-list');
const btnExtractVine    = document.getElementById('btn-extract');
const btnClearVine      = document.getElementById('btn-clear');

// Account orders section
const accountCountEl    = document.getElementById('account-count');
const accountListEl     = document.getElementById('account-list');
const btnExtractOrders  = document.getElementById('btn-extract-orders');
const btnClearOrders    = document.getElementById('btn-clear-orders');

// Sync buttons
const btnSync           = document.getElementById('btn-sync');
const btnSyncDryRun     = document.getElementById('btn-sync-dryrun');

// Product price fetch buttons and settings
const btnProductPrices         = document.getElementById('btn-product-prices');
const btnProductPricesDryRun   = document.getElementById('btn-product-prices-dryrun');
const productPricesProgressEl  = document.getElementById('product-prices-progress');
const daysBackInput            = document.getElementById('days-back');
const maxItemsInput            = document.getElementById('max-items');

// Tab switching
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tabName = btn.dataset.tab;

    // Update active tab button
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // Update active tab content
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    document.getElementById(`tab-${tabName}`).classList.add('active');
  });
});

(async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url ?? '';

  const isVine = url.includes('/vine/orders');
  const isOrders = url.includes('/your-orders') || url.includes('/order-history');

  if (isVine) {
    setStatus('On Vine orders — ready to extract.');
    hintEl.textContent = 'Shows 10 orders per page. Paginate and extract each page to capture older orders.';
    btnExtractOrders.disabled = true;
    // Switch to Vine tab
    document.querySelector('.tab-btn[data-tab="vine"]').click();
  } else if (isOrders) {
    setStatus('On account orders — ready to extract.');
    btnExtractVine.disabled = true;
    // Switch to Account tab
    document.querySelector('.tab-btn[data-tab="account"]').click();
  } else {
    setStatus('Go to /vine/orders or /order-history to extract.', 'error');
    btnExtractVine.disabled = true;
    btnExtractOrders.disabled = true;
  }

  await loadVineOrders();
  await loadAccountOrders();
})();

btnExtractVine.addEventListener('click', async () => {
  btnExtractVine.disabled = true;
  btnExtractVine.textContent = 'Extracting…';
  setStatus('');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { action: 'MANUAL_EXTRACT_VINE' });
    if (res?.ok) setStatus(`Captured ${res.count} Vine orders.`, 'success');
    else setStatus(res?.reason ?? 'Nothing to extract.', 'error');
  } catch {
    setStatus('Could not reach the page — try refreshing vine/orders.', 'error');
  }

  await loadVineOrders();
  btnExtractVine.disabled = false;
  btnExtractVine.textContent = 'Extract Vine Orders';
});

btnClearVine.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ action: 'CLEAR_VINE_ORDERS' });
  await loadVineOrders();
  setStatus('Vine orders cleared.');
});

btnExtractOrders.addEventListener('click', async () => {
  btnExtractOrders.disabled = true;
  btnExtractOrders.textContent = 'Extracting…';
  setStatus('');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { action: 'MANUAL_EXTRACT_ORDERS' });
    if (res?.ok) setStatus(`Captured ${res.count} account orders.`, 'success');
    else setStatus(res?.reason ?? 'Nothing to extract.', 'error');
  } catch {
    setStatus('Could not reach the page — try refreshing /your-orders.', 'error');
  }

  await loadAccountOrders();
  btnExtractOrders.disabled = false;
  btnExtractOrders.textContent = 'Extract Account Orders';
});

btnClearOrders.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ action: 'CLEAR_ACCOUNT_ORDERS' });
  await loadAccountOrders();
  setStatus('Account orders cleared.');
});

// Helper function for sync (supports dry-run)
async function performSync(dryRun = false) {
  const { orders = [] } = await chrome.runtime.sendMessage({ action: 'GET_ACCOUNT_ORDERS' });

  if (!orders.length) {
    setStatus('No account orders to sync. Extract some orders first.', 'error');
    return;
  }

  const activeBtn = dryRun ? btnSyncDryRun : btnSync;
  const otherBtn = dryRun ? btnSync : btnSyncDryRun;

  activeBtn.disabled = true;
  otherBtn.disabled = true;
  activeBtn.textContent = dryRun ? '⏳ Previewing...' : '⏳ Syncing...';
  setStatus('');
  syncProgressEl.textContent = 'Connecting to backend...';

  try {
    const url = `http://localhost:8000/sync-delivery-dates${dryRun ? '?dry_run=true' : ''}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account_orders: orders }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Sync failed');
    }

    const result = await response.json();

    if (result.filled === 0 && result.cancelled === 0) {
      setStatus('No updates needed — all delivery dates already filled.', 'success');
    } else {
      let prefix = dryRun ? 'Preview: Would fill' : 'Synced!';
      let message = `${prefix} ${result.filled} delivery dates`;
      if (result.cancelled > 0) {
        message += `, ${result.cancelled} cancelled items found`;
      }
      setStatus(message, 'success');

      if (result.changes?.length > 0) {
        console.log('[Into the Grape Vine] Changes:', result.changes);
      }
      if (result.cancelled_items?.length > 0) {
        console.log('[Into the Grape Vine] Cancelled items:', result.cancelled_items);
      }
    }
    syncProgressEl.textContent = '';
  } catch (err) {
    if (err.message.includes('fetch')) {
      setStatus('Backend not running. Start server: ./start-server.sh', 'error');
    } else {
      setStatus(`Sync failed: ${err.message}`, 'error');
    }
    syncProgressEl.textContent = '';
    console.error('[Into the Grape Vine] Sync error:', err);
  }

  activeBtn.disabled = false;
  otherBtn.disabled = false;
  activeBtn.textContent = dryRun ? '🔍 Preview Changes' : '🔄 Sync to Dropbox';
}

// Dry-run sync (preview only)
btnSyncDryRun.addEventListener('click', () => performSync(true));

// Real sync
btnSync.addEventListener('click', () => performSync(false));

// Helper function for product price fetching
async function fetchProductPrices(dryRun = false) {
  const activeBtn = dryRun ? btnProductPricesDryRun : btnProductPrices;
  const otherBtn = dryRun ? btnProductPrices : btnProductPricesDryRun;

  activeBtn.disabled = true;
  otherBtn.disabled = true;
  activeBtn.textContent = dryRun ? '⏳ Checking...' : '⏳ Fetching...';
  setStatus('');
  productPricesProgressEl.textContent = 'Connecting to backend...';

  try {
    // Get user settings
    const daysBack = parseInt(daysBackInput.value, 10);
    const maxItems = parseInt(maxItemsInput.value, 10);

    const params = new URLSearchParams({
      dry_run: dryRun.toString(),
      days_back: daysBack.toString(),
      max_items: maxItems.toString(),
    });

    const url = `http://localhost:8000/fetch-product-prices?${params}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Product price fetch failed');
    }

    const result = await response.json();

    if (result.fetched === 0 && result.failed === 0 && result.skipped === 0) {
      setStatus('All items already have product prices!', 'success');
    } else if (dryRun) {
      setStatus(`Preview: Would fetch product prices for ${result.skipped} items`, 'success');
    } else {
      let message = `Fetched ${result.fetched} product prices`;
      if (result.failed > 0) {
        message += `, ${result.failed} failed`;
      }
      setStatus(message, 'success');
    }
    productPricesProgressEl.textContent = '';
  } catch (err) {
    if (err.message.includes('fetch')) {
      setStatus('Backend not running. Start server: ./start-server.sh', 'error');
    } else {
      setStatus(`Product price fetch failed: ${err.message}`, 'error');
    }
    productPricesProgressEl.textContent = '';
    console.error('[Into the Grape Vine] Product price fetch error:', err);
  }

  activeBtn.disabled = false;
  otherBtn.disabled = false;
  activeBtn.textContent = dryRun ? '🔍 Preview' : '💰 Fetch Prices';
}

// Product price fetch buttons
btnProductPricesDryRun.addEventListener('click', () => fetchProductPrices(true));
btnProductPrices.addEventListener('click', () => fetchProductPrices(false));

async function loadVineOrders() {
  const { orders = [] } = await chrome.runtime.sendMessage({ action: 'GET_VINE_ORDERS' });
  vineCountEl.textContent = orders.length;

  if (!orders.length) {
    vineListEl.innerHTML = '<div class="empty">Nothing captured yet.</div>';
    return;
  }

  vineListEl.innerHTML = orders.map((vineOrder) => `
    <div class="order-row">
      <img class="order-thumb" src="${escapeHtml(vineOrder.thumbnail ?? '')}" alt="">
      <div class="order-info">
        <div class="order-name" title="${escapeHtml(vineOrder.name ?? '')}">${escapeHtml(vineOrder.name ?? vineOrder.asin ?? 'Unknown')}</div>
        <div class="order-meta">
          ${vineOrder.fmv != null ? '$' + vineOrder.fmv.toFixed(2) : '—'} · ${vineOrder.order_date ?? '—'} · ${vineOrder.order_id ?? '—'}
        </div>
      </div>
    </div>`).join('');
}

async function loadAccountOrders() {
  const { orders = [] } = await chrome.runtime.sendMessage({ action: 'GET_ACCOUNT_ORDERS' });
  accountCountEl.textContent = orders.length;

  if (!orders.length) {
    accountListEl.innerHTML = '<div class="empty">Nothing captured yet.</div>';
    return;
  }

  accountListEl.innerHTML = orders.map((accountOrder) => `
    <div class="order-row">
      <div class="order-info">
        <div class="order-name" title="${escapeHtml(accountOrder.name ?? '')}">${escapeHtml(accountOrder.name ?? accountOrder.asin ?? 'Unknown')}</div>
        <div class="order-meta">
          ${accountOrder.asin ?? '—'} · ${accountOrder.delivery_status ?? '—'} ${accountOrder.delivery_date ? '(' + accountOrder.delivery_date + ')' : ''}
        </div>
      </div>
    </div>`).join('');
}

function setStatus(msg, type = '') {
  statusEl.textContent = msg;
  statusEl.className = 'status' + (type ? ` ${type}` : '');
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
