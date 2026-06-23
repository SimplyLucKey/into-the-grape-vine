/**
 * popup.js
 * Handles the extension popup: detects current page, triggers extraction,
 * and renders the captured orders queue.
 */

const statusEl   = document.getElementById('status');
const countEl    = document.getElementById('queue-count');
const listEl     = document.getElementById('order-list');
const hintEl     = document.getElementById('page-hint');
const btnExtract = document.getElementById('btn-extract');
const btnClear   = document.getElementById('btn-clear');

(async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url ?? '';

  if (url.includes('/vine/orders')) {
    setStatus('On Vine orders — ready to extract.');
    hintEl.textContent = 'Shows 10 orders per page. Paginate and extract each page to capture older orders.';
  } else {
    setStatus('Go to amazon.com/vine/orders to extract.', 'error');
    btnExtract.disabled = true;
  }

  await loadQueue();
})();

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
  setStatus('Queue cleared.');
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

function setStatus(msg, type = '') {
  statusEl.textContent = msg;
  statusEl.className = 'status' + (type ? ` ${type}` : '');
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
