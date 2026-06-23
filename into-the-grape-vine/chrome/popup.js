/**
 * popup.js — Into the Grape Vine
 */

const statusEl   = document.getElementById('status');
const countEl    = document.getElementById('queue-count');
const listEl     = document.getElementById('order-list');
const hintEl     = document.getElementById('page-hint');
const btnExtract = document.getElementById('btn-extract');
const btnClear   = document.getElementById('btn-clear');

// ---------------------------------------------------------------------------
// Init — detect current tab and load queue on open
// ---------------------------------------------------------------------------

(async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url ?? '';

  if (url.includes('/vine/orders')) {
    setStatus('On Vine orders page — ready to extract.');
    hintEl.textContent =
      'Tip: the page shows 10 orders at a time. Extract each page ' +
      'separately, then paginate to capture older orders.';
  } else {
    setStatus('Navigate to amazon.com/vine/orders to extract.', 'error');
    btnExtract.disabled = true;
  }

  await loadQueue();
})();

// ---------------------------------------------------------------------------
// Extract button
// ---------------------------------------------------------------------------

btnExtract.addEventListener('click', async () => {
  btnExtract.disabled = true;
  btnExtract.textContent = 'Extracting…';
  setStatus('');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      action: 'MANUAL_EXTRACT',
    });

    if (response?.ok) {
      setStatus(`Captured ${response.count} orders from this page.`, 'success');
    } else {
      setStatus(response?.reason ?? 'Nothing to extract here.', 'error');
    }
  } catch {
    setStatus(
      'Could not reach the page script — try refreshing amazon.com/vine/orders.',
      'error'
    );
  }

  await loadQueue();
  btnExtract.disabled = false;
  btnExtract.textContent = 'Extract this page';
});

// ---------------------------------------------------------------------------
// Clear button
// ---------------------------------------------------------------------------

btnClear.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ action: 'CLEAR_QUEUE' });
  await loadQueue();
  setStatus('Queue cleared.');
});

// ---------------------------------------------------------------------------
// Render queue
// ---------------------------------------------------------------------------

async function loadQueue() {
  const response = await chrome.runtime.sendMessage({ action: 'GET_QUEUE' });
  const orders = response?.orders ?? [];

  countEl.textContent = orders.length;

  if (orders.length === 0) {
    listEl.innerHTML = '<div class="empty">Nothing captured yet.</div>';
    return;
  }

  listEl.innerHTML = orders.map((o) => {
    const fmv  = o.fmv != null ? `$${o.fmv.toFixed(2)}` : '—';
    const date = o.order_date ?? '—';
    const name = escapeHtml(o.name ?? o.asin ?? 'Unknown product');
    const img  = o.thumbnail
      ? `<img class="order-thumb" src="${escapeHtml(o.thumbnail)}" alt="">`
      : `<div class="order-thumb" style="background:#f5f5f5;"></div>`;

    return `
      <div class="order-row">
        ${img}
        <div class="order-info">
          <div class="order-name" title="${name}">${name}</div>
          <div class="order-meta">FMV ${fmv} · ${date} · ${o.order_id ?? '—'}</div>
        </div>
      </div>`;
  }).join('');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setStatus(msg, type = '') {
  statusEl.textContent = msg;
  statusEl.className = 'status' + (type ? ` ${type}` : '');
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
