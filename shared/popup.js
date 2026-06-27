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

// Dropbox settings
const settingsToggle    = document.getElementById('settings-toggle');
const settingsPanel     = document.getElementById('settings-panel');
const dropboxTokenInput = document.getElementById('dropbox-token'); // References <input id="dropbox-token">
const dropboxPathInput  = document.getElementById('dropbox-path');  // References <input id="dropbox-path">
const btnSaveSettings   = document.getElementById('btn-save-settings');

// Sync button
const btnSync           = document.getElementById('btn-sync');

(async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url ?? '';

  const isVine = url.includes('/vine/orders');
  const isOrders = url.includes('/your-orders') || url.includes('/order-history');

  if (isVine) {
    setStatus('On Vine orders — ready to extract.');
    hintEl.textContent = 'Shows 10 orders per page. Paginate and extract each page to capture older orders.';
    btnExtractOrders.disabled = true;
  } else if (isOrders) {
    setStatus('On account orders — ready to extract.');
    hintEl.textContent = 'Shows 10 orders per page. Paginate and extract each page to capture delivery dates.';
    btnExtractVine.disabled = true;
  } else {
    setStatus('Go to /vine/orders or /order-history to extract.', 'error');
    btnExtractVine.disabled = true;
    btnExtractOrders.disabled = true;
  }

  await loadVineOrders();
  await loadAccountOrders();
  await loadDropboxSettings();
})();

// Settings toggle
settingsToggle.addEventListener('click', () => {
  settingsPanel.classList.toggle('visible');
});

// Load Dropbox settings from storage
async function loadDropboxSettings() {
  const settings = await getDropboxSettings();
  if (settings.token) dropboxTokenInput.value = settings.token;
  if (settings.filePath) dropboxPathInput.value = settings.filePath;
}

// Save settings
btnSaveSettings.addEventListener('click', async () => {
  const token = dropboxTokenInput.value.trim();
  const path = dropboxPathInput.value.trim();

  if (!token || !path) {
    setStatus('Please fill in both Dropbox token and file path.', 'error');
    return;
  }

  await saveDropboxSettings(token, path);
  setStatus('Dropbox settings saved!', 'success');
  settingsPanel.classList.remove('visible');
});

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

// Sync to Dropbox
btnSync.addEventListener('click', async () => {
  const { orders = [] } = await chrome.runtime.sendMessage({ action: 'GET_ACCOUNT_ORDERS' });

  if (!orders.length) {
    setStatus('No account orders to sync. Extract some orders first.', 'error');
    return;
  }

  btnSync.disabled = true;
  btnSync.textContent = '⏳ Syncing...';
  setStatus('');
  syncProgressEl.textContent = '';

  try {
    const result = await syncDeliveryDates(orders, (progress) => {
      syncProgressEl.textContent = progress;
    });

    if (result.filled === 0 && result.cancelled === 0) {
      setStatus('No updates needed — all delivery dates already filled.', 'success');
    } else {
      let message = `Synced! ${result.filled} delivery dates filled`;
      if (result.cancelled > 0) {
        message += `, ${result.cancelled} cancelled items found`;
      }
      setStatus(message, 'success');

      if (result.cancelledItems.length > 0) {
        console.log('[Into the Grape Vine] Cancelled items:', result.cancelledItems);
      }
    }
    syncProgressEl.textContent = '';
  } catch (err) {
    setStatus(`Sync failed: ${err.message}`, 'error');
    syncProgressEl.textContent = '';
    console.error('[Into the Grape Vine] Sync error:', err);
  }

  btnSync.disabled = false;
  btnSync.textContent = '🔄 Sync Delivery Dates to Dropbox';
});

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
