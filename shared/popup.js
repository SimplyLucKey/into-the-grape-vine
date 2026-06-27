/**
 * popup.js
 * Handles the extension popup: detects current page, triggers extraction,
 * and renders the captured orders queue.
 */

const statusEl          = document.getElementById('status');
const countEl           = document.getElementById('queue-count');
const listEl            = document.getElementById('order-list');
const accountCountEl    = document.getElementById('account-count');
const accountListEl     = document.getElementById('account-list');
const hintEl            = document.getElementById('page-hint');
const syncProgressEl    = document.getElementById('sync-progress');
const settingsToggle    = document.getElementById('settings-toggle');
const settingsPanel     = document.getElementById('settings-panel');
const dropboxTokenInput = document.getElementById('dropbox-token');
const dropboxPathInput  = document.getElementById('dropbox-path');
const btnExtract        = document.getElementById('btn-extract');
const btnClear          = document.getElementById('btn-clear');
const btnExtractOrders  = document.getElementById('btn-extract-orders');
const btnClearOrders    = document.getElementById('btn-clear-orders');
const btnSaveSettings   = document.getElementById('btn-save-settings');
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
    btnExtract.disabled = true;
  } else {
    setStatus('Go to /vine/orders or /order-history to extract.', 'error');
    btnExtract.disabled = true;
    btnExtractOrders.disabled = true;
  }

  await loadQueue();
  await loadAccountOrders();
  await loadSettings();
})();

// Settings toggle
settingsToggle.addEventListener('click', () => {
  settingsPanel.classList.toggle('visible');
});

// Load settings
async function loadSettings() {
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

btnExtract.addEventListener('click', async () => {
  btnExtract.disabled = true;
  btnExtract.textContent = 'Extracting…';
  setStatus('');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { action: 'MANUAL_EXTRACT' });
    if (res?.ok) setStatus(`Captured ${res.count} orders.`, 'success');
    else setStatus(res?.reason ?? 'Nothing to extract.', 'error');
  } catch {
    setStatus('Could not reach the page — try refreshing vine/orders.', 'error');
  }

  await loadQueue();
  btnExtract.disabled = false;
  btnExtract.textContent = 'Extract this page';
});

btnClear.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ action: 'CLEAR_QUEUE' });
  await loadQueue();
  setStatus('Vine queue cleared.');
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

async function loadQueue() {
  const { orders = [] } = await chrome.runtime.sendMessage({ action: 'GET_QUEUE' });
  countEl.textContent = orders.length;

  if (!orders.length) {
    listEl.innerHTML = '<div class="empty">Nothing captured yet.</div>';
    return;
  }

  listEl.innerHTML = orders.map((o) => `
    <div class="order-row">
      <img class="order-thumb" src="${escapeHtml(o.thumbnail ?? '')}" alt="">
      <div class="order-info">
        <div class="order-name" title="${escapeHtml(o.name ?? '')}">${escapeHtml(o.name ?? o.asin ?? 'Unknown')}</div>
        <div class="order-meta">
          ${o.fmv != null ? '$' + o.fmv.toFixed(2) : '—'} · ${o.order_date ?? '—'} · ${o.order_id ?? '—'}
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

  accountListEl.innerHTML = orders.map((o) => `
    <div class="order-row">
      <div class="order-info">
        <div class="order-name" title="${escapeHtml(o.name ?? '')}">${escapeHtml(o.name ?? o.asin ?? 'Unknown')}</div>
        <div class="order-meta">
          ${o.asin ?? '—'} · ${o.delivery_status ?? '—'} ${o.delivery_date ? '(' + o.delivery_date + ')' : ''}
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
