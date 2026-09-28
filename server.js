const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createJsonStore } = require('./lib/json-store');
const { deleteInvoice } = require('./lib/delete-invoice');
const { applyWeightOnlyStockFlow: applyStockFlow } = require('./lib/stock-flow');

const root = __dirname;
// The browser development server always uses the familiar local address.
// Electron deliberately passes PORT=0 so each desktop launch can use a free port.
const port = process.env.PORT === '0' ? 0 : 3000;
const host = process.env.HOST || '127.0.0.1';
const sourceHtml = process.env.SOURCE_HTML || path.join(root, 'source', 'index.html');
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
const dataFile = path.join(dataDir, 'store.json');
const serverVersion = String(Date.now());
const jsonStore = createJsonStore(dataFile, { encryptionKey: process.env.DATA_ENCRYPTION_KEY });
// Local fallback for this single-user installation. An environment value overrides it when provided.
const goldApiKey = process.env.GOLD_API_KEY || 'goldapi-779c2b0275441b53d934d5ec80fa127f-io';
let liveRatesCache = null;

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

async function getLiveMetalRates(forceRefresh = false) {
  if (!goldApiKey) throw new Error('Live rates are not configured');
  if (!forceRefresh && liveRatesCache && Date.now() - liveRatesCache.fetchedAt < 60_000) return liveRatesCache.value;
  const headers = { 'x-access-token': goldApiKey, 'content-type': 'application/json' };
  const [goldResponse, silverResponse] = await Promise.all([
    fetch('https://www.goldapi.io/api/XAU/INR', { headers }),
    fetch('https://www.goldapi.io/api/XAG/INR', { headers })
  ]);
  if (!goldResponse.ok || !silverResponse.ok) throw new Error('Live rate provider is unavailable');
  const [gold, silver] = await Promise.all([goldResponse.json(), silverResponse.json()]);
  const perGram = rate => Number(rate.price_gram_24k || rate.price_gram || (Number(rate.price) / 31.1034768));
  const value = {
    goldPerGram: perGram(gold),
    silverPerGram: perGram(silver),
    updatedAt: gold.updatedAt || gold.timestamp || new Date().toISOString()
  };
  if (!Number.isFinite(value.goldPerGram) || !Number.isFinite(value.silverPerGram)) throw new Error('Live rate provider returned invalid data');
  liveRatesCache = { fetchedAt: Date.now(), value };
  return value;
}

function applyWeightOnlyStockFlow(html) {
  const stockOptions = [
    'function stockOptionsHtml(selectedId, rowId){',
    "  const opts = ['<option value=\"\">— select a stock item —</option>'];",
    '  stockList.forEach(s=>{',
    '    const remainingNet = parseFloat(s.net)||0;',
    '    if(remainingNet <= 0 && s.id !== selectedId) return;',
    '    opts.push(`<option value="${s.id}" ${s.id===selectedId?\'selected\':\'\'}>${escapeHtml(s.item)} · ${s.purity} · ${fmtWt(s.net)}g remaining</option>`);',
    '  });',
    "  return opts.join('');",
    '}',
    '',
    'function renderRowsTable()'
  ].join('\n');
  const completeSale = [
    "document.getElementById('btnCompleteSale').addEventListener('click', async ()=>{",
    '  if(saleCompleted) return;',
    "  const customerInput = document.getElementById('cust-name');",
    "  if(!customerInput.value.trim()){ toast('Customer name is required'); customerInput.focus(); return; }",
    "  if(rows.some(r => !r.stockId)){ toast('Select a stock item for every invoice row'); return; }",
    '  const linkedRows = rows.filter(r => r.stockId);',
    '  if(!linkedRows.length){',
    "    toast('Add at least one item from stock');",
    '    return;',
    '  }',
    '  for(const row of linkedRows){',
    '    if(!((parseFloat(row.gross) > 0) || (parseFloat(row.net) > 0)) || !(parseFloat(row.rate) > 0)){',
    "      toast('Enter a gross or net weight and rate for every stock item');",
    '      return;',
    '    }',
    '  }',
    '  const requested = new Map();',
    '  linkedRows.forEach(r=>{',
    '    const current = requested.get(r.stockId) || { gross:0, net:0, name:r.name };',
    '    current.gross += parseFloat(r.gross)||0;',
    '    current.net += parseFloat(r.net)||0;',
    '    requested.set(r.stockId, current);',
    '  });',
    '  for(const [stockId, requestedWeight] of requested){',
    '    const stock = stockList.find(x=>x.id===stockId);',
    '    if(!stock || requestedWeight.gross > (parseFloat(stock.gross)||0) + 0.0001 || requestedWeight.net > (parseFloat(stock.net)||0) + 0.0001){',
    "      toast('Not enough remaining weight for \"' + requestedWeight.name + '\"');",
    '      return;',
    '    }',
    '  }',
    '  requested.forEach((requestedWeight, stockId)=>{',
    '    const stock = stockList.find(x=>x.id===stockId);',
    '    stock.gross = Math.max((parseFloat(stock.gross)||0) - requestedWeight.gross, 0);',
    '    stock.net = Math.max((parseFloat(stock.net)||0) - requestedWeight.net, 0);',
    '    stock.qty = 1;',
    '  });',
    "  await storeSet('stock-list', stockList);",
    '  renderStockTable(); renderStockStats();',
    '  saleCompleted = true;',
    '  setSaleStatus();',
    '  // The invoice success modal is displayed after the record is saved.',
    '});',
    '',
    "document.getElementById('btnPrint')"
  ].join('\n');
  const renderStockStats = [
    'function renderStockStats(){',
    "  const goldStock = stockList.filter(stock => stock.purity !== 'Silver');",
    "  const silverStock = stockList.filter(stock => stock.purity === 'Silver');",
    '  const updateCard = (valueId, label, entries) => {',
    '    const weight = entries.reduce((sum, entry) => sum + (parseFloat(entry.gross)||0), 0);',
    '    const value = document.getElementById(valueId);',
    '    value.previousElementSibling.textContent = label;',
    "    value.innerHTML = fmtWt(weight) + ' g <small>' + entries.length + ' entries</small>';",
    '  };',
    "  updateCard('stat-count', 'Gold Entries', goldStock);",
    "  updateCard('stat-weight', 'Silver Entries', silverStock);",
    '}',
    '',
    'function renderStockTable()'
  ].join('\n');
  return html
    .replace(/function availableQtyFor\(stockEntry, excludingRowId\)\{[\s\S]*?\n\}\n\nfunction stockOptionsHtml/, "function availableQtyFor(stockEntry, excludingRowId){\n  return (parseFloat(stockEntry.net)||0) > 0 ? 1 : 0;\n}\n\nfunction stockOptionsHtml")
    .replace(/function stockOptionsHtml\(selectedId, rowId\)\{[\s\S]*?\n\}\n\nfunction renderRowsTable\(\)/, stockOptions)
    .replace('          row.gross = s.qty ? (s.gross / s.qty).toFixed(3) : s.gross;\n          row.net = s.qty ? (s.net / s.qty).toFixed(3) : s.net;', "          row.gross = '';\n          row.net = '';")
    .replace('class="f-stock">', 'class="f-stock" required>')
    .replace('class="f-name" value="${escapeHtml(r.name)}" placeholder="Item name">', 'class="f-name" value="${escapeHtml(r.name)}" placeholder="${window.orderMode ? \'Item name\' : \'Select from stock\'}" ${window.orderMode ? \'\' : \'readonly\'}>')
    .replace('class="f-hsn" value="${escapeHtml(r.hsn)}" style="width:56px;">', 'class="f-hsn" value="${escapeHtml(r.hsn)}" style="width:56px;" ${window.orderMode ? \'\' : \'readonly\'}>')
    .replace(/\$\{r\.stockId\?'readonly':''\}/g, '')
    .replace('<select class="f-purity">', '<select class="f-purity" ${r.stockId?\'disabled\':\'\'}>')
    .replace("tr.querySelector('.f-gross').addEventListener('input', e=>{ row.gross = e.target.value; renderRowsTable(); renderPreview(); });", "tr.querySelector('.f-gross').addEventListener('input', e=>{ row.gross = e.target.value; tr.querySelector('.amount-cell').textContent = '₹'+fmt(rowAmount(row)); renderPreview(); });")
    .replace("tr.querySelector('.f-net').addEventListener('input', e=>{ row.net = e.target.value; renderRowsTable(); renderPreview(); });", "tr.querySelector('.f-net').addEventListener('input', e=>{ row.net = e.target.value; tr.querySelector('.amount-cell').textContent = '₹'+fmt(rowAmount(row)); renderPreview(); });")
    .replace("tr.querySelector('.f-rate').addEventListener('input', e=>{ row.rate = e.target.value; renderRowsTable(); renderPreview(); });", "tr.querySelector('.f-rate').addEventListener('input', e=>{ row.rate = e.target.value; tr.querySelector('.amount-cell').textContent = '₹'+fmt(rowAmount(row)); renderPreview(); });")
    .replace("tr.querySelector('.f-making').addEventListener('input', e=>{ row.making = e.target.value; renderRowsTable(); renderPreview(); });", "tr.querySelector('.f-making').addEventListener('input', e=>{ row.making = e.target.value; tr.querySelector('.amount-cell').textContent = '₹'+fmt(rowAmount(row)); renderPreview(); });")
    .replace(/function renderStockStats\(\)\{[\s\S]*?\n\}\n\nfunction renderStockTable\(\)/, renderStockStats)
    .replace(/document\.getElementById\('btnCompleteSale'\)\.addEventListener\('click', async \(\)=>\{[\s\S]*?\n\}\);\n\ndocument\.getElementById\('btnPrint'\)/, completeSale);
}

function injectJsonStorage(html) {
  const pwaHead = '<link rel="manifest" href="/manifest.webmanifest"><meta name="theme-color" content="#17130d"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Vishesh Jewellers">';
  const adapter = `
<style>
/* Mobile refinement layer */
#page-stocks .row-3:has(#st-rate) {
  grid-template-columns: 1fr 1fr;
}
#page-stocks .field:has(#st-rate) {
  display: none;
}
#page-stocks .row-3:has(#st-qty) {
  grid-template-columns: 1fr 1fr;
}
#page-stocks .field:has(#st-qty) {
  display: none;
}
#page-stocks .stat-cards { grid-template-columns: repeat(2, 1fr); }
#page-dashboard .stat-cards { grid-template-columns: repeat(4, 1fr); }
#page-stocks .stat-card:nth-child(3) { display: none; }
#page-stocks .stat-card .val small { display: block; margin-top: 2px; font-family: var(--font-ui); font-size: 12px; font-weight: 500; color: var(--gold-light); }
#itemsTable th:nth-child(7), #itemsTable td:nth-child(7),
table.paper-items th:nth-child(7), table.paper-items td:nth-child(7),
#page-stocks .data-table th:nth-child(3), #page-stocks .data-table td:nth-child(3) {
  display: none;
}
#page-stocks .data-table th:nth-child(6), #page-stocks .data-table td:nth-child(6),
#page-stocks .data-table th:nth-child(7), #page-stocks .data-table td:nth-child(7) {
  display: none;
}
.record-detail > td { padding: 0 !important; }
.record-detail-card { padding: 18px; background: rgba(198,154,58,.06); border-top: 1px solid rgba(198,154,58,.22); }
.record-info-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 16px; }
.record-info { font-size: 13px; color: var(--ivory-2); }
.record-info b { display: block; color: var(--gold); font-size: 10px; letter-spacing: .08em; text-transform: uppercase; margin-bottom: 3px; }
.due-amount { color: #E8A99E; font-family: var(--font-mono); }
.paid-amount { color: #9CC7A2; font-family: var(--font-mono); }
.record-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: end; }
.record-actions .field { margin: 0; min-width: 170px; }
.record-paid:disabled { display: none; }
.record-actions:has(.record-method:disabled) .field:has(.record-method),
.record-actions:has(.record-method:disabled) [data-amount-field],
.record-actions:has(.record-method:disabled) [data-item-field],
.record-actions:has(.record-method:disabled) .record-settle { display: none; }
.voided-record { opacity: .62; }
.voided-badge { display: inline-block; margin-left: 7px; padding: 2px 6px; border-radius: 999px; background: rgba(232,169,158,.16); color: #E8A99E; font-size: 10px; font-weight: 700; letter-spacing: .06em; }
.voided-record + .record-detail .record-actions { display: none; }
.voided-invoice-view { margin-top: 14px; }
#invoicePaper > .voided-invoice-watermark { position: absolute; z-index: 3; inset: 0; display: flex; align-items: center; justify-content: center; color: rgba(164, 44, 35, .22); font-family: var(--font-display); font-size: 74px; font-weight: 800; letter-spacing: .14em; transform: rotate(-28deg); pointer-events: none; }
#invoicePaper > .pending-invoice-watermark { position: absolute; z-index: 3; inset: 0; display: flex; align-items: center; justify-content: center; color: rgba(198, 154, 58, .2); font-family: var(--font-display); font-size: 52px; font-weight: 800; letter-spacing: .1em; text-align:center; transform: rotate(-28deg); pointer-events: none; }
.pending-badge { display: inline-block; margin-left: 7px; padding: 2px 6px; border-radius: 999px; background: rgba(198,154,58,.16); color: var(--gold-light); font-size: 10px; font-weight: 700; letter-spacing: .06em; }
.payment-delete, .purchase-delete { color: #E8A99E !important; border-color: rgba(232,169,158,.42) !important; background: rgba(164,44,35,.1) !important; }
.payment-delete:hover, .purchase-delete:hover { background: rgba(164,44,35,.2) !important; border-color: rgba(232,169,158,.72) !important; }
.paid-confirm-amount { margin: 16px 0; padding: 14px; border: 1px solid rgba(198,154,58,.3); border-radius: 8px; background: rgba(198,154,58,.08); color: var(--gold-light); font-family: var(--font-mono); font-size: 22px; text-align: center; }
.invoice-success-icon { width: 46px; height: 46px; display: grid; place-items: center; margin: 0 auto 12px; border-radius: 50%; background: rgba(156,199,162,.14); border: 1px solid rgba(156,199,162,.38); color: #9CC7A2; font-size: 24px; }
.invoice-success-number { margin: 12px 0; color: var(--gold-light); font-family: var(--font-mono); font-size: 20px; text-align: center; }
.void-modal-note { margin: 12px 0; color: var(--ivory-3); font-size: 13px; line-height: 1.5; }
.payment-balance { padding: 9px 11px; min-height: 40px; border-radius: 7px; border: 1px solid rgba(198,154,58,.28); background: rgba(0,0,0,.22); color: var(--gold-light); font-family: var(--font-mono); font-size: 14px; }
#inv-no:disabled { opacity: 1; color: var(--gold-pale); cursor: not-allowed; background: rgba(198,154,58,.08); }
.f-purity:disabled { opacity: 1; color: var(--gold-pale); cursor: not-allowed; background: rgba(198,154,58,.08); }
.exchange-panel { margin: 16px 0; padding: 14px; border: 1px solid rgba(198,154,58,.28); border-radius: 8px; background: rgba(198,154,58,.06); }
.exchange-panel-title { font-family: var(--font-display); color: var(--gold-pale); font-size: 17px; font-weight: 600; margin: 0 0 10px; }
.exchange-rows { display: grid; gap: 10px; }
.exchange-row { display: grid; grid-template-columns: minmax(105px, .8fr) minmax(115px, 1fr) minmax(130px, 1fr) minmax(105px, .9fr) auto; gap: 9px; align-items: end; padding: 11px; border: 1px solid rgba(198,154,58,.18); border-radius: 8px; background: rgba(0,0,0,.12); }
.exchange-row .field { margin: 0; }
.exchange-row .field label { font-size: 9px; }
.exchange-row-value { min-height: 39px; display: flex; align-items: center; color: #9CC7A2; font-family: var(--font-mono); font-size: 13px; }
.exchange-remove { min-width: 38px; min-height: 38px; padding: 5px 9px; color: #e6aaa0; }
.exchange-add { margin-top: 10px; }
.exchange-total { margin-top: 6px; }
.dashboard-metal-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; margin-top: 20px; }
.dashboard-metal-grid .record-info-grid { grid-template-columns: repeat(2, 1fr); margin-bottom: 0; }
.low-stock-panel { margin-top: 20px; border-color: rgba(218, 135, 76, .56); background: rgba(154, 77, 35, .12); }
.low-stock-panel h3 { color: #f0b178; }
.low-stock-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.low-stock-item { padding: 12px 14px; border: 1px solid rgba(235, 165, 100, .32); border-radius: 8px; background: rgba(0, 0, 0, .15); }
.low-stock-item b { display: block; margin-bottom: 3px; color: #f0b178; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; }
.low-stock-item span { color: var(--ivory-1); font-family: var(--font-mono); font-size: 14px; }
.snapshot-sections { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.snapshot-section { padding: 14px; border: 1px solid rgba(198,154,58,.2); border-radius: 9px; background: rgba(0,0,0,.12); }
.snapshot-section h4 { margin: 0 0 11px; color: var(--gold-light); font-family: var(--font-display); font-size: 16px; font-weight: 600; }
.snapshot-section .record-info-grid { grid-template-columns: 1fr; gap: 10px; margin: 0; }
.brand-logo { width: 46px; height: 46px; object-fit: contain; }
.invoice-logo { width: 72px; height: 72px; object-fit: contain; }
.live-rates-refresh { min-width: 28px; min-height: 28px; padding: 2px 7px; font-size: 17px; line-height: 1; }
body { padding-bottom: 42px; }
.app-footer { position: fixed; z-index: 30; inset: auto 0 0; min-height: 42px; display: flex; align-items: center; justify-content: center; gap: 10px; padding: 8px 18px; border-top: 1px solid rgba(198,154,58,.22); background: rgba(23,19,13,.96); backdrop-filter: blur(10px); color: var(--ivory-3); font-size: 11px; letter-spacing: .03em; }
.app-footer strong { color: var(--gold-light); font-weight: 600; }
.app-footer .footer-separator { color: rgba(198,154,58,.5); }
.pin-lock { position: fixed; z-index: 1000; inset: 0; display: grid; place-items: center; padding: 22px; overflow: auto; background: radial-gradient(circle at 50% 20%, rgba(198,154,58,.18), transparent 34%), linear-gradient(135deg, #17130d, #0d0b08); }
.pin-lock-card { width: min(100%, 400px); padding: 34px; border: 1px solid rgba(222,182,97,.5); border-radius: 16px; box-shadow: 0 28px 70px rgba(0,0,0,.5); background: linear-gradient(160deg, rgba(44,35,22,.98), rgba(23,19,13,.98)); text-align: center; }
.pin-lock-logo { width: 88px; height: 88px; object-fit: contain; margin: 0 auto 14px; filter: drop-shadow(0 7px 12px rgba(0,0,0,.32)); }
.pin-lock .eyebrow { margin-bottom: 7px; }
.pin-lock h1 { margin: 0; color: var(--gold-pale); font-family: var(--font-display); font-size: 31px; font-weight: 600; }
.pin-lock p { margin: 9px 0 24px; color: var(--ivory-3); font-size: 13px; }
.pin-lock-form { display: grid; gap: 12px; }
.pin-lock-input { width: 100%; box-sizing: border-box; padding: 14px; border: 1px solid rgba(222,182,97,.5); border-radius: 9px; outline: none; background: rgba(0,0,0,.25); color: var(--gold-pale); font-family: var(--font-mono); font-size: 26px; letter-spacing: .42em; text-align: center; }
.pin-lock-input:focus { border-color: var(--gold-light); box-shadow: 0 0 0 3px rgba(198,154,58,.12); }
.pin-lock-error { min-height: 18px; color: #ef9b8d; font-size: 12px; }
body.pin-locked { overflow: hidden; }
body.pin-locked > *:not(.pin-lock) { visibility: hidden; }
@media (max-width: 760px) {
  header.topnav {
    padding: 10px 14px;
    flex-wrap: wrap;
    gap: 10px;
  }
  .brand { gap: 9px; }
  .brand > svg, .brand-logo { width: 38px; height: 38px; }
  .brand-text h1 { font-size: 19px; }
  .brand-text p { font-size: 8px; letter-spacing: .16em; }
  nav.tabs { width: 100%; gap: 3px; padding: 3px; }
  nav.tabs button { flex: 1; padding: 8px 5px; font-size: 11px; }
  main { padding: 22px 14px 48px; }
  .page-head { margin-bottom: 16px; }
  .page-head h2 { font-size: 30px; }
  .page-head p.sub { font-size: 13px; line-height: 1.45; }
  .panel { padding: 16px; }
  .row-2, .row-3 { grid-template-columns: 1fr; gap: 0; }
  .invoice-layout { gap: 18px; min-width: 0; }
  .invoice-layout > div { min-width: 0; }
  .paper-outer { position: static; top: auto; width: 100%; max-width: 100%; min-width: 0; overflow-x: auto; padding-bottom: 8px; }
  #invoicePaper { min-width: 640px; padding: 24px 26px 20px; }
  .btn-row { gap: 8px; }
  .btn-row .btn { flex: 1 1 100%; justify-content: center; min-height: 42px; }
  .toolbar { align-items: stretch; }
  .search-box { max-width: none; }
  .stat-cards { gap: 10px; margin-bottom: 16px; }
  #page-stocks .stat-cards { grid-template-columns: 1fr; }
  #page-dashboard .stat-cards { grid-template-columns: 1fr; }
  .stat-card { padding: 14px 16px; }
  .modal-backdrop { padding: 14px; }
  .modal { padding: 18px; }
  .record-info-grid { grid-template-columns: 1fr; gap: 8px; }
  .dashboard-metal-grid { grid-template-columns: 1fr; gap: 14px; }
  .dashboard-metal-grid .record-info-grid { grid-template-columns: 1fr; }
  .low-stock-list { grid-template-columns: 1fr; }
  .snapshot-sections { grid-template-columns: 1fr; }
  .record-actions .field { width: 100%; }
  .exchange-panel { padding: 12px; }
  .exchange-row { grid-template-columns: 1fr 1fr; }
  .exchange-row-value { min-height: 34px; }
  .exchange-remove { align-self: end; }
  body { padding-bottom: 58px; }
  .app-footer { min-height: 58px; flex-wrap: wrap; gap: 3px 8px; padding: 7px 12px; text-align: center; font-size: 10px; }
  .pin-lock { padding: 14px; }
  .pin-lock-card { padding: 28px 20px; }
}
@media (max-width: 380px) {
  .brand-text h1 { font-size: 17px; }
  nav.tabs button { font-size: 10px; }
  main { padding-inline: 12px; }
}
</style>
<script>
window.storage = {
  async get(key) {
    const response = await fetch('/api/storage/' + encodeURIComponent(key));
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('Could not load saved data');
    return response.json();
  },
  async set(key, value) {
    const response = await fetch('/api/storage/' + encodeURIComponent(key), {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value })
    });
    if (!response.ok) throw new Error('Could not save data');
  }
};
let loadedServerVersion = null;
async function refreshAfterServerRestart() {
  try {
    const response = await fetch('/api/version', { cache: 'no-store' });
    const payload = await response.json();
    if (loadedServerVersion && loadedServerVersion !== payload.version) location.reload();
    loadedServerVersion = payload.version;
  } catch (_) { /* The server is restarting; the next poll will retry. */ }
}
refreshAfterServerRestart();
setInterval(refreshAfterServerRestart, 1000);
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/service-worker.js').catch(() => {}));
}
</script>\n`;
  const dashboardPage = `
  <section class="page" id="page-dashboard">
    <div class="page-head">
      <p class="eyebrow">Business overview</p>
      <h2>Dashboard</h2>
      <p class="sub">A quick view of sales, collections, outstanding payments, and remaining metal stock.</p>
    </div>
    <div class="stat-cards">
      <div class="stat-card"><div class="lbl">Today’s Sales</div><div class="val" id="dash-today">₹0.00</div></div>
      <div class="stat-card"><div class="lbl">This Week</div><div class="val" id="dash-week">₹0.00</div></div>
      <div class="stat-card"><div class="lbl">This Month</div><div class="val" id="dash-month">₹0.00</div></div>
      <div class="stat-card"><div class="lbl">This Year</div><div class="val" id="dash-year">₹0.00</div></div>
    </div>
    <div class="panel" id="liveRatesPanel" style="display:none; margin-bottom:20px;">
      <div class="toolbar"><h3 style="margin:0;"><span class="dot"></span>Live Market Rates</h3><div style="display:flex; align-items:center; gap:8px;"><span style="color:var(--ivory-3); font-size:11px;" id="liveRatesUpdated"></span><button class="btn btn-ghost btn-sm live-rates-refresh" id="refreshLiveRates" type="button" title="Refresh live rates" aria-label="Refresh live rates">↻</button></div></div>
      <div class="record-info-grid" style="margin-bottom:0;">
        <div class="record-info"><b>Gold 24K (₹/g)</b><span class="paid-amount" id="liveGoldRate">—</span></div>
        <div class="record-info"><b>Silver (₹/g)</b><span class="paid-amount" id="liveSilverRate">—</span></div>
      </div>
    </div>
    <div class="panel">
      <h3><span class="dot"></span>Business Snapshot</h3>
      <div class="snapshot-sections" id="dashboardSnapshot">
        <div class="snapshot-section"><h4>Overall Sales</h4><div class="record-info-grid">
          <div class="record-info"><b>Total Invoices</b><span id="dash-invoices">0</span></div>
          <div class="record-info"><b>Total Collected</b><span class="paid-amount" id="dash-collected">₹0.00</span></div>
          <div class="record-info"><b>Outstanding Due</b><span class="due-amount" id="dash-due">₹0.00</span></div>
        </div></div>
        <div class="snapshot-section"><h4>Cash Flow</h4><div class="record-info-grid">
          <div class="record-info"><b>Old Metal Purchases</b><span class="due-amount" id="dash-purchases">₹0.00</span></div>
          <div class="record-info"><b>Net after Purchases</b><span class="paid-amount" id="dash-net-collected">₹0.00</span></div>
          <div class="record-info"><b>Cash Outflow</b><span class="due-amount" id="dash-amount-payments">₹0.00</span></div>
          <div class="record-info"><b>Final Net Collection</b><span class="paid-amount" id="dash-final-net-collected">₹0.00</span></div>
        </div></div>
        <div class="snapshot-section"><h4>Today</h4><div class="record-info-grid">
          <div class="record-info"><b>Invoices</b><span id="dash-today-invoices">0</span></div>
          <div class="record-info"><b>Collection</b><span class="paid-amount" id="dash-today-collected">₹0.00</span></div>
          <div class="record-info"><b>Old Metal Purchases</b><span class="due-amount" id="dash-today-purchases">₹0.00</span></div>
          <div class="record-info"><b>Net after Purchases</b><span class="paid-amount" id="dash-today-net-collected">₹0.00</span></div>
          <div class="record-info"><b>Cash Outflow</b><span class="due-amount" id="dash-today-amount-payments">₹0.00</span></div>
          <div class="record-info"><b>Final Net</b><span class="paid-amount" id="dash-today-final-net-collected">₹0.00</span></div>
          <div class="record-info"><b>Due</b><span class="due-amount" id="dash-today-due">₹0.00</span></div>
        </div></div>
      </div>
    </div>
    <div class="dashboard-metal-grid">
      <div class="panel">
        <h3><span class="dot"></span>Fresh Stock Remaining</h3>
        <div class="record-info-grid">
          <div class="record-info"><b>Fresh Gold</b><span id="dash-gold">0.000 g</span></div>
          <div class="record-info"><b>Fresh Silver</b><span id="dash-silver">0.000 g</span></div>
        </div>
      </div>
      <div class="panel">
        <h3><span class="dot"></span>Old Metal Balance</h3>
        <div class="record-info-grid">
          <div class="record-info"><b>Old Gold</b><span class="paid-amount" id="dash-old-gold">0.000 g</span></div>
          <div class="record-info"><b>Old Silver</b><span class="paid-amount" id="dash-old-silver">0.000 g</span></div>
        </div>
      </div>
    </div>
    <div class="panel low-stock-panel" id="lowStockPanel" style="display:none;">
      <h3><span class="dot"></span>Low Stock Warning</h3>
      <div class="low-stock-list" id="lowStockList"></div>
    </div>
  </section>\n`;
  const settingsPage = `
  <section class="page" id="page-settings">
    <div class="page-head">
      <p class="eyebrow">Application settings</p>
      <h2>Settings</h2>
      <p class="sub">Choose where the encrypted desktop data is stored on this computer.</p>
    </div>
    <div class="panel">
      <h3><span class="dot"></span>Data Location</h3>
      <div class="record-info-grid" style="margin-bottom:18px;"><div class="record-info"><b>Current folder</b><span id="settingsDataPath" style="word-break:break-all;">Loading…</span></div><div class="record-info"><b>Protection</b><span class="paid-amount">AES-256 encrypted</span></div></div>
      <p class="sub" style="margin:0 0 14px;">The app copies existing data to the selected folder, then restarts. The old folder is not deleted.</p>
      <button class="btn btn-gold" id="settingsChooseData" type="button">Choose Data Folder</button>
      <div id="settingsDataStatus" style="min-height:18px; margin-top:10px; color:var(--ivory-3); font-size:12px;"></div>
    </div>
  </section>\n`;
  const paymentsPage = `
  <section class="page" id="page-payments">
    <div class="page-head">
      <p class="eyebrow">Outgoing payments</p>
      <h2>Payment</h2>
      <p class="sub">Record cash payments, self expenses, or metal-to-metal payments from your old Gold and Silver balance.</p>
    </div>
    <div class="stat-cards">
      <div class="stat-card"><div class="lbl">Cash Outflow</div><div class="val" id="paymentCashTotal">₹0.00</div></div>
      <div class="stat-card"><div class="lbl">Gold Used</div><div class="val" id="paymentGoldWeight">0.000 g</div></div>
      <div class="stat-card"><div class="lbl">Silver Used</div><div class="val" id="paymentSilverWeight">0.000 g</div></div>
    </div>
    <div class="panel">
      <h3><span class="dot"></span>Add Payment</h3>
      <form id="paymentForm">
        <div class="row row-2">
          <div class="field"><label>Payment type</label><select id="paymentType"><option value="amount">Amount</option><option value="self-expense">Self Expense</option><option value="metal">Metal to Metal</option></select></div>
          <div class="field" id="paymentAmountField"><label>Amount paid (₹)</label><input type="number" id="paymentAmountInput" min="0.01" step="0.01" placeholder="0.00"></div>
        </div>
        <div class="field"><label>Reason (optional)</label><input type="text" id="paymentReason" placeholder="e.g. Shop electricity, supplier payment"></div>
        <div id="paymentMetalFields" style="display:none;">
          <div class="row row-3">
            <div class="field"><label>Metal</label><select id="paymentMetal"><option value="gold">Gold</option><option value="silver">Silver</option></select></div>
            <div class="field"><label>Gross weight (g)</label><input type="number" id="paymentWeight" min="0.001" step="0.001" placeholder="0.000"></div>
            <div class="field"><label>Purity (%)</label><input type="number" id="paymentPurity" min="0" max="100" step="0.01" placeholder="e.g. 40"></div>
          </div>
          <div class="field" style="margin-bottom:0;"><label>Fine metal weight (g)</label><div class="payment-balance" id="paymentFineWeight">0.000 g</div></div>
        </div>
        <div class="btn-row" style="margin:18px 0 0;"><button class="btn btn-gold" type="submit">Save Payment</button></div>
      </form>
    </div>
    <div class="panel">
      <div class="toolbar"><h3 style="margin:0;"><span class="dot"></span>Payment History</h3><span style="color:var(--ivory-3); font-size:12px;" id="paymentCount"></span></div>
      <div class="data-table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Type</th><th>Metal</th><th>Gross Wt</th><th>Purity</th><th>Fine Wt</th><th>Amount</th><th></th></tr></thead><tbody id="paymentTbody"></tbody></table></div>
      <div class="empty-state" id="paymentsEmpty" style="display:none;"><div class="glyph">✦</div>No payments recorded yet.</div>
    </div>
  </section>\n`;
  const purchasesPage = `
  <section class="page" id="page-purchases">
    <div class="page-head">
      <p class="eyebrow">Old metal register</p>
      <h2>Purchase</h2>
      <p class="sub">Record old gold and silver purchases separately from fresh stock.</p>
    </div>
    <div class="stat-cards">
      <div class="stat-card"><div class="lbl">Gold Purchased</div><div class="val" id="purchaseGoldWeight">0.000 g</div></div>
      <div class="stat-card"><div class="lbl">Silver Purchased</div><div class="val" id="purchaseSilverWeight">0.000 g</div></div>
      <div class="stat-card"><div class="lbl">Total Purchase Value</div><div class="val" id="purchaseTotalValue">₹0.00</div></div>
    </div>
    <div class="panel">
      <h3><span class="dot"></span>Add Old Metal Purchase</h3>
      <form id="purchaseForm">
        <div class="row row-3">
          <div class="field"><label>Metal</label><select id="purchaseMetal"><option value="gold">Gold</option><option value="silver">Silver</option></select></div>
          <div class="field"><label>Weight (g)</label><input type="number" id="purchaseWeight" min="0.001" step="0.001" required placeholder="0.000"></div>
          <div class="field"><label>Rate per gram (₹)</label><input type="number" id="purchaseRate" min="0.01" step="0.01" required placeholder="0.00"></div>
        </div>
        <div class="row row-2" style="align-items:end;">
          <div class="field" style="margin-bottom:0;"><label>Calculated amount (₹)</label><div class="payment-balance" id="purchaseAmount">₹0.00</div></div>
          <div class="btn-row" style="margin:0;"><button class="btn btn-gold" type="submit">Save Purchase</button></div>
        </div>
      </form>
    </div>
    <div class="panel">
      <div class="toolbar"><h3 style="margin:0;"><span class="dot"></span>Purchase History</h3><span style="color:var(--ivory-3); font-size:12px;" id="purchaseCount"></span></div>
      <div class="data-table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Metal</th><th>Weight</th><th>Rate / g</th><th>Amount</th><th></th></tr></thead><tbody id="purchaseTbody"></tbody></table></div>
      <div class="empty-state" id="purchasesEmpty" style="display:none;"><div class="glyph">✦</div>No old metal purchases recorded yet.</div>
    </div>
  </section>\n`;
  const recordsPage = `
  <section class="page" id="page-records">
    <div class="page-head">
      <p class="eyebrow">Sales history</p>
      <h2>Invoice Records</h2>
      <p class="sub">Every completed invoice is saved here. Search a customer by name or mobile number.</p>
    </div>
    <div class="panel">
      <div class="toolbar">
        <div class="search-box"><input type="text" id="recordSearch" placeholder="Search customer name or mobile number…"></div>
        <label style="display:flex;align-items:center;gap:8px;color:var(--gold-pale);font-size:13px;white-space:nowrap;cursor:pointer;"><input id="recordDueOnly" type="checkbox" style="width:16px;height:16px;accent-color:var(--gold);">Due only</label>
        <span style="color:var(--ivory-3); font-size:12px; opacity:.7;" id="recordCountLabel"></span>
      </div>
      <div class="data-table-wrap">
        <table class="data-table">
          <thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th>Mobile</th><th>Total</th><th>Due</th><th></th></tr></thead>
          <tbody id="recordsTbody"></tbody>
        </table>
      </div>
      <div class="empty-state" id="recordsEmpty" style="display:none;"><div class="glyph">✦</div>No completed invoices yet.</div>
    </div>
  </section>\n`;
  const recordsScript = `
<script>
(() => {
  const safe = value => String(value || '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
  const invoiceNumberInput = document.getElementById('inv-no');
  invoiceNumberInput.disabled = true;
  invoiceNumberInput.title = 'Invoice number is assigned automatically';
  const useLogo = (selector, className) => {
    const placeholder = document.querySelector(selector);
    if (!placeholder) return;
    const logo = document.createElement('img');
    logo.src = '/assets/vishesh-jewellers-logo.png';
    logo.alt = 'Vishesh Jewellers';
    logo.className = className;
    placeholder.replaceWith(logo);
  };
  useLogo('.brand > svg', 'brand-logo');
  useLogo('.paper-brand > svg', 'invoice-logo');
  document.querySelectorAll('.brand-text p, .paper-brand p').forEach(tagline => {
    tagline.textContent = 'Beginning... of Special Relationship...';
  });
  const appFooter = document.createElement('footer');
  appFooter.className = 'app-footer';
  appFooter.innerHTML = '<span>© ' + new Date().getFullYear() + ' <strong>Vishesh Jewellers</strong></span><span class="footer-separator">•</span><span>Invoice &amp; Inventory Management</span><span class="footer-separator">•</span><span>Records saved locally</span>';
  document.body.appendChild(appFooter);
  const PIN_CODE = '5512';
  const pinSessionKey = 'vishesh-jewellers-pin-unlocked';
  const showPinLock = () => {
    if (sessionStorage.getItem(pinSessionKey) === 'true') return;
    const lock = document.createElement('section');
    lock.className = 'pin-lock';
    lock.innerHTML = '<div class="pin-lock-card"><img class="pin-lock-logo" src="/assets/vishesh-jewellers-logo.png" alt="Vishesh Jewellers"><div class="eyebrow">Private workspace</div><h1>Welcome back</h1><p>Enter your 4-digit PIN to open Vishesh Jewellers.</p><form class="pin-lock-form" id="pinLockForm"><input class="pin-lock-input" id="pinLockInput" type="password" inputmode="numeric" autocomplete="current-password" pattern="[0-9]*" maxlength="4" aria-label="Four digit PIN" autofocus><div class="pin-lock-error" id="pinLockError" role="alert"></div><button class="btn btn-gold" type="submit">Unlock App</button></form></div>';
    document.body.classList.add('pin-locked');
    document.body.appendChild(lock);
    const input = document.getElementById('pinLockInput');
    requestAnimationFrame(() => input.focus());
    document.getElementById('pinLockForm').addEventListener('submit', event => {
      event.preventDefault();
      if (input.value === PIN_CODE) {
        sessionStorage.setItem(pinSessionKey, 'true');
        document.body.classList.remove('pin-locked');
        lock.remove();
        return;
      }
      document.getElementById('pinLockError').textContent = 'Incorrect PIN. Please try again.';
      input.value = '';
      input.focus();
    });
  };
  showPinLock();
  window.orderMode = false;
  const invoiceTypeField = document.createElement('div');
  invoiceTypeField.className = 'field';
  invoiceTypeField.innerHTML = '<label>Invoice type</label><select id="invoiceType"><option value="sale">Ready sale — deduct stock</option><option value="pending">Pending delivery order</option></select>';
  document.getElementById('inv-date').closest('.field').insertAdjacentElement('afterend', invoiceTypeField);
  const pendingOrderButton = document.createElement('button');
  pendingOrderButton.className = 'btn btn-gold';
  pendingOrderButton.id = 'btnSavePendingOrder';
  pendingOrderButton.type = 'button';
  pendingOrderButton.textContent = 'Save Pending Order';
  pendingOrderButton.style.display = 'none';
  document.getElementById('btnCompleteSale').insertAdjacentElement('beforebegin', pendingOrderButton);
  const updateInvoiceType = () => {
    window.orderMode = document.getElementById('invoiceType').value === 'pending';
    pendingOrderButton.style.display = window.orderMode ? '' : 'none';
    document.getElementById('btnCompleteSale').style.display = window.orderMode ? 'none' : '';
    renderRowsTable(); renderPreview(); setSaleStatus();
    if (window.orderMode) document.getElementById('saleStatus').textContent = 'Pending delivery order: enter the requested item details. Stock will be selected and deducted only on delivery.';
  };
  document.getElementById('invoiceType').addEventListener('change', updateInvoiceType);
  document.getElementById('btnNewInvoice').addEventListener('click', () => {
    document.getElementById('invoiceType').value = 'sale';
    window.orderMode = false;
    updateInvoiceType();
  });
  const stockItemInput = document.getElementById('st-item');
  stockItemInput.placeholder = 'e.g. Gold Ring or Silver Chain';
  stockItemInput.closest('.field').querySelector('label').textContent = 'Item (Gold / Silver)';
  const customerNameInput = document.getElementById('cust-name');
  customerNameInput.required = true;
  customerNameInput.closest('.field').querySelector('label').textContent = 'Customer Name *';
  document.querySelectorAll('#itemsTable th').forEach(header => {
    if (['From Stock', 'Rate (₹/g)'].includes(header.textContent.trim())) header.textContent += ' *';
  });
  const amount = value => Number(String(value || '').replace(/[^0-9.-]/g, '')) || 0;
  const hiddenExchangeInput = document.getElementById('exchange-disc');
  const originalExchangeField = hiddenExchangeInput.closest('.field');
  originalExchangeField.style.display = 'none';
  const exchangePanel = document.createElement('div');
  exchangePanel.className = 'exchange-panel';
  exchangePanel.innerHTML = '<div class="toolbar"><div class="exchange-panel-title" style="margin:0;">Gold / Silver Exchange</div><button class="btn btn-ghost btn-sm" id="addExchangeRow" type="button">+ Add item</button></div><p class="sub" style="margin:0 0 12px;">Add each exchanged gold or silver item separately.</p><div class="exchange-rows" id="exchangeRows"></div><div class="field exchange-total" style="margin-bottom:0;"><label>Total exchange credit (₹)</label><div class="payment-balance" id="exchange-value">₹0.00</div></div>';
  originalExchangeField.parentElement.parentElement.insertBefore(exchangePanel, originalExchangeField.parentElement);
  const exchangeRows = document.getElementById('exchangeRows');
  const addExchangeRow = (entry = {}) => {
    const row = document.createElement('div');
    row.className = 'exchange-row';
    row.innerHTML = '<div class="field"><label>Metal</label><select class="exchange-row-metal"><option value="gold">Gold</option><option value="silver">Silver</option></select></div><div class="field"><label>Weight (g)</label><input class="exchange-row-weight" type="number" value="' + (Number(entry.weight) || 0) + '" min="0" step="0.001" placeholder="0.000"></div><div class="field"><label>Rate / gram (₹)</label><input class="exchange-row-rate" type="number" value="' + (Number(entry.rate) || 0) + '" min="0" step="0.01" placeholder="0.00"></div><div class="field"><label>Value</label><div class="exchange-row-value">₹0.00</div></div><button class="btn btn-ghost btn-sm exchange-remove" type="button" title="Remove item" aria-label="Remove exchange item">×</button>';
    row.querySelector('.exchange-row-metal').value = entry.metal === 'silver' ? 'silver' : 'gold';
    exchangeRows.appendChild(row);
    return row;
  };
  const getExchangeEntries = () => Array.from(exchangeRows.querySelectorAll('.exchange-row')).map(row => {
    const metal = row.querySelector('.exchange-row-metal').value;
    const weight = Math.max(Number(row.querySelector('.exchange-row-weight').value) || 0, 0);
    const rate = Math.max(Number(row.querySelector('.exchange-row-rate').value) || 0, 0);
    return { metal, weight, rate, value: weight * rate };
  });
  const updateExchangeValue = () => {
    const entries = getExchangeEntries();
    const value = entries.reduce((total, entry) => total + entry.value, 0);
    const manualDiscount = Math.max(Number(document.getElementById('invoice-discount') && document.getElementById('invoice-discount').value) || 0, 0);
    const formatExchangeMoney = amount => '₹' + amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    exchangeRows.querySelectorAll('.exchange-row').forEach((row, index) => { row.querySelector('.exchange-row-value').textContent = formatExchangeMoney(entries[index].value); });
    document.getElementById('exchange-value').textContent = formatExchangeMoney(value);
    hiddenExchangeInput.value = (value + manualDiscount).toFixed(2);
    hiddenExchangeInput.dispatchEvent(new Event('input', { bubbles: true }));
  };
  document.getElementById('addExchangeRow').addEventListener('click', () => { addExchangeRow(); updateExchangeValue(); });
  exchangeRows.addEventListener('input', updateExchangeValue);
  exchangeRows.addEventListener('change', updateExchangeValue);
  exchangeRows.addEventListener('click', event => {
    const button = event.target.closest('.exchange-remove');
    if (!button) return;
    button.closest('.exchange-row').remove();
    if (!exchangeRows.children.length) addExchangeRow();
    updateExchangeValue();
  });
  addExchangeRow();
  updateExchangeValue();
  const paymentRow = document.createElement('div');
  paymentRow.className = 'row row-3';
  paymentRow.id = 'invoicePaymentRow';
  paymentRow.style.marginTop = '16px';
  paymentRow.innerHTML = '<div class="field"><label>Discount (₹)</label><input type="number" id="invoice-discount" value="0" min="0" step="0.01" placeholder="0.00"></div><div class="field"><label>Amount Paid (₹)</label><input type="number" id="amount-paid" value="0" min="0" step="0.01" placeholder="0.00"></div><div class="field"><label id="amount-balance-label">Amount Due (₹)</label><div id="amount-balance" class="payment-balance">₹0.00</div></div>';
  const totalsMini = document.querySelector('.totals-mini');
  totalsMini.parentNode.insertBefore(paymentRow, totalsMini);
  const updatePaymentSummary = () => {
    const total = amount(document.getElementById('mini-grand').textContent);
    const paid = Math.max(amount(document.getElementById('amount-paid').value), 0);
    const difference = total - paid;
    const isDue = difference >= 0;
    document.getElementById('amount-balance-label').textContent = isDue ? 'Amount Due (₹)' : 'Excess / Plus Amount (₹)';
    document.getElementById('amount-balance').textContent = money(Math.abs(difference));
    const totals = document.getElementById('p-totals');
    const existing = totals.querySelector('.payment-summary-line');
    if (existing) existing.remove();
    const line = document.createElement('div');
    line.className = 'tl payment-summary-line';
    line.innerHTML = '<span>' + (isDue ? 'Amount Due' : 'Excess / Plus Amount') + '</span><b>₹' + money(Math.abs(difference)).replace('₹', '') + '</b>';
    totals.appendChild(line);
  };
  document.getElementById('amount-paid').addEventListener('input', updatePaymentSummary);
  document.getElementById('invoice-discount').addEventListener('input', updateExchangeValue);
  document.addEventListener('input', event => {
    if (event.target.id !== 'amount-paid') setTimeout(updatePaymentSummary, 0);
  });
  document.addEventListener('change', event => {
    if (event.target.id !== 'amount-paid') setTimeout(updatePaymentSummary, 0);
  });
  document.getElementById('btnNewInvoice').addEventListener('click', async () => {
    const previousInvoiceNumber = invoiceNumberInput.value;
    for (let attempt = 0; attempt < 40 && invoiceNumberInput.value === previousInvoiceNumber; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    document.getElementById('amount-paid').value = '0';
    document.getElementById('invoice-discount').value = '0';
    exchangeRows.innerHTML = '';
    addExchangeRow();
    document.getElementById('gst-rate').value = '1.5';
    updateExchangeValue();
    updatePaymentSummary();
  });
  window.addEventListener('load', updatePaymentSummary);
  const getRecords = async () => {
    const result = await window.storage.get('invoice-records');
    return result ? JSON.parse(result.value).map(record => {
      record.paid = Number(record.paid) || 0;
      record.payments = Array.isArray(record.payments) ? record.payments : [];
      const missingDue = !Object.prototype.hasOwnProperty.call(record, 'due');
      const legacyZeroDue = amount(record.total) > 0 && record.paid === 0 && Number(record.due) === 0 && record.payments.length === 0;
      if (missingDue || legacyZeroDue) record.due = Math.max(amount(record.total) - record.paid, 0);
      return record;
    }) : [];
  };
  const money = value => '₹' + amount(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const getOldGold = async () => {
    const result = await window.storage.get('old-gold-records');
    return result ? JSON.parse(result.value) : [];
  };
  const getPurchases = async () => {
    const result = await window.storage.get('purchase-records');
    return result ? JSON.parse(result.value) : [];
  };
  const renderPurchases = async () => {
    const purchases = await getPurchases();
    const metalWeight = metal => purchases.filter(purchase => purchase.metal === metal).reduce((total, purchase) => total + (Number(purchase.weight) || 0), 0);
    document.getElementById('purchaseGoldWeight').textContent = metalWeight('gold').toFixed(3) + ' g';
    document.getElementById('purchaseSilverWeight').textContent = metalWeight('silver').toFixed(3) + ' g';
    document.getElementById('purchaseTotalValue').textContent = money(purchases.reduce((total, purchase) => total + (Number(purchase.amount) || 0), 0));
    document.getElementById('purchaseCount').textContent = purchases.length + (purchases.length === 1 ? ' purchase' : ' purchases');
    document.getElementById('purchaseTbody').innerHTML = purchases.map(purchase => '<tr><td>' + safe(new Date(purchase.savedAt).toLocaleDateString('en-GB')) + '</td><td>' + safe(String(purchase.metal || 'gold').replace(/^./, char => char.toUpperCase())) + '</td><td style="font-family:var(--font-mono); color:var(--gold-pale);">' + (Number(purchase.weight) || 0).toFixed(3) + ' g</td><td>' + money(purchase.rate) + '</td><td class="paid-amount">' + money(purchase.amount) + '</td><td><button class="btn btn-ghost btn-sm purchase-edit" data-id="' + safe(purchase.id) + '">Edit</button> <button class="btn btn-ghost btn-sm purchase-delete" data-id="' + safe(purchase.id) + '">Delete</button></td></tr>').join('');
    document.getElementById('purchasesEmpty').style.display = purchases.length ? 'none' : 'block';
  };
  const getPayments = async () => {
    const result = await window.storage.get('payment-records');
    return result ? JSON.parse(result.value) : [];
  };
  const renderPayments = async () => {
    const payments = await getPayments();
    const metalWeight = metal => payments.filter(payment => payment.type === 'metal' && payment.metal === metal).reduce((total, payment) => total + (Number(payment.weight) || 0), 0);
    document.getElementById('paymentCashTotal').textContent = money(payments.filter(payment => payment.type === 'amount' || payment.type === 'self-expense').reduce((total, payment) => total + (Number(payment.amount) || 0), 0));
    document.getElementById('paymentGoldWeight').textContent = metalWeight('gold').toFixed(3) + ' g';
    document.getElementById('paymentSilverWeight').textContent = metalWeight('silver').toFixed(3) + ' g';
    document.getElementById('paymentCount').textContent = payments.length + (payments.length === 1 ? ' payment' : ' payments');
    document.getElementById('paymentTbody').innerHTML = payments.map(payment => '<tr><td>' + safe(new Date(payment.savedAt).toLocaleDateString('en-GB')) + '</td><td>' + safe(payment.type === 'metal' ? 'Metal to Metal' : payment.type === 'self-expense' ? 'Self Expense' : 'Amount') + (payment.reason ? '<br><small style="color:var(--ivory-3);">' + safe(payment.reason) + '</small>' : '') + '</td><td>' + safe(payment.metal ? payment.metal.replace(/^./, char => char.toUpperCase()) : '—') + '</td><td>' + (payment.type === 'metal' ? (Number(payment.weight) || 0).toFixed(3) + ' g' : '—') + '</td><td>' + (payment.type === 'metal' ? (Number(payment.purity) || 0).toFixed(2) + '%' : '—') + '</td><td class="paid-amount">' + (payment.type === 'metal' ? (Number(payment.fineWeight) || 0).toFixed(3) + ' g' : '—') + '</td><td>' + (payment.type === 'metal' || !Number(payment.amount) ? '—' : money(payment.amount)) + '</td><td><button class="btn btn-ghost btn-sm payment-edit" data-id="' + safe(payment.id) + '">Edit</button> <button class="btn btn-ghost btn-sm payment-delete" data-id="' + safe(payment.id) + '">Delete</button></td></tr>').join('');
    document.getElementById('paymentsEmpty').style.display = payments.length ? 'none' : 'block';
  };
  const addOldGold = async entry => {
    if (!entry || !Number(entry.weight)) return;
    const entries = await getOldGold();
    if (entries.some(saved => saved.sourceId === entry.sourceId)) return;
    entries.unshift(entry);
    await originalStorageSet('old-gold-records', JSON.stringify(entries));
  };
  const transactionModal = document.createElement('div');
  transactionModal.className = 'modal-backdrop';
  transactionModal.id = 'transactionModal';
  document.body.appendChild(transactionModal);
  let activeTransaction = null;
  const closeTransactionModal = () => { transactionModal.classList.remove('open'); activeTransaction = null; };
  const openTransactionEditor = (kind, entry) => {
    activeTransaction = { kind, id: entry.id };
    const isPayment = kind === 'payment';
    const isMetalPayment = isPayment && entry.type === 'metal';
    const typeOptions = isPayment ? '<div class="field"><label>Payment type</label><select id="transactionType"><option value="amount" ' + (entry.type === 'amount' ? 'selected' : '') + '>Amount</option><option value="self-expense" ' + (entry.type === 'self-expense' ? 'selected' : '') + '>Self Expense</option><option value="metal" ' + (entry.type === 'metal' ? 'selected' : '') + '>Metal to Metal</option></select></div>' : '';
    transactionModal.innerHTML = '<div class="modal" style="max-width:560px;"><div class="toolbar"><h3 style="margin:0;">Edit ' + (isPayment ? 'Payment' : 'Purchase') + '</h3><button class="btn btn-ghost btn-sm" id="closeTransactionModal">Close</button></div><div class="form-grid">' + typeOptions + '<div class="field transaction-metal"><label>Metal</label><select id="transactionMetal"><option value="gold" ' + (entry.metal === 'gold' ? 'selected' : '') + '>Gold</option><option value="silver" ' + (entry.metal === 'silver' ? 'selected' : '') + '>Silver</option></select></div><div class="field transaction-weight"><label>Weight (g)</label><input id="transactionWeight" type="number" min="0.001" step="0.001" value="' + (Number(entry.weight) || 0) + '"></div><div class="field transaction-purity"><label>Purity (%)</label><input id="transactionPurity" type="number" min="0" max="100" step="0.01" value="' + (Number(entry.purity) || 0) + '"></div><div class="field transaction-rate"><label>Rate per gram (₹)</label><input id="transactionRate" type="number" min="0.01" step="0.01" value="' + (Number(entry.rate) || 0) + '"></div><div class="field transaction-amount"><label>Amount (₹)</label><input id="transactionAmount" type="number" min="0.01" step="0.01" value="' + (Number(entry.amount) || 0) + '"></div><div class="field transaction-reason"><label>Reason (optional)</label><input id="transactionReason" type="text" value="' + safe(entry.reason || '') + '"></div></div><div class="btn-row" style="margin-top:18px;"><button class="btn btn-gold" id="saveTransaction">Save Changes</button><button class="btn btn-ghost" id="cancelTransaction">Cancel</button></div></div>';
    const updateFields = () => {
      const type = isPayment ? document.getElementById('transactionType').value : 'purchase';
      const metal = type === 'metal';
      transactionModal.querySelectorAll('.transaction-metal, .transaction-weight').forEach(field => { field.style.display = (metal || !isPayment) ? '' : 'none'; });
      transactionModal.querySelector('.transaction-purity').style.display = metal ? '' : 'none';
      transactionModal.querySelector('.transaction-rate').style.display = isPayment ? 'none' : '';
      transactionModal.querySelector('.transaction-amount').style.display = metal || !isPayment ? 'none' : '';
      transactionModal.querySelector('.transaction-reason').style.display = isPayment ? '' : 'none';
      if (!isPayment) {
        const value = (Number(document.getElementById('transactionWeight').value) || 0) * (Number(document.getElementById('transactionRate').value) || 0);
        document.getElementById('transactionAmount').value = value.toFixed(2);
      }
    };
    if (isPayment) document.getElementById('transactionType').addEventListener('change', updateFields);
    ['transactionWeight', 'transactionRate'].forEach(id => document.getElementById(id).addEventListener('input', updateFields));
    document.getElementById('closeTransactionModal').addEventListener('click', closeTransactionModal);
    document.getElementById('cancelTransaction').addEventListener('click', closeTransactionModal);
    updateFields();
    transactionModal.classList.add('open');
  };
  const openTransactionDelete = (kind, entry) => {
    activeTransaction = { kind: kind + '-delete', id: entry.id };
    transactionModal.innerHTML = '<div class="modal" style="max-width:480px;"><div class="toolbar"><h3 style="margin:0;">Delete ' + (kind === 'payment' ? 'Payment' : 'Purchase') + '</h3><button class="btn btn-ghost btn-sm" id="closeTransactionModal">Close</button></div><p class="void-modal-note">This will permanently remove the entry and reverse its linked old-metal balance, if applicable.</p><div class="btn-row" style="margin-top:18px;"><button class="btn btn-danger" id="confirmTransactionDelete">Delete</button><button class="btn btn-ghost" id="cancelTransaction">Cancel</button></div></div>';
    document.getElementById('closeTransactionModal').addEventListener('click', closeTransactionModal);
    document.getElementById('cancelTransaction').addEventListener('click', closeTransactionModal);
    transactionModal.classList.add('open');
  };
  transactionModal.addEventListener('click', async event => {
    if (!activeTransaction) return;
    const isDelete = activeTransaction.kind.endsWith('-delete');
    if ((isDelete && event.target.id !== 'confirmTransactionDelete') || (!isDelete && event.target.id !== 'saveTransaction')) return;
    const kind = activeTransaction.kind.replace('-delete', '');
    const id = activeTransaction.id;
    if (kind === 'payment') {
      const payments = await getPayments();
      const payment = payments.find(entry => entry.id === id);
      if (!payment) { closeTransactionModal(); return; }
      if (isDelete) {
        await originalStorageSet('payment-records', JSON.stringify(payments.filter(entry => entry.id !== id)));
        const oldMetal = await getOldGold();
        await originalStorageSet('old-gold-records', JSON.stringify(oldMetal.filter(entry => entry.sourceId !== 'payment:' + id)));
      } else {
        const type = document.getElementById('transactionType').value;
        const reason = document.getElementById('transactionReason').value.trim();
        const oldMetal = await getOldGold();
        const revisedOldMetal = oldMetal.filter(entry => entry.sourceId !== 'payment:' + id);
        if (type === 'metal') {
          const metal = document.getElementById('transactionMetal').value;
          const weight = Number(document.getElementById('transactionWeight').value);
          const purity = Number(document.getElementById('transactionPurity').value);
          const available = revisedOldMetal.filter(entry => entry.metal === metal).reduce((sum, entry) => sum + (Number(entry.weight) || 0), 0);
          if (!(weight > 0) || !(purity >= 0 && purity <= 100) || weight > available + 0.0001) { toast('Enter a valid metal weight within the available old ' + metal + ' balance of ' + available.toFixed(3) + ' g.'); return; }
          Object.assign(payment, { type, metal, weight, purity, fineWeight: weight * purity / 100, amount: 0, reason });
          revisedOldMetal.unshift({ sourceId: 'payment:' + id, metal, source: 'Metal payment', invoice: '—', customer: '—', date: new Date(payment.savedAt).toLocaleDateString('en-GB'), weight: -weight, rate: 0, value: 0, receivedAt: payment.savedAt });
        } else {
          const paymentAmount = Number(document.getElementById('transactionAmount').value);
          if (!(paymentAmount > 0)) { toast('Enter a valid payment amount.'); return; }
          Object.assign(payment, { type, amount: paymentAmount, reason });
          delete payment.metal; delete payment.weight; delete payment.purity; delete payment.fineWeight;
        }
        await originalStorageSet('payment-records', JSON.stringify(payments));
        await originalStorageSet('old-gold-records', JSON.stringify(revisedOldMetal));
      }
      await renderPayments();
    } else {
      const purchases = await getPurchases();
      const purchase = purchases.find(entry => entry.id === id);
      if (!purchase) { closeTransactionModal(); return; }
      if (isDelete) {
        await originalStorageSet('purchase-records', JSON.stringify(purchases.filter(entry => entry.id !== id)));
        const oldMetal = await getOldGold();
        await originalStorageSet('old-gold-records', JSON.stringify(oldMetal.filter(entry => entry.sourceId !== 'purchase:' + id)));
      } else {
        const metal = document.getElementById('transactionMetal').value;
        const weight = Number(document.getElementById('transactionWeight').value);
        const rate = Number(document.getElementById('transactionRate').value);
        if (!(weight > 0) || !(rate > 0)) { toast('Enter a valid weight and rate.'); return; }
        const purchaseAmount = weight * rate;
        Object.assign(purchase, { metal, weight, rate, amount: purchaseAmount });
        const oldMetal = await getOldGold();
        const revisedOldMetal = oldMetal.filter(entry => entry.sourceId !== 'purchase:' + id);
        revisedOldMetal.unshift({ sourceId: 'purchase:' + id, metal, source: 'Old metal purchase', invoice: '—', customer: '—', date: new Date(purchase.savedAt).toLocaleDateString('en-GB'), weight, rate, value: purchaseAmount, receivedAt: purchase.savedAt });
        await originalStorageSet('purchase-records', JSON.stringify(purchases));
        await originalStorageSet('old-gold-records', JSON.stringify(revisedOldMetal));
      }
      await renderPurchases();
    }
    if (document.getElementById('page-dashboard').classList.contains('active')) await renderDashboard();
    closeTransactionModal();
  });
  const dateForRecord = record => {
    if (record.invoiceDate && /^\d{4}-\d{2}-\d{2}$/.test(record.invoiceDate)) {
      const invoiceDate = new Date(record.invoiceDate + 'T00:00:00');
      if (!Number.isNaN(invoiceDate.getTime())) return invoiceDate;
    }
    if (record.savedAt) {
      const savedDate = new Date(record.savedAt);
      if (!Number.isNaN(savedDate.getTime())) return savedDate;
    }
    const parts = String(record.date || '').split('/');
    return parts.length === 3 ? new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0])) : new Date(0);
  };
  const recordNetTotal = record => Math.max(amount(record.total) - (Number(record.returnTotal) || 0), 0);
  const renderDashboard = async (forceLiveRates = false) => {
    const records = await getRecords();
    const now = new Date();
    const startToday = new Date(now);
    startToday.setHours(0, 0, 0, 0);
    const startWeek = new Date(startToday);
    startWeek.setDate(startWeek.getDate() - startWeek.getDay());
    const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startYear = new Date(now.getFullYear(), 0, 1);
    const activeRecords = records.filter(record => record.status !== 'voided' && record.status !== 'pending');
    const salesSince = start => activeRecords.reduce((total, record) => dateForRecord(record) >= start ? total + recordNetTotal(record) : total, 0);
    document.getElementById('dash-today').textContent = money(salesSince(startToday));
    document.getElementById('dash-week').textContent = money(salesSince(startWeek));
    document.getElementById('dash-month').textContent = money(salesSince(startMonth));
    document.getElementById('dash-year').textContent = money(salesSince(startYear));
    const purchases = await getPurchases();
    const payments = await getPayments();
    const collected = activeRecords.reduce((total, record) => total + (Number(record.paid) || 0), 0);
    const purchaseValue = purchases.reduce((total, purchase) => total + (Number(purchase.amount) || 0), 0);
    const amountPayments = payments.filter(payment => payment.type === 'amount' || payment.type === 'self-expense').reduce((total, payment) => total + (Number(payment.amount) || 0), 0);
    document.getElementById('dash-invoices').textContent = activeRecords.length;
    document.getElementById('dash-collected').textContent = money(collected);
    document.getElementById('dash-purchases').textContent = money(purchaseValue);
    document.getElementById('dash-net-collected').textContent = money(collected - purchaseValue);
    document.getElementById('dash-amount-payments').textContent = money(amountPayments);
    document.getElementById('dash-final-net-collected').textContent = money(collected - purchaseValue - amountPayments);
    document.getElementById('dash-due').textContent = money(activeRecords.reduce((total, record) => total + Math.max(Number(record.due) || 0, 0), 0));
    const todayRecords = activeRecords.filter(record => dateForRecord(record) >= startToday);
    document.getElementById('dash-today-invoices').textContent = todayRecords.length;
    const todayPurchaseValue = purchases.filter(purchase => new Date(purchase.savedAt) >= startToday).reduce((total, purchase) => total + (Number(purchase.amount) || 0), 0);
    const todayAmountPayments = payments.filter(payment => (payment.type === 'amount' || payment.type === 'self-expense') && new Date(payment.savedAt) >= startToday).reduce((total, payment) => total + (Number(payment.amount) || 0), 0);
    const todayCollected = todayRecords.reduce((total, record) => total + (Number(record.paid) || 0), 0);
    document.getElementById('dash-today-collected').textContent = money(todayCollected);
    document.getElementById('dash-today-purchases').textContent = money(todayPurchaseValue);
    document.getElementById('dash-today-net-collected').textContent = money(todayCollected - todayPurchaseValue);
    document.getElementById('dash-today-amount-payments').textContent = money(todayAmountPayments);
    document.getElementById('dash-today-final-net-collected').textContent = money(todayCollected - todayPurchaseValue - todayAmountPayments);
    document.getElementById('dash-today-due').textContent = money(todayRecords.reduce((total, record) => total + Math.max(Number(record.due) || 0), 0));
    const stockResult = await window.storage.get('stock-list');
    const stockList = stockResult ? JSON.parse(stockResult.value) : [];
    const remainingWeight = metal => stockList.reduce((total, stock) => {
      const isSilver = String(stock.purity || '').toLowerCase() === 'silver';
      if ((metal === 'silver') !== isSilver) return total;
      return total + (Number(stock.net) || Number(stock.gross) || 0);
    }, 0);
    const goldRemaining = remainingWeight('gold');
    const silverRemaining = remainingWeight('silver');
    document.getElementById('dash-gold').textContent = goldRemaining.toFixed(3) + ' g';
    document.getElementById('dash-silver').textContent = silverRemaining.toFixed(3) + ' g';
    const lowStockLimits = { gold: 10, silver: 100 };
    const lowStockMetals = [
      { label: 'Gold', remaining: goldRemaining, limit: lowStockLimits.gold },
      { label: 'Silver', remaining: silverRemaining, limit: lowStockLimits.silver }
    ].filter(metal => metal.remaining <= metal.limit);
    const lowStockPanel = document.getElementById('lowStockPanel');
    document.getElementById('lowStockList').innerHTML = lowStockMetals.map(metal =>
      '<div class="low-stock-item"><b>' + metal.label + ' is running low</b><span>' + metal.remaining.toFixed(3) + ' g remaining · Alert below ' + metal.limit.toFixed(3) + ' g</span></div>'
    ).join('');
    lowStockPanel.style.display = lowStockMetals.length ? 'block' : 'none';
    const oldMetalEntries = await getOldGold();
    const oldMetalWeight = metal => oldMetalEntries.filter(entry => String(entry.metal || 'gold').toLowerCase() === metal).reduce((total, entry) => total + (Number(entry.weight) || 0), 0);
    document.getElementById('dash-old-gold').textContent = oldMetalWeight('gold').toFixed(3) + ' g';
    document.getElementById('dash-old-silver').textContent = oldMetalWeight('silver').toFixed(3) + ' g';
    const liveRatesPanel = document.getElementById('liveRatesPanel');
    try {
      const response = await fetch('/api/live-rates' + (forceLiveRates ? '?refresh=1' : ''), { cache: 'no-store' });
      if (!response.ok) throw new Error('No live rate data');
      const liveRates = await response.json();
      document.getElementById('liveGoldRate').textContent = money(liveRates.goldPerGram);
      document.getElementById('liveSilverRate').textContent = money(liveRates.silverPerGram);
      const updated = Number(liveRates.updatedAt);
      document.getElementById('liveRatesUpdated').textContent = 'Updated ' + (Number.isFinite(updated) ? new Date(updated * 1000).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : 'just now');
      liveRatesPanel.style.display = 'block';
    } catch (_) {
      liveRatesPanel.style.display = 'none';
    }
  };
  const regeneratedModal = document.createElement('div');
  regeneratedModal.id = 'regeneratedInvoiceModal';
  regeneratedModal.className = 'modal-backdrop';
  regeneratedModal.innerHTML = '<div class="modal" style="max-width:900px; max-height:92vh; overflow:auto;"><div class="toolbar"><h3 id="regeneratedInvoiceTitle" style="margin:0;">Regenerated Invoice</h3><button class="btn btn-ghost btn-sm" id="closeRegeneratedInvoice">Close</button></div><div class="btn-row" style="margin:0 0 16px;"><button class="btn btn-gold btn-sm" id="printRegeneratedInvoice">🖨 Print Invoice</button><button class="btn btn-ghost btn-sm" id="downloadRegeneratedInvoice">⬇ Download PDF</button></div><div class="paper-outer" style="position:static;"><div id="regeneratedInvoiceContent"></div></div></div>';
  document.body.appendChild(regeneratedModal);
  document.getElementById('closeRegeneratedInvoice').addEventListener('click', () => regeneratedModal.classList.remove('open'));
  const reprintInvoice = record => {
    const fallback = '<div id="invoicePaper"><h2>Vishesh Jewellers</h2><p>Invoice: ' + safe(record.number) + '</p><p>Date: ' + safe(record.date) + '</p><p>Customer: ' + safe(record.customer) + '</p><p>Mobile: ' + safe(record.mobile || '—') + '</p><p>Items: ' + safe(record.items) + '</p><h3>Total: ' + safe(record.total) + '</h3></div>';
    document.getElementById('regeneratedInvoiceTitle').textContent = 'Invoice ' + record.number;
    document.getElementById('regeneratedInvoiceContent').innerHTML = record.invoiceMarkup || fallback;
    const paper = document.querySelector('#regeneratedInvoiceContent #invoicePaper');
    // Older saved invoice markup may still contain the retired circular seal.
    paper.querySelectorAll('#p-seal, .seal').forEach(element => element.remove());
    paper.querySelectorAll('.voided-invoice-watermark, .pending-invoice-watermark').forEach(element => element.remove());
    if (record.status === 'voided') {
      const watermark = document.createElement('div');
      watermark.className = 'voided-invoice-watermark';
      watermark.textContent = 'VOIDED';
      paper.appendChild(watermark);
    }
    if (record.status === 'pending') {
      const watermark = document.createElement('div');
      watermark.className = 'pending-invoice-watermark';
      watermark.textContent = 'PENDING DELIVERY';
      paper.appendChild(watermark);
    }
    const totals = paper.querySelector('#p-totals');
    if (totals) {
      totals.querySelectorAll('.payment-summary-line, .regenerated-payment-line').forEach(line => line.remove());
      const paid = Number(record.paid) || 0;
      const due = Number(record.due) || 0;
      const paymentLine = document.createElement('div');
      paymentLine.className = 'tl regenerated-payment-line';
      paymentLine.innerHTML = '<span>Amount Paid</span><b>₹' + money(paid).replace('₹', '') + '</b>';
      const dueLine = document.createElement('div');
      dueLine.className = 'tl regenerated-payment-line';
      dueLine.innerHTML = '<span>Amount Due</span><b>₹' + money(due).replace('₹', '') + '</b>';
      totals.appendChild(paymentLine);
      totals.appendChild(dueLine);
      const previousHistory = paper.querySelector('.regenerated-settlement-history');
      if (previousHistory) previousHistory.remove();
      const payments = (record.payments || []).map(payment => {
        const method = payment.method === 'gold' ? 'Gold' : payment.method === 'silver' ? 'Silver' : 'Amount';
        const detail = payment.weight ? ' (' + payment.weight + 'g × ₹' + payment.rate + '/g)' : '';
        return method + detail + ': ' + money(payment.amount);
      });
      const history = document.createElement('div');
      history.className = 'words-line regenerated-settlement-history';
      history.textContent = payments.length ? 'Settlement: ' + payments.join(' · ') : 'Settlement: No payment recorded';
      totals.insertAdjacentElement('afterend', history);
    }
    regeneratedModal.dataset.invoiceNumber = record.number;
    regeneratedModal.classList.add('open');
  };
  const voidModal = document.createElement('div');
  voidModal.id = 'voidInvoiceModal';
  voidModal.className = 'modal-backdrop';
  voidModal.innerHTML = '<div class="modal" style="max-width:520px;"><div class="toolbar"><h3 style="margin:0;">Void invoice</h3><button class="btn btn-ghost btn-sm" id="closeVoidInvoice">Close</button></div><p class="void-modal-note" id="voidInvoiceNote"></p><div class="field"><label>Reason for voiding *</label><input id="voidInvoiceReason" type="text" placeholder="e.g. Sale cancelled by customer"></div><div class="btn-row" style="margin-top:18px;"><button class="btn btn-gold" id="confirmVoidInvoice">Void invoice</button><button class="btn btn-ghost" id="cancelVoidInvoice">Cancel</button></div></div>';
  document.body.appendChild(voidModal);
  let activeVoidIndex = null;
  const closeVoidModal = () => { voidModal.classList.remove('open'); activeVoidIndex = null; };
  const openVoidModal = (record, index) => {
    if (record.status !== 'pending' && (!Array.isArray(record.soldItems) || !record.soldItems.length)) {
      alert('This older invoice does not have the stock-line details needed to safely void it.');
      return;
    }
    activeVoidIndex = index;
    document.getElementById('voidInvoiceReason').value = '';
    document.getElementById('voidInvoiceNote').textContent = record.status === 'pending' ? 'Pending order ' + record.number + ' will be cancelled. No stock has been deducted; linked old-metal exchange/settlement entries will be reversed.' : 'VJ invoice ' + record.number + ' will be marked void. Sold stock will be restored and linked old-metal exchange/settlement entries will be reversed. This cannot be undone from the app.';
    voidModal.classList.add('open');
  };
  document.getElementById('closeVoidInvoice').addEventListener('click', closeVoidModal);
  document.getElementById('cancelVoidInvoice').addEventListener('click', closeVoidModal);
  document.getElementById('confirmVoidInvoice').addEventListener('click', async () => {
    const reason = document.getElementById('voidInvoiceReason').value.trim();
    if (!reason) { alert('Enter a reason before voiding this invoice.'); return; }
    const records = await getRecords();
    const record = records[activeVoidIndex];
    if (!record || record.status === 'voided') { closeVoidModal(); return; }
    const stockResult = await window.storage.get('stock-list');
    const stockList = stockResult ? JSON.parse(stockResult.value || '[]') : [];
    for (const item of record.soldItems) {
      if (!stockList.find(stock => String(stock.id) === String(item.stockId))) {
        alert('The original stock item “' + item.name + '” no longer exists. The invoice was not voided.');
        return;
      }
    }
    record.soldItems.forEach(item => {
      const stock = stockList.find(stockItem => String(stockItem.id) === String(item.stockId));
      stock.net = (Number(stock.net) || 0) + (Number(item.net) || 0);
      stock.gross = (Number(stock.gross) || 0) + (Number(item.gross) || 0);
    });
    const oldMetalEntries = await getOldGold();
    const reversals = oldMetalEntries.filter(entry => entry.invoice === record.number && ['Invoice exchange', 'Gold settlement', 'Silver settlement'].includes(entry.source));
    const voidedAt = new Date().toISOString();
    record.status = 'voided';
    record.voidedAt = voidedAt;
    record.voidReason = reason;
    record.due = 0;
    await originalStorageSet('stock-list', JSON.stringify(stockList));
    await originalStorageSet('invoice-records', JSON.stringify(records));
    for (const entry of reversals) {
      await addOldGold({ sourceId: 'void:' + entry.sourceId, metal: entry.metal, source: 'Invoice void reversal', invoice: record.number, customer: record.customer, date: new Date(voidedAt).toLocaleDateString('en-GB'), weight: -(Number(entry.weight) || 0), rate: Number(entry.rate) || 0, value: -(Number(entry.value) || 0), receivedAt: voidedAt });
    }
    closeVoidModal();
    await renderRecords();
    if (document.getElementById('page-dashboard').classList.contains('active')) await renderDashboard();
  });
  const fullyPaidModal = document.createElement('div');
  fullyPaidModal.id = 'fullyPaidModal';
  fullyPaidModal.className = 'modal-backdrop';
  fullyPaidModal.innerHTML = '<div class="modal" style="max-width:450px;"><div class="toolbar"><h3 style="margin:0;">Confirm payment</h3><button class="btn btn-ghost btn-sm" id="closeFullyPaid">Close</button></div><p class="void-modal-note" id="fullyPaidNote"></p><div class="paid-confirm-amount" id="fullyPaidAmount">₹0.00</div><p class="void-modal-note">This will mark the invoice as fully paid and cannot be changed from this screen.</p><div class="btn-row" style="margin-top:18px;"><button class="btn btn-gold" id="confirmFullyPaid">Yes, mark fully paid</button><button class="btn btn-ghost" id="cancelFullyPaid">Cancel</button></div></div>';
  document.body.appendChild(fullyPaidModal);
  let fullyPaidResolver = null;
  const closeFullyPaidModal = confirmed => {
    fullyPaidModal.classList.remove('open');
    const resolve = fullyPaidResolver;
    fullyPaidResolver = null;
    if (resolve) resolve(Boolean(confirmed));
  };
  const confirmFullyPaid = (record, due) => new Promise(resolve => {
    fullyPaidResolver = resolve;
    document.getElementById('fullyPaidNote').textContent = 'Mark invoice ' + record.number + ' as fully paid?';
    document.getElementById('fullyPaidAmount').textContent = money(due);
    fullyPaidModal.classList.add('open');
  });
  document.getElementById('closeFullyPaid').addEventListener('click', () => closeFullyPaidModal(false));
  document.getElementById('cancelFullyPaid').addEventListener('click', () => closeFullyPaidModal(false));
  document.getElementById('confirmFullyPaid').addEventListener('click', () => closeFullyPaidModal(true));
  const invoiceSuccessModal = document.createElement('div');
  invoiceSuccessModal.id = 'invoiceSuccessModal';
  invoiceSuccessModal.className = 'modal-backdrop';
  invoiceSuccessModal.innerHTML = '<div class="modal" style="max-width:430px; text-align:center;"><div class="invoice-success-icon">✓</div><h3 id="invoiceSuccessTitle" style="margin:0;">Invoice generated</h3><p class="void-modal-note" id="invoiceSuccessNote">Stock has been updated and the invoice was saved successfully.</p><div class="invoice-success-number" id="generatedInvoiceNumber">—</div><div class="btn-row" style="margin-top:18px; justify-content:center;"><button class="btn btn-gold" id="viewGeneratedInvoice">View Invoice</button><button class="btn btn-ghost" id="closeInvoiceSuccess">Done</button></div></div>';
  document.body.appendChild(invoiceSuccessModal);
  let generatedInvoiceRecord = null;
  const showInvoiceSuccess = record => {
    generatedInvoiceRecord = record;
    const pending = record.status === 'pending';
    document.getElementById('invoiceSuccessTitle').textContent = pending ? 'Pending order saved' : 'Invoice generated';
    document.getElementById('invoiceSuccessNote').textContent = pending ? 'The order was saved successfully. Stock will be selected and deducted only when you deliver it from Records.' : 'Stock has been updated and the invoice was saved successfully.';
    document.getElementById('viewGeneratedInvoice').textContent = pending ? 'View Pending Invoice' : 'View Invoice';
    document.getElementById('generatedInvoiceNumber').textContent = record.number;
    invoiceSuccessModal.classList.add('open');
  };
  document.getElementById('closeInvoiceSuccess').addEventListener('click', () => invoiceSuccessModal.classList.remove('open'));
  document.getElementById('viewGeneratedInvoice').addEventListener('click', () => {
    if (!generatedInvoiceRecord) return;
    invoiceSuccessModal.classList.remove('open');
    reprintInvoice(generatedInvoiceRecord);
  });
  const editInvoiceModal = document.createElement('div');
  editInvoiceModal.id = 'editInvoiceModal';
  editInvoiceModal.className = 'modal-backdrop';
  editInvoiceModal.innerHTML = '<div class="modal" style="max-width:980px; max-height:92vh; overflow:auto;"><div class="toolbar"><h3 style="margin:0;">Edit Invoice</h3><button class="btn btn-ghost btn-sm" id="closeEditInvoice">Close</button></div><p class="void-modal-note">Update this active invoice completely. Saving recalculates totals and safely reconciles stock and exchanged metal.</p><div class="form-grid"><div class="field"><label>Invoice date *</label><input id="editInvoiceDate" type="date"></div><div class="field"><label>Customer name *</label><input id="editInvoiceCustomer" type="text"></div><div class="field"><label>Mobile number</label><input id="editInvoiceMobile" type="tel"></div><div class="field"><label>Address</label><input id="editInvoiceAddress" type="text"></div></div><div class="field" style="margin-top:14px;"><label>Terms &amp; conditions</label><textarea id="editInvoiceTerms" style="min-height:70px;"></textarea></div><div class="toolbar" style="margin-top:20px;"><h4 style="margin:0;">Items</h4><button class="btn btn-ghost btn-sm" id="addEditItem" type="button">+ Add item</button></div><div class="items-table-wrap"><table class="itable"><thead><tr><th>From stock</th><th>Item</th><th>Purity</th><th>Gross Wt (g)</th><th>Net Wt (g)</th><th>Rate (₹/g)</th><th>Making %</th><th>Amount</th><th></th></tr></thead><tbody id="editInvoiceItems"></tbody></table></div><div class="toolbar" style="margin-top:20px;"><h4 style="margin:0;">Gold / Silver Exchange</h4><button class="btn btn-ghost btn-sm" id="addEditExchange" type="button">+ Add exchange item</button></div><div id="editInvoiceExchangeRows" class="exchange-rows"></div><div class="form-grid" style="margin-top:18px;"><div class="field"><label>Manual discount (₹)</label><input id="editInvoiceDiscount" type="number" min="0" step="0.01" value="0"></div><div class="field"><label>GST rate</label><select id="editInvoiceGst"><option value="3">3% (CGST + SGST)</option><option value="0">0% (Exempt)</option></select></div><div class="field"><label>Amount paid at invoice (₹)</label><input id="editInvoicePaid" type="number" min="0" step="0.01" value="0"></div><div class="field"><label>Revised total</label><div class="payment-balance" id="editInvoiceTotal">₹0.00</div></div></div><div class="record-info-grid" style="margin:14px 0 0;"><div class="record-info"><b>Items subtotal</b><span id="editInvoiceSubtotal">₹0.00</span></div><div class="record-info"><b>Exchange credit</b><span id="editInvoiceExchange">₹0.00</span></div><div class="record-info"><b>Amount due</b><span class="due-amount" id="editInvoiceDue">₹0.00</span></div></div><div class="btn-row" style="margin-top:20px;"><button class="btn btn-gold" id="saveInvoiceEdit">Save Revised Invoice</button><button class="btn btn-ghost" id="cancelInvoiceEdit">Cancel</button></div></div>';
  document.body.appendChild(editInvoiceModal);
  document.querySelector('#editInvoiceGst option[value="3"]').textContent = 'GST Invoice — 3%';
  document.querySelector('#editInvoiceGst option[value="0"]').textContent = 'Non-GST Invoice — No GST charged';
  let activeEditInvoiceIndex = null;
  let editInvoiceState = { items: [], exchanges: [], stock: [], record: null };
  const closeEditInvoiceModal = () => { editInvoiceModal.classList.remove('open'); activeEditInvoiceIndex = null; };
  const editMoney = value => money(Number(value) || 0);
  const editItemAmount = item => (Number(item.net) || 0) * (Number(item.rate) || 0) * (1 + (Number(item.making) || 0) / 100);
  const editInitialPaidFor = record => {
    if (Number.isFinite(Number(record.initialPaid))) return Number(record.initialPaid);
    const payments = Array.isArray(record.payments) ? record.payments : [];
    const initialPayment = payments.find(payment => payment.initialPayment) || payments.find(payment => payment.settledAt && record.savedAt && Math.abs(new Date(payment.settledAt) - new Date(record.savedAt)) < 60_000);
    return initialPayment ? Number(initialPayment.amount) || 0 : Math.max((Number(record.paid) || 0) - payments.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0), 0);
  };
  const editTotals = () => {
    const subtotal = editInvoiceState.items.reduce((sum, item) => sum + editItemAmount(item), 0);
    const exchange = editInvoiceState.exchanges.reduce((sum, item) => sum + (Number(item.weight) || 0) * (Number(item.rate) || 0), 0);
    const discount = Math.max(Number(document.getElementById('editInvoiceDiscount').value) || 0, 0);
    const gstRate = Math.max(Number(document.getElementById('editInvoiceGst').value) || 0, 0);
    // Keep the editor consistent with invoice creation: tax applies to the
    // full item value, while exchange and discount reduce the final payable.
    const tax = subtotal * gstRate / 100;
    const total = Math.round(Math.max(subtotal + tax - exchange - discount, 0));
    const settlementPaid = Math.max((Number(editInvoiceState.record.paid) || 0) - editInitialPaidFor(editInvoiceState.record), 0);
    const invoicePaid = Math.max(Number(document.getElementById('editInvoicePaid').value) || 0, 0);
    const due = Math.max(total - invoicePaid - settlementPaid, 0);
    document.getElementById('editInvoiceSubtotal').textContent = editMoney(subtotal);
    document.getElementById('editInvoiceExchange').textContent = editMoney(exchange);
    document.getElementById('editInvoiceTotal').textContent = editMoney(total);
    document.getElementById('editInvoiceDue').textContent = editMoney(due);
    return { subtotal, exchange, discount, gstRate, tax, total, invoicePaid, settlementPaid, due };
  };
  const renderEditItems = () => {
    const body = document.getElementById('editInvoiceItems');
    body.innerHTML = editInvoiceState.items.map((item, index) => {
      const options = ['<option value="">— select stock item —</option>'].concat(editInvoiceState.stock.filter(stock => (Number(stock.net) || Number(stock.gross) || 0) > 0 || stock.id === item.stockId).map(stock => '<option value="' + safe(stock.id) + '" ' + (stock.id === item.stockId ? 'selected' : '') + '>' + safe(stock.item + ' · ' + stock.purity + ' · ' + (Number(stock.net) || 0).toFixed(3) + ' g') + '</option>')).join('');
      return '<tr data-edit-item="' + index + '"><td><select class="edit-stock">' + options + '</select></td><td>' + safe(item.name || '—') + '</td><td>' + safe(item.purity || '—') + '</td><td><input class="edit-gross" type="number" min="0" step="0.001" value="' + (Number(item.gross) || 0) + '"></td><td><input class="edit-net" type="number" min="0" step="0.001" value="' + (Number(item.net) || 0) + '"></td><td><input class="edit-rate" type="number" min="0" step="0.01" value="' + (Number(item.rate) || 0) + '"></td><td><input class="edit-making" type="number" min="0" step="0.01" value="' + (Number(item.making) || 0) + '"></td><td class="edit-item-total">' + editMoney(editItemAmount(item)) + '</td><td><button class="btn btn-ghost btn-sm edit-item-remove" type="button">×</button></td></tr>';
    }).join('') || '<tr><td colspan="9" style="text-align:center; padding:16px;">Add at least one stock item.</td></tr>';
  };
  const renderEditExchanges = () => {
    const container = document.getElementById('editInvoiceExchangeRows');
    container.innerHTML = editInvoiceState.exchanges.map((entry, index) => '<div class="exchange-row" data-edit-exchange="' + index + '"><div class="field"><label>Metal</label><select class="edit-exchange-metal"><option value="gold" ' + (entry.metal === 'gold' ? 'selected' : '') + '>Gold</option><option value="silver" ' + (entry.metal === 'silver' ? 'selected' : '') + '>Silver</option></select></div><div class="field"><label>Weight (g)</label><input class="edit-exchange-weight" type="number" min="0" step="0.001" value="' + (Number(entry.weight) || 0) + '"></div><div class="field"><label>Rate / gram (₹)</label><input class="edit-exchange-rate" type="number" min="0" step="0.01" value="' + (Number(entry.rate) || 0) + '"></div><div class="field"><label>Value</label><div class="exchange-row-value">' + editMoney((Number(entry.weight) || 0) * (Number(entry.rate) || 0)) + '</div></div><button class="btn btn-ghost btn-sm edit-exchange-remove" type="button">×</button></div>').join('') || '<p class="sub" style="margin:0;">No exchange items added.</p>';
  };
  const refreshEditInvoice = () => { renderEditItems(); renderEditExchanges(); editTotals(); };
  const openEditInvoiceModal = async (record, index) => {
    activeEditInvoiceIndex = index;
    const stockResult = await window.storage.get('stock-list');
    editInvoiceState.stock = stockResult ? JSON.parse(stockResult.value) : [];
    editInvoiceState.record = record;
    const exchanges = Array.isArray(record.exchanges) ? record.exchanges : record.exchange ? [record.exchange] : [];
    const totalExchange = exchanges.reduce((sum, entry) => sum + (Number(entry.value) || (Number(entry.weight) || 0) * (Number(entry.rate) || 0)), 0);
    editInvoiceState.items = ((record.status === 'pending' ? record.orderItems : record.soldItems) || []).map((item, itemIndex) => Object.assign({ lineId: item.lineId || ('edit-' + itemIndex), hsn: item.hsn || '' }, item));
    editInvoiceState.exchanges = exchanges.map(entry => ({ metal: entry.metal === 'silver' ? 'silver' : 'gold', weight: Number(entry.weight) || 0, rate: Number(entry.rate) || 0 }));
    document.getElementById('editInvoiceDate').value = record.invoiceDate || (record.savedAt ? record.savedAt.slice(0, 10) : '');
    document.getElementById('editInvoiceCustomer').value = record.customer || '';
    document.getElementById('editInvoiceMobile').value = record.mobile || '';
    document.getElementById('editInvoiceAddress').value = record.address || '';
    const markupPreview = document.createElement('div');
    markupPreview.innerHTML = record.invoiceMarkup || '';
    document.getElementById('editInvoiceTerms').value = record.terms || (markupPreview.querySelector('#p-terms') ? markupPreview.querySelector('#p-terms').textContent : '');
    document.getElementById('editInvoiceDiscount').value = Math.max(Number.isFinite(Number(record.manualDiscount)) ? Number(record.manualDiscount) : amount(record.discount) - totalExchange, 0).toFixed(2);
    document.getElementById('editInvoiceGst').value = String(record.gstRate != null ? Number(record.gstRate) : (amount(record.tax) > 0 ? 3 : 0));
    document.getElementById('editInvoicePaid').value = editInitialPaidFor(record).toFixed(2);
    refreshEditInvoice();
    editInvoiceModal.classList.add('open');
  };
  document.getElementById('closeEditInvoice').addEventListener('click', closeEditInvoiceModal);
  document.getElementById('cancelInvoiceEdit').addEventListener('click', closeEditInvoiceModal);
  document.getElementById('addEditItem').addEventListener('click', () => { editInvoiceState.items.push({ lineId: 'edit-' + Date.now(), stockId: '', name: '', purity: '', gross: 0, net: 0, rate: 0, making: 0 }); refreshEditInvoice(); });
  document.getElementById('addEditExchange').addEventListener('click', () => { editInvoiceState.exchanges.push({ metal: 'gold', weight: 0, rate: 0 }); refreshEditInvoice(); });
  document.getElementById('editInvoiceItems').addEventListener('change', event => {
    const row = event.target.closest('[data-edit-item]'); if (!row) return;
    const item = editInvoiceState.items[Number(row.dataset.editItem)];
    if (event.target.classList.contains('edit-stock')) {
      const stock = editInvoiceState.stock.find(entry => entry.id === event.target.value);
      item.stockId = stock ? stock.id : '';
      item.name = stock ? stock.item : '';
      item.purity = stock ? stock.purity : '';
      refreshEditInvoice();
    }
  });
  document.getElementById('editInvoiceItems').addEventListener('input', event => {
    const row = event.target.closest('[data-edit-item]'); if (!row) return;
    const item = editInvoiceState.items[Number(row.dataset.editItem)];
    const property = event.target.classList.contains('edit-gross') ? 'gross' : event.target.classList.contains('edit-net') ? 'net' : event.target.classList.contains('edit-rate') ? 'rate' : event.target.classList.contains('edit-making') ? 'making' : null;
    if (!property) return;
    item[property] = Math.max(Number(event.target.value) || 0, 0);
    row.querySelector('.edit-item-total').textContent = editMoney(editItemAmount(item));
    editTotals();
  });
  document.getElementById('editInvoiceItems').addEventListener('click', event => {
    const button = event.target.closest('.edit-item-remove'); if (!button) return;
    editInvoiceState.items.splice(Number(button.closest('[data-edit-item]').dataset.editItem), 1); refreshEditInvoice();
  });
  document.getElementById('editInvoiceExchangeRows').addEventListener('input', event => {
    const row = event.target.closest('[data-edit-exchange]'); if (!row) return;
    const entry = editInvoiceState.exchanges[Number(row.dataset.editExchange)];
    if (event.target.classList.contains('edit-exchange-weight')) entry.weight = Math.max(Number(event.target.value) || 0, 0);
    if (event.target.classList.contains('edit-exchange-rate')) entry.rate = Math.max(Number(event.target.value) || 0, 0);
    row.querySelector('.exchange-row-value').textContent = editMoney(entry.weight * entry.rate); editTotals();
  });
  document.getElementById('editInvoiceExchangeRows').addEventListener('change', event => {
    const row = event.target.closest('[data-edit-exchange]'); if (!row) return;
    if (event.target.classList.contains('edit-exchange-metal')) editInvoiceState.exchanges[Number(row.dataset.editExchange)].metal = event.target.value;
  });
  document.getElementById('editInvoiceExchangeRows').addEventListener('click', event => {
    const button = event.target.closest('.edit-exchange-remove'); if (!button) return;
    editInvoiceState.exchanges.splice(Number(button.closest('[data-edit-exchange]').dataset.editExchange), 1); refreshEditInvoice();
  });
  ['editInvoiceDiscount', 'editInvoiceGst', 'editInvoicePaid'].forEach(id => document.getElementById(id).addEventListener('input', editTotals));
  document.getElementById('saveInvoiceEdit').addEventListener('click', async () => {
    const records = await getRecords();
    const record = records[activeEditInvoiceIndex];
    if (!record || record.status === 'voided') { closeEditInvoiceModal(); return; }
    const invoiceDate = document.getElementById('editInvoiceDate').value;
    const customer = document.getElementById('editInvoiceCustomer').value.trim();
    if (!invoiceDate || !customer) { alert('Invoice date and customer name are required.'); return; }
    const mobile = document.getElementById('editInvoiceMobile').value.trim();
    const address = document.getElementById('editInvoiceAddress').value.trim();
    const terms = document.getElementById('editInvoiceTerms').value.trim();
    const items = editInvoiceState.items.filter(item => item.stockId);
    if (!items.length || items.length !== editInvoiceState.items.length || items.some(item => !((Number(item.gross) > 0) || (Number(item.net) > 0)) || !(Number(item.rate) > 0))) { alert('Select a stock item and enter its weight and rate for every item row.'); return; }
    const totals = editTotals();
    const displayDate = new Date(invoiceDate + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const stockResult = await window.storage.get('stock-list');
    const stockList = stockResult ? JSON.parse(stockResult.value) : [];
    (record.soldItems || []).forEach(item => {
      let stock = stockList.find(entry => entry.id === item.stockId);
      if (!stock) { stock = { id: item.stockId, item: item.name || 'Restored item', purity: item.purity || '', qty: 1, gross: 0, net: 0, added: 'Restored from ' + record.number }; stockList.push(stock); }
      stock.gross = (Number(stock.gross) || 0) + (Number(item.gross) || 0);
      stock.net = (Number(stock.net) || 0) + (Number(item.net) || 0);
    });
    const requested = new Map();
    items.forEach(item => {
      const requestedItem = requested.get(item.stockId) || { gross: 0, net: 0, name: item.name };
      requestedItem.gross += Number(item.gross) || 0; requestedItem.net += Number(item.net) || 0; requested.set(item.stockId, requestedItem);
    });
    for (const [stockId, requestedItem] of requested) {
      const stock = stockList.find(entry => entry.id === stockId);
      if (!stock || requestedItem.gross > (Number(stock.gross) || 0) + 0.0001 || requestedItem.net > (Number(stock.net) || 0) + 0.0001) { alert('Not enough remaining stock weight for "' + requestedItem.name + '".'); return; }
    }
    requested.forEach((requestedItem, stockId) => { const stock = stockList.find(entry => entry.id === stockId); stock.gross = Math.max((Number(stock.gross) || 0) - requestedItem.gross, 0); stock.net = Math.max((Number(stock.net) || 0) - requestedItem.net, 0); stock.qty = 1; });
    const exchanges = editInvoiceState.exchanges.filter(entry => Number(entry.weight) > 0).map(entry => Object.assign({}, entry, { value: Number(entry.weight) * Number(entry.rate) }));
    const previousInitialPaid = editInitialPaidFor(record);
    record.invoiceDate = invoiceDate;
    record.date = displayDate;
    record.customer = customer;
    record.mobile = mobile;
    record.address = address;
    record.terms = terms;
    record.soldItems = items.map((item, itemIndex) => Object.assign({}, item, { lineId: item.lineId || ('edit-' + itemIndex) }));
    if (record.status === 'pending') {
      record.status = 'completed';
      record.deliveredAt = new Date().toISOString();
    }
    record.items = items.map(item => item.name).join(', ');
    record.exchanges = exchanges;
    record.manualDiscount = totals.discount;
    record.gstRate = totals.gstRate;
    record.subtotal = editMoney(totals.subtotal);
    record.discount = editMoney(totals.exchange + totals.discount);
    record.tax = editMoney(totals.tax);
    record.total = editMoney(totals.total);
    record.initialPaid = totals.invoicePaid;
    record.paid = totals.invoicePaid + Math.max((Number(record.paid) || 0) - previousInitialPaid, 0);
    record.due = Math.max(totals.total - record.paid, 0);
    record.payments = Array.isArray(record.payments) ? record.payments : [];
    const savedInitialPayment = record.payments.find(payment => payment.initialPayment) || record.payments.find(payment => payment.settledAt && record.savedAt && Math.abs(new Date(payment.settledAt) - new Date(record.savedAt)) < 60_000);
    if (savedInitialPayment) { savedInitialPayment.amount = totals.invoicePaid; savedInitialPayment.initialPayment = true; }
    else if (totals.invoicePaid > 0) record.payments.push({ method: 'amount', amount: totals.invoicePaid, initialPayment: true, settledAt: record.savedAt || new Date().toISOString() });
    const preview = document.createElement('div');
    preview.innerHTML = record.invoiceMarkup || '<div id="invoicePaper"><tbody id="p-items-body"></tbody><div id="p-totals"></div></div>';
    const paper = preview.querySelector('#invoicePaper');
    if (paper) {
      const setText = (selector, value) => { const element = paper.querySelector(selector); if (element) element.textContent = value; };
      setText('#p-cust-name', customer); setText('#p-cust-address', [address, mobile ? 'Mob: ' + mobile : ''].filter(Boolean).join(' · ')); setText('#p-date', displayDate);
      setText('#p-terms', terms);
      const body = paper.querySelector('#p-items-body');
      if (body) body.innerHTML = items.map((item, itemIndex) => '<tr><td>' + (itemIndex + 1) + '</td><td>' + safe(item.name) + '</td><td class="num">' + safe(item.hsn || '') + '</td><td>' + safe(item.purity) + '</td><td class="num">' + (Number(item.gross) || 0).toFixed(3) + '</td><td class="num">' + (Number(item.net) || 0).toFixed(3) + '</td><td class="num">1</td><td class="num">' + (Number(item.rate) || 0).toFixed(2) + '</td><td class="num">' + (Number(item.making) || 0).toFixed(2) + '%</td><td class="num">' + editItemAmount(item).toFixed(2) + '</td></tr>').join('');
      const totalsPanel = paper.querySelector('#p-totals');
      if (totalsPanel) totalsPanel.innerHTML = '<div class="tl"><span>Total</span><b>' + editMoney(totals.subtotal) + '</b></div><div class="tl"><span>Exchange / Discount</span><b>' + editMoney(totals.exchange + totals.discount) + '</b></div><div class="tl"><span>CGST ' + (totals.gstRate / 2) + '%</span><b>' + editMoney(totals.tax / 2) + '</b></div><div class="tl"><span>SGST ' + (totals.gstRate / 2) + '%</span><b>' + editMoney(totals.tax / 2) + '</b></div><div class="gt"><span>Grand Total</span><b>' + editMoney(totals.total) + '</b></div>';
      const words = paper.querySelector('#p-words'); if (words && typeof numToWords === 'function') words.textContent = totals.total > 0 ? 'Rs. ' + numToWords(totals.total) + ' Only' : '';
      setText('#p-gstin', totals.gstRate === 0 ? 'NON-GST INVOICE' : 'GSTIN: ' + (record.gstin || '—'));
      if (totals.gstRate === 0 && totalsPanel) {
        totalsPanel.querySelectorAll('.tl').forEach(line => {
          if (/^(CGST|SGST)/.test(line.textContent.trim())) line.remove();
        });
      }
      record.invoiceMarkup = paper.outerHTML;
    }
    const oldMetal = await getOldGold();
    const remainingOldMetal = oldMetal.filter(entry => !String(entry.sourceId || '').startsWith(record.number + ':exchange:'));
    exchanges.forEach((entry, exchangeIndex) => remainingOldMetal.unshift({ sourceId: record.number + ':exchange:' + entry.metal + ':' + exchangeIndex, metal: entry.metal, source: 'Invoice exchange', invoice: record.number, customer: customer, date: displayDate, weight: entry.weight, rate: entry.rate, value: entry.value, receivedAt: record.savedAt }));
    await originalStorageSet('stock-list', JSON.stringify(stockList));
    await originalStorageSet('old-gold-records', JSON.stringify(remainingOldMetal));
    await originalStorageSet('invoice-records', JSON.stringify(records));
    closeEditInvoiceModal();
    await renderRecords();
  });
  const returnModal = document.createElement('div');
  returnModal.id = 'returnInvoiceModal';
  returnModal.className = 'modal-backdrop';
  returnModal.innerHTML = '<div class="modal" style="max-width:760px;"><div class="toolbar"><h3 style="margin:0;">Return items</h3><button class="btn btn-ghost btn-sm" id="closeReturnInvoice">Close</button></div><p class="muted" id="returnInvoiceLabel" style="margin:12px 0 0;"></p><div id="returnItems" class="return-items"></div><div class="return-summary"><span>Return / credit-note value</span><b id="returnAmount">₹0.00</b></div><div class="return-form-grid"><div class="field"><label>Adjustment</label><select id="returnMethod"><option value="due">Reduce amount due</option><option value="cash">Cash refund</option><option value="credit">Customer credit</option><option value="old-metal">Cash and/or return old metal</option></select></div><div class="field return-reason-field"><label>Reason (optional)</label><input id="returnReason" type="text" placeholder="e.g. Size issue"></div></div><div id="returnOldMetalPanel" class="return-metal-panel"><div class="field"><label>Original exchange metal</label><select id="returnOldMetal"></select></div><div class="field"><label>Return wt. (g)</label><input id="returnOldMetalWeight" type="number" min="0" step="0.001" value="0"></div><div class="field"><label>Cash to return (₹) · auto</label><input id="returnCashRefund" type="number" min="0" step="0.01" value="0" readonly></div><div class="field"><label>Metal return value</label><div id="returnOldMetalValue" class="return-metal-value">₹0.00</div></div></div><div class="btn-row" style="margin-top:18px;"><button class="btn btn-gold" id="saveReturnInvoice">Save return</button><button class="btn btn-ghost" id="cancelReturnInvoice">Cancel</button></div></div>';
  document.body.appendChild(returnModal);
  let activeReturnRecord = null;
  let activeReturnIndex = null;
  const returnableItems = record => (record.soldItems || []).map(item => {
    const returned = (record.returns || []).reduce((sum, returnEntry) => sum + (returnEntry.items || []).filter(returnItem => returnItem.lineId === item.lineId).reduce((itemSum, returnItem) => itemSum + (Number(returnItem.net) || 0), 0), 0);
    return Object.assign({}, item, { remainingNet: Math.max((Number(item.net) || 0) - returned, 0) });
  }).filter(item => item.remainingNet > 0.000001);
  const returnableExchanges = record => (Array.isArray(record.exchanges) ? record.exchanges : record.exchange ? [record.exchange] : []).map((exchange, exchangeIndex) => {
    const returned = (record.returns || []).reduce((sum, returnEntry) => sum + (returnEntry.oldMetal && Number(returnEntry.oldMetal.exchangeIndex) === exchangeIndex ? (Number(returnEntry.oldMetal.weight) || 0) : 0), 0);
    return Object.assign({}, exchange, { exchangeIndex, remainingWeight: Math.max((Number(exchange.weight) || 0) - returned, 0) });
  }).filter(exchange => ['gold', 'silver'].includes(String(exchange.metal || '').toLowerCase()) && exchange.remainingWeight > 0.000001);
  const selectedReturnExchange = () => {
    if (!activeReturnRecord) return null;
    const exchangeIndex = Number(document.getElementById('returnOldMetal').value);
    return returnableExchanges(activeReturnRecord).find(exchange => exchange.exchangeIndex === exchangeIndex) || null;
  };
  const updateOldMetalReturn = () => {
    const exchange = selectedReturnExchange();
    const input = document.getElementById('returnOldMetalWeight');
    const value = exchange ? Math.max(Number(input.value) || 0, 0) * (Number(exchange.rate) || 0) : 0;
    input.max = exchange ? exchange.remainingWeight : 0;
    document.getElementById('returnOldMetalValue').textContent = money(value);
    if (activeReturnRecord && document.getElementById('returnMethod').value === 'old-metal') {
      const returnAmount = calculateReturnAmount(activeReturnRecord);
      document.getElementById('returnCashRefund').value = Math.max(returnAmount - value, 0).toFixed(2);
    }
  };
  const updateReturnMethod = () => {
    const isOldMetal = document.getElementById('returnMethod').value === 'old-metal';
    document.getElementById('returnOldMetalPanel').classList.toggle('visible', isOldMetal);
    if (isOldMetal) updateOldMetalReturn();
  };
  const calculateReturnAmount = record => {
    const items = returnableItems(record);
    const originalBase = (record.soldItems || []).reduce((sum, item) => sum + (Number(item.net) || 0) * (Number(item.rate) || 0) * (1 + (Number(item.making) || 0) / 100), 0);
    const returnedBase = items.reduce((sum, item, index) => {
      const input = document.querySelector('[data-return-index="' + index + '"]');
      return sum + (Number(input && input.value) || 0) * (Number(item.rate) || 0) * (1 + (Number(item.making) || 0) / 100);
    }, 0);
    return originalBase > 0 ? returnedBase / originalBase * amount(record.total) : 0;
  };
  const updateReturnAmount = () => {
    if (!activeReturnRecord) return;
    document.getElementById('returnAmount').textContent = money(calculateReturnAmount(activeReturnRecord));
    if (document.getElementById('returnMethod').value === 'old-metal') updateOldMetalReturn();
  };
  const openReturnModal = (record, index) => {
    if (!Array.isArray(record.soldItems) || !record.soldItems.length) {
      alert('This older invoice does not have the stock-line details needed for a safe return. Returns are available for invoices created after this update.');
      return;
    }
    const items = returnableItems(record);
    if (!items.length) { alert('All stock-backed items on this invoice have already been returned.'); return; }
    activeReturnRecord = record;
    activeReturnIndex = index;
    document.getElementById('returnInvoiceLabel').textContent = 'Invoice ' + record.number + ' · enter only the net weight being returned.';
    document.getElementById('returnReason').value = '';
    document.getElementById('returnMethod').value = 'due';
    const exchanges = returnableExchanges(record);
    document.getElementById('returnOldMetal').innerHTML = exchanges.length ? exchanges.map(exchange => '<option value="' + exchange.exchangeIndex + '">' + safe(String(exchange.metal).replace(/^./, character => character.toUpperCase())) + ' · ' + exchange.remainingWeight.toFixed(3) + ' g available · ₹' + (Number(exchange.rate) || 0).toFixed(2) + '/g</option>').join('') : '<option value="">No returnable exchanged metal</option>';
    document.getElementById('returnOldMetalWeight').value = '0';
    document.getElementById('returnCashRefund').value = '0';
    document.getElementById('returnItems').innerHTML = items.map((item, itemIndex) => '<div class="return-item"><div><div class="return-item-title">' + safe(item.name || 'Stock item') + '</div><div class="return-item-meta">Available to return: ' + item.remainingNet.toFixed(3) + ' g · Original rate ₹' + (Number(item.rate) || 0).toFixed(2) + '/g</div></div><div class="field" style="min-width:140px;"><label>Return wt. (g)</label><input type="number" min="0" max="' + item.remainingNet + '" step="0.001" value="0" data-return-index="' + itemIndex + '"></div></div>').join('');
    updateReturnMethod();
    updateReturnAmount();
    returnModal.classList.add('open');
  };
  const closeReturnModal = () => {
    returnModal.classList.remove('open');
    activeReturnRecord = null;
    activeReturnIndex = null;
  };
  document.getElementById('closeReturnInvoice').addEventListener('click', closeReturnModal);
  document.getElementById('cancelReturnInvoice').addEventListener('click', closeReturnModal);
  document.getElementById('returnItems').addEventListener('input', updateReturnAmount);
  document.getElementById('returnMethod').addEventListener('change', updateReturnMethod);
  document.getElementById('returnOldMetal').addEventListener('change', updateOldMetalReturn);
  document.getElementById('returnOldMetalWeight').addEventListener('input', updateOldMetalReturn);
  document.getElementById('saveReturnInvoice').addEventListener('click', async () => {
    if (!activeReturnRecord || activeReturnIndex === null) return;
    const records = await getRecords();
    const record = records[activeReturnIndex];
    if (!record) { closeReturnModal(); return; }
    const items = returnableItems(record);
    const returnedItems = [];
    for (let index = 0; index < items.length; index += 1) {
      const input = document.querySelector('[data-return-index="' + index + '"]');
      const returnNet = Number(input && input.value) || 0;
      if (returnNet < 0 || returnNet > items[index].remainingNet + 0.000001) {
        alert('Each return weight must be between 0 and its available return weight.');
        return;
      }
      if (returnNet > 0) {
        const originalNet = Number(items[index].net) || 0;
        returnedItems.push(Object.assign({}, items[index], { returnedNet: returnNet, returnedGross: originalNet > 0 ? (Number(items[index].gross) || 0) * returnNet / originalNet : returnNet }));
      }
    }
    if (!returnedItems.length) { alert('Enter a return weight for at least one item.'); return; }
    const returnAmount = calculateReturnAmount(record);
    const method = document.getElementById('returnMethod').value;
    const paid = Number(record.paid) || 0;
    const due = Number(record.due) || 0;
    let oldMetal = null;
    let cashRefund = 0;
    if (method === 'old-metal') {
      const exchange = selectedReturnExchange();
      const weight = Number(document.getElementById('returnOldMetalWeight').value) || 0;
      cashRefund = Math.max(Number(document.getElementById('returnCashRefund').value) || 0, 0);
      if (weight > 0) {
        if (!exchange || weight > exchange.remainingWeight + 0.000001) {
          alert('Choose an original exchange entry and enter a valid old-metal return weight.');
          return;
        }
        const oldMetalEntries = await getOldGold();
        const metal = String(exchange.metal).toLowerCase();
        const available = oldMetalEntries.filter(entry => String(entry.metal || '').toLowerCase() === metal).reduce((total, entry) => total + (Number(entry.weight) || 0), 0);
        if (weight > available + 0.000001) {
          alert('Only ' + available.toFixed(3) + ' g of old ' + metal + ' is currently available to return.');
          return;
        }
        oldMetal = { exchangeIndex: exchange.exchangeIndex, metal, weight, rate: Number(exchange.rate) || 0, value: weight * (Number(exchange.rate) || 0) };
      }
      const refundTotal = cashRefund + (oldMetal ? oldMetal.value : 0);
      if (!(refundTotal > 0) || Math.abs(refundTotal - returnAmount) > 0.01) {
        alert('Cash plus old-metal value must exactly match the return / credit-note value of ' + money(returnAmount) + '.');
        return;
      }
      if (cashRefund > paid + 0.001) {
        alert('Cash to return cannot exceed the recorded cash payment of ' + money(paid) + '.');
        return;
      }
    }
    if (method === 'cash' && returnAmount > paid + 0.001) {
      alert('A cash refund cannot exceed the amount paid (' + money(paid) + '). Choose customer credit or reduce the due amount.');
      return;
    }
    if (method === 'due' && returnAmount > due + 0.001) {
      alert('This return is larger than the outstanding due (' + money(due) + '). Choose customer credit or cash refund for the balance.');
      return;
    }
    const stockResult = await window.storage.get('stock-list');
    const stockList = stockResult ? JSON.parse(stockResult.value || '[]') : [];
    for (const item of returnedItems) {
      if (!stockList.find(stock => String(stock.id) === String(item.stockId))) {
        alert('The original stock item “' + item.name + '” no longer exists. The return was not saved.');
        return;
      }
    }
    returnedItems.forEach(item => {
      const stock = stockList.find(stockItem => String(stockItem.id) === String(item.stockId));
      stock.net = (Number(stock.net) || 0) + item.returnedNet;
      stock.gross = (Number(stock.gross) || 0) + item.returnedGross;
    });
    record.returns = Array.isArray(record.returns) ? record.returns : [];
    const savedAt = new Date().toISOString();
    const returnEntry = {
      noteNumber: record.number + '-R' + String(record.returns.length + 1).padStart(2, '0'),
      items: returnedItems.map(item => ({ lineId: item.lineId, stockId: item.stockId, name: item.name, net: item.returnedNet, gross: item.returnedGross })),
      amount: returnAmount,
      method,
      oldMetal,
      cashRefund: method === 'old-metal' ? cashRefund : 0,
      reason: document.getElementById('returnReason').value.trim(),
      savedAt
    };
    record.returns.unshift(returnEntry);
    record.returnTotal = (Number(record.returnTotal) || 0) + returnAmount;
    if (method === 'cash') record.paid = Math.max(paid - returnAmount, 0);
    if (method === 'old-metal') record.paid = Math.max(paid - cashRefund, 0);
    if (method === 'credit') record.customerCredit = (Number(record.customerCredit) || 0) + returnAmount;
    record.due = Math.max(recordNetTotal(record) - (Number(record.paid) || 0), 0);
    await originalStorageSet('stock-list', JSON.stringify(stockList));
    await originalStorageSet('invoice-records', JSON.stringify(records));
    if (oldMetal) {
      await addOldGold({ sourceId: record.number + ':return-metal:' + returnEntry.noteNumber, metal: oldMetal.metal, source: 'Invoice return - old metal given back', invoice: record.number, customer: record.customer, date: new Date(savedAt).toLocaleDateString('en-GB'), weight: -oldMetal.weight, rate: oldMetal.rate, value: -oldMetal.value, receivedAt: savedAt });
    }
    closeReturnModal();
    await renderRecords();
  });
  document.getElementById('printRegeneratedInvoice').addEventListener('click', () => {
    const paper = document.querySelector('#regeneratedInvoiceContent #invoicePaper');
    const printWindow = window.open('', '_blank');
    if (!printWindow) { alert('Please allow pop-ups to print the invoice.'); return; }
    printWindow.document.write('<!doctype html><html><head><title>Invoice ' + safe(regeneratedModal.dataset.invoiceNumber) + '</title>' + document.querySelector('style').outerHTML + '<style>body{background:#fff;padding:24px}#invoicePaper{max-width:800px;margin:auto}</style></head><body>' + paper.outerHTML + '</body></html>');
    printWindow.document.close();
  });
  document.getElementById('downloadRegeneratedInvoice').addEventListener('click', async () => {
    const paper = document.querySelector('#regeneratedInvoiceContent #invoicePaper');
    try {
      const canvas = await html2canvas(paper, { scale: 2, backgroundColor: '#FAF5E7' });
      const pdf = new window.jspdf.jsPDF('p', 'pt', 'a4');
      const width = pdf.internal.pageSize.getWidth() - 40;
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 20, 20, width, canvas.height * (width / canvas.width));
      pdf.save('Invoice-' + regeneratedModal.dataset.invoiceNumber + '.pdf');
    } catch (error) { alert('Could not generate the PDF.'); }
  });
  const deleteRecordDialog = document.createElement('dialog');
  deleteRecordDialog.style.cssText = 'width:min(460px,90vw);border:1px solid #9a554a;border-radius:14px;padding:26px;background:#211b13;color:#eee1c6;';
  deleteRecordDialog.innerHTML = '<h3 style="margin-top:0">Delete invoice?</h3><p id="deleteRecordNote" style="line-height:1.6"></p><div class="btn-row"><button class="btn btn-danger" id="confirmRecordDeletion">Delete invoice</button><button class="btn btn-ghost" id="cancelRecordDeletion">Cancel</button></div>';
  document.body.appendChild(deleteRecordDialog);
  let deletionNumber = null;
  document.getElementById('cancelRecordDeletion').onclick = () => deleteRecordDialog.close();
  document.getElementById('confirmRecordDeletion').onclick = async () => {
    const button = document.getElementById('confirmRecordDeletion');
    button.disabled = true;
    document.getElementById('cancelRecordDeletion').disabled = true;
    try {
      const response = await fetch('/api/invoices/' + encodeURIComponent(deletionNumber), { method: 'DELETE' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not delete invoice.');
      const latestStock = await window.storage.get('stock-list');
      stockList = latestStock ? JSON.parse(latestStock.value) : [];
      renderStockTable(); renderStockStats(); renderRowsTable();
      await renderRecords();
      deleteRecordDialog.close();
      showAppMessage('Invoice ' + deletionNumber + ' deleted and its calculations reversed. This deletion cannot be undone from the app.', 'success');
    } catch (error) {
      deleteRecordDialog.close();
      showAppMessage(error.message, 'error');
    } finally {
      button.disabled = false;
      document.getElementById('cancelRecordDeletion').disabled = false;
    }
  };
  const renderRecords = async () => {
    const query = (document.getElementById('recordSearch').value || '').trim().toLowerCase();
    const records = await getRecords();
    const dueOnly = document.getElementById('recordDueOnly').checked;
    const filtered = records.map((record, index) => ({ record, index })).filter(({ record }) =>
      (record.customer + ' ' + record.mobile).toLowerCase().includes(query) &&
      (!dueOnly || (record.status !== 'voided' && Number(record.due) > 0))
    );
    document.getElementById('recordCountLabel').textContent = filtered.length + ' of ' + records.length + ' shown';
    document.getElementById('recordsTbody').innerHTML = filtered.map(entry => {
      const record = entry.record;
      const index = entry.index;
      const due = Number(record.due) || 0;
      const paid = Number(record.paid) || 0;
      const netTotal = recordNetTotal(record);
      const voided = record.status === 'voided';
      const pending = record.status === 'pending';
      const exchanges = Array.isArray(record.exchanges) ? record.exchanges : record.exchange ? [record.exchange] : [];
      const exchangeHistory = exchanges.map(exchange => {
        const metal = String(exchange.metal || 'gold').replace(/^./, character => character.toUpperCase());
        return safe(metal + ' · ' + (Number(exchange.weight) || 0).toFixed(3) + ' g × ' + money(exchange.rate) + '/g = ' + money(exchange.value));
      }).join('<br>') || 'No old metal exchanged';
      const settlementHistory = (record.payments || []).map(payment => {
        const method = payment.method === 'gold' ? 'Gold' : payment.method === 'silver' ? 'Silver' : 'Amount';
        const itemDetail = payment.weight ? ' · ' + payment.weight + 'g × ₹' + payment.rate + '/g' : '';
        return safe(method + itemDetail + ' — ' + money(payment.amount));
      }).join('<br>') || 'No settlement recorded';
      return '<tr class="' + (voided ? 'voided-record' : '') + '"><td style="font-family:var(--font-mono);">' + safe(record.number) + (voided ? '<span class="voided-badge">VOIDED</span>' : pending ? '<span class="pending-badge">PENDING</span>' : '') + '</td><td>' + safe(record.date) + '</td><td>' + safe(record.customer || 'Walk-in customer') + '</td><td>' + safe(record.mobile || '—') + '</td><td style="font-family:var(--font-mono); color:var(--gold-pale);">' + money(netTotal) + '</td><td class="due-amount">' + money(due) + '</td><td><button class="btn btn-ghost btn-sm record-toggle" data-index="' + index + '">Details</button></td></tr>' +
        '<tr class="record-detail" data-detail="' + index + '" style="display:none;"><td colspan="7"><div class="record-detail-card"><div class="record-info-grid"><div class="record-info"><b>Customer address</b>' + safe(record.address || '—') + '</div><div class="record-info"><b>' + (pending ? 'Ordered items' : 'Items') + '</b>' + safe(record.items || '—') + '</div><div class="record-info"><b>Old metal exchange</b>' + exchangeHistory + '</div><div class="record-info"><b>Net invoice total</b><span class="paid-amount">' + money(netTotal) + '</span></div><div class="record-info"><b>Paid</b><span class="paid-amount">' + money(paid) + '</span></div><div class="record-info"><b>Due amount</b><span class="due-amount">' + money(due) + '</span></div>' + (voided ? '<div class="record-info"><b>Void reason</b>' + safe(record.voidReason || '—') + '</div>' : pending ? '<div class="record-info"><b>Order status</b>Awaiting stock selection and delivery</div>' : '') + '<div class="record-info"><b>Payment / settlement history</b>' + settlementHistory + '</div></div>' + (voided ? '<div class="voided-invoice-view"><button class="btn btn-ghost btn-sm record-reprint" data-index="' + index + '">View Voided Invoice</button></div>' : '') + '<div class="record-actions"><div class="field"><label>Settlement type</label><select class="record-method" data-index="' + index + '" ' + (due <= 0 || voided ? 'disabled' : '') + '><option value="amount">Amount / Cash</option><option value="gold">Gold item</option><option value="silver">Silver item</option></select></div><div class="field" data-amount-field="' + index + '"><label>Settle amount (₹)</label><input type="number" min="0.01" step="0.01" id="settlement-' + index + '" placeholder="Enter received amount" ' + (due <= 0 || voided ? 'disabled' : '') + '></div><div class="field" data-item-field="' + index + '" style="display:none;"><label>Weight (g)</label><input type="number" min="0.001" step="0.001" id="settlement-weight-' + index + '" placeholder="0.000" ' + (due <= 0 || voided ? 'disabled' : '') + '></div><div class="field" data-item-field="' + index + '" style="display:none;"><label>Price per gram (₹)</label><input type="number" min="0.01" step="0.01" id="settlement-rate-' + index + '" placeholder="0.00" ' + (due <= 0 || voided ? 'disabled' : '') + '></div><div class="field" data-item-field="' + index + '" style="display:none;"><label>Calculated settlement (₹)</label><div class="payment-balance" id="settlement-value-' + index + '">₹0.00</div></div><button class="btn btn-gold btn-sm record-settle" data-index="' + index + '" ' + (due <= 0 || voided ? 'disabled' : '') + '>Settle Amount</button><button class="btn btn-ghost btn-sm record-paid" data-index="' + index + '" ' + (due <= 0 || voided ? 'disabled' : '') + '>Mark Fully Paid</button><button class="btn btn-ghost btn-sm record-edit" data-index="' + index + '" ' + (voided ? 'disabled' : '') + '>' + (pending ? 'Deliver Order' : 'Edit Invoice') + '</button><button class="btn btn-ghost btn-sm record-void" data-index="' + index + '" ' + (voided ? 'disabled' : '') + '>' + (pending ? 'Cancel Order' : 'Void Invoice') + '</button><button class="btn btn-ghost btn-sm record-reprint" data-index="' + index + '">' + (pending ? 'View Pending Invoice' : 'Regenerate Invoice') + '</button></div></div></td></tr>';
    }).join('');
    filtered.forEach(({ record, index }) => {
      const card = document.querySelector('[data-detail="' + index + '"] .record-detail-card');
      const button = document.createElement('button');
      button.className = 'btn btn-danger btn-sm';
      button.style.cssText = 'margin-top:14px;color:#E8A99E;border-color:#9a554a;background:rgba(164,44,35,.16)';
      button.textContent = 'Delete Record';
      button.onclick = () => {
        deletionNumber = record.number;
        document.getElementById('deleteRecordNote').textContent = 'Permanently delete ' + record.number + '? Its sales, payments and dues will be removed, remaining sold weight restored, and linked old-metal entries removed. Already-voided invoices will not restore stock twice. This cannot be undone from the app.';
        deleteRecordDialog.showModal();
      };
      card.appendChild(button);
    });
    const emptyState = document.getElementById('recordsEmpty');
    emptyState.style.display = filtered.length ? 'none' : 'block';
    emptyState.textContent = !records.length ? 'No completed invoices yet.' : dueOnly ? 'No due records match your filters.' : 'No records match your search.';
  };
  const openRecords = async () => {
    document.querySelectorAll('.tab-btn').forEach(button => button.classList.remove('active'));
    document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
    document.getElementById('recordsTab').classList.add('active');
    document.getElementById('page-records').classList.add('active');
    await renderRecords();
  };
  const openDashboard = async () => {
    document.querySelectorAll('.tab-btn').forEach(button => button.classList.remove('active'));
    document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
    document.getElementById('dashboardTab').classList.add('active');
    document.getElementById('page-dashboard').classList.add('active');
    await renderDashboard();
  };
  const openPurchases = async () => {
    document.querySelectorAll('.tab-btn').forEach(button => button.classList.remove('active'));
    document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
    document.getElementById('purchasesTab').classList.add('active');
    document.getElementById('page-purchases').classList.add('active');
    await renderPurchases();
  };
  const openPayments = async () => {
    document.querySelectorAll('.tab-btn').forEach(button => button.classList.remove('active'));
    document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
    document.getElementById('paymentsTab').classList.add('active');
    document.getElementById('page-payments').classList.add('active');
    await renderPayments();
  };
  const openSettings = async () => {
    document.querySelectorAll('.tab-btn').forEach(button => button.classList.remove('active'));
    document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
    document.getElementById('settingsTab').classList.add('active');
    document.getElementById('page-settings').classList.add('active');
    const status = document.getElementById('settingsDataStatus');
    try {
      const response = await fetch('/api/data-location', { cache: 'no-store' });
      const location = await response.json();
      document.getElementById('settingsDataPath').textContent = location.path;
      document.getElementById('settingsChooseData').disabled = !location.desktop;
      status.textContent = location.desktop ? '' : 'Changing the data folder is available in the desktop app.';
    } catch (_) { status.textContent = 'Could not load the current data location.'; }
  };
  const updatePurchaseAmount = () => {
    const amount = Math.max(Number(document.getElementById('purchaseWeight').value) || 0, 0) * Math.max(Number(document.getElementById('purchaseRate').value) || 0, 0);
    document.getElementById('purchaseAmount').textContent = money(amount);
  };
  document.getElementById('refreshLiveRates').addEventListener('click', () => renderDashboard(true));
  const invoiceTab = document.querySelector('.tab-btn[data-page="home"]');
  invoiceTab.textContent = 'Invoice';
  const dashboardTab = document.createElement('button');
  dashboardTab.className = 'tab-btn';
  dashboardTab.id = 'dashboardTab';
  dashboardTab.textContent = 'Dashboard';
  invoiceTab.parentElement.insertBefore(dashboardTab, invoiceTab);
  dashboardTab.addEventListener('click', openDashboard);
  openDashboard();
  const stocksTab = document.querySelector('.tab-btn[data-page="stocks"]');
  const paymentsTab = document.createElement('button');
  paymentsTab.className = 'tab-btn';
  paymentsTab.id = 'paymentsTab';
  paymentsTab.textContent = 'Payment';
  invoiceTab.parentElement.insertBefore(paymentsTab, stocksTab);
  paymentsTab.addEventListener('click', openPayments);
  const purchasesTab = document.createElement('button');
  purchasesTab.className = 'tab-btn';
  purchasesTab.id = 'purchasesTab';
  purchasesTab.textContent = 'Purchase';
  invoiceTab.parentElement.insertBefore(purchasesTab, stocksTab);
  purchasesTab.addEventListener('click', openPurchases);
  const itemsTab = document.querySelector('.tab-btn[data-page="items"]');
  if (itemsTab) itemsTab.remove();
  const recordsTab = document.createElement('button');
  recordsTab.className = 'tab-btn';
  recordsTab.id = 'recordsTab';
  recordsTab.textContent = 'Records';
  document.querySelector('nav.tabs').appendChild(recordsTab);
  recordsTab.addEventListener('click', openRecords);
  const settingsTab = document.createElement('button');
  settingsTab.className = 'tab-btn';
  settingsTab.id = 'settingsTab';
  settingsTab.textContent = 'Settings';
  document.querySelector('nav.tabs').appendChild(settingsTab);
  settingsTab.addEventListener('click', openSettings);
  document.getElementById('settingsChooseData').addEventListener('click', async () => {
    const status = document.getElementById('settingsDataStatus');
    try {
      const response = await fetch('/api/data-location', { method: 'POST' });
      if (!response.ok) throw new Error();
      status.textContent = 'Choose a folder in the system dialog. The app will restart after confirmation.';
    } catch (_) { status.textContent = 'This option is available only in the desktop app.'; }
  });
  document.getElementById('recordSearch').addEventListener('input', renderRecords);
  document.getElementById('recordDueOnly').addEventListener('change', renderRecords);
  const updatePaymentType = () => {
    const paymentType = document.getElementById('paymentType').value;
    const isMetal = paymentType === 'metal';
    document.getElementById('paymentAmountField').style.display = isMetal ? 'none' : 'block';
    document.getElementById('paymentMetalFields').style.display = isMetal ? 'block' : 'none';
    document.querySelector('#paymentAmountField label').textContent = paymentType === 'self-expense' ? 'Self expense amount (₹)' : 'Amount paid (₹)';
  };
  const updateFineWeight = () => {
    const weight = Math.max(Number(document.getElementById('paymentWeight').value) || 0, 0);
    const purity = Math.min(Math.max(Number(document.getElementById('paymentPurity').value) || 0, 0), 100);
    document.getElementById('paymentFineWeight').textContent = (weight * purity / 100).toFixed(3) + ' g';
  };
  document.getElementById('paymentType').addEventListener('change', updatePaymentType);
  ['paymentWeight', 'paymentPurity'].forEach(id => document.getElementById(id).addEventListener('input', updateFineWeight));
  document.getElementById('paymentForm').addEventListener('submit', async event => {
    event.preventDefault();
    const type = document.getElementById('paymentType').value;
    const payments = await getPayments();
    const savedAt = new Date().toISOString();
    const reason = document.getElementById('paymentReason').value.trim();
    if (type === 'amount' || type === 'self-expense') {
      const amountPaid = Number(document.getElementById('paymentAmountInput').value);
      if (!(amountPaid > 0)) return;
      payments.unshift({ id: Date.now().toString(), type, amount: amountPaid, reason, savedAt });
      await originalStorageSet('payment-records', JSON.stringify(payments));
      document.getElementById('paymentAmountInput').value = '';
    } else {
      const metal = document.getElementById('paymentMetal').value;
      const weight = Number(document.getElementById('paymentWeight').value);
      const purity = Number(document.getElementById('paymentPurity').value);
      if (!(weight > 0) || !(purity >= 0 && purity <= 100)) return;
      const oldMetalEntries = await getOldGold();
      const balance = oldMetalEntries.filter(entry => entry.metal === metal).reduce((total, entry) => total + (Number(entry.weight) || 0), 0);
      if (weight > balance) { alert('Only ' + balance.toFixed(3) + ' g of old ' + metal + ' is available for payment.'); return; }
      const fineWeight = weight * purity / 100;
      const payment = { id: Date.now().toString(), type: 'metal', metal, weight, purity, fineWeight, reason, savedAt };
      payments.unshift(payment);
      await originalStorageSet('payment-records', JSON.stringify(payments));
      await addOldGold({ sourceId: 'payment:' + payment.id, metal, source: 'Metal payment', invoice: '—', customer: '—', date: new Date(savedAt).toLocaleDateString('en-GB'), weight: -weight, rate: 0, value: 0, receivedAt: savedAt });
      document.getElementById('paymentWeight').value = '';
      document.getElementById('paymentPurity').value = '';
      updateFineWeight();
    }
    document.getElementById('paymentReason').value = '';
    await renderPayments();
  });
  updatePaymentType();
  updateFineWeight();
  ['purchaseWeight', 'purchaseRate'].forEach(id => document.getElementById(id).addEventListener('input', updatePurchaseAmount));
  document.getElementById('purchaseForm').addEventListener('submit', async event => {
    event.preventDefault();
    const metal = document.getElementById('purchaseMetal').value;
    const weight = Number(document.getElementById('purchaseWeight').value);
    const rate = Number(document.getElementById('purchaseRate').value);
    if (!(weight > 0) || !(rate > 0)) return;
    const purchases = await getPurchases();
    const purchase = { id: Date.now().toString(), metal, weight, rate, amount: weight * rate, savedAt: new Date().toISOString() };
    purchases.unshift(purchase);
    await originalStorageSet('purchase-records', JSON.stringify(purchases));
    await addOldGold({ sourceId: 'purchase:' + purchase.id, metal, source: 'Old metal purchase', invoice: '—', customer: '—', date: new Date(purchase.savedAt).toLocaleDateString('en-GB'), weight, rate, value: purchase.amount, receivedAt: purchase.savedAt });
    document.getElementById('purchaseWeight').value = '';
    document.getElementById('purchaseRate').value = '';
    updatePurchaseAmount();
    await renderPurchases();
  });
  document.getElementById('paymentTbody').addEventListener('click', async event => {
    const button = event.target.closest('button[data-id]');
    if (!button) return;
    const payment = (await getPayments()).find(entry => entry.id === button.dataset.id);
    if (!payment) return;
    if (button.classList.contains('payment-edit')) openTransactionEditor('payment', payment);
    if (button.classList.contains('payment-delete')) openTransactionDelete('payment', payment);
  });
  document.getElementById('purchaseTbody').addEventListener('click', async event => {
    const button = event.target.closest('button[data-id]');
    if (!button) return;
    const purchase = (await getPurchases()).find(entry => entry.id === button.dataset.id);
    if (!purchase) return;
    if (button.classList.contains('purchase-edit')) openTransactionEditor('purchase', purchase);
    if (button.classList.contains('purchase-delete')) openTransactionDelete('purchase', purchase);
  });
  document.getElementById('recordsTbody').addEventListener('change', event => {
    if (!event.target.classList.contains('record-method')) return;
    const index = event.target.dataset.index;
    const isItem = event.target.value === 'gold' || event.target.value === 'silver';
    document.querySelector('[data-amount-field="' + index + '"]').style.display = isItem ? 'none' : 'block';
    document.querySelectorAll('[data-item-field="' + index + '"]').forEach(field => { field.style.display = isItem ? 'block' : 'none'; });
    const button = document.querySelector('.record-settle[data-index="' + index + '"]');
    button.textContent = isItem ? 'Settle ' + (event.target.value === 'gold' ? 'Gold' : 'Silver') : 'Settle Amount';
  });
  document.getElementById('recordsTbody').addEventListener('input', event => {
    const id = event.target.id || '';
    if (!id.startsWith('settlement-weight-') && !id.startsWith('settlement-rate-')) return;
    const index = id.replace('settlement-weight-', '').replace('settlement-rate-', '');
    const weight = Number(document.getElementById('settlement-weight-' + index).value) || 0;
    const rate = Number(document.getElementById('settlement-rate-' + index).value) || 0;
    document.getElementById('settlement-value-' + index).textContent = money(weight * rate);
  });
  document.getElementById('recordsTbody').addEventListener('click', async event => {
    const button = event.target.closest('button[data-index]');
    if (!button) return;
    const index = Number(button.dataset.index);
    if (button.classList.contains('record-toggle')) {
      const detail = document.querySelector('[data-detail="' + index + '"]');
      const opening = detail.style.display === 'none';
      detail.style.display = opening ? 'table-row' : 'none';
      button.textContent = opening ? 'Hide' : 'Details';
      return;
    }
    const records = await getRecords();
    const record = records[index];
    if (!record) return;
    if (button.classList.contains('record-reprint')) {
      reprintInvoice(record);
      return;
    }
    if (button.classList.contains('record-edit')) {
      openEditInvoiceModal(record, index);
      return;
    }
    if (button.classList.contains('record-void')) {
      openVoidModal(record, index);
      return;
    }
    const due = Number(record.due) || 0;
    const settlementInput = document.getElementById('settlement-' + index);
    const method = document.querySelector('.record-method[data-index="' + index + '"]').value;
    const weight = Number(document.getElementById('settlement-weight-' + index).value);
    const rate = Number(document.getElementById('settlement-rate-' + index).value);
    const settled = button.classList.contains('record-paid') ? due : method === 'amount' ? Number(settlementInput.value) : weight * rate;
    if (!Number.isFinite(settled) || settled <= 0 || settled > due) {
      alert(method === 'amount' ? 'Enter a valid amount up to the outstanding due of ' + money(due) + '.' : 'Enter a valid weight and price per gram whose value does not exceed the due of ' + money(due) + '.');
      return;
    }
    if (button.classList.contains('record-paid') && !(await confirmFullyPaid(record, due))) return;
    record.paid = (Number(record.paid) || 0) + settled;
    record.due = Math.max(due - settled, 0);
    record.payments = Array.isArray(record.payments) ? record.payments : [];
    const settledAt = new Date().toISOString();
    record.payments.unshift({ method: button.classList.contains('record-paid') ? 'amount' : method, amount: settled, weight: method === 'amount' ? null : weight, rate: method === 'amount' ? null : rate, settledAt });
    await window.storage.set('invoice-records', JSON.stringify(records));
    if ((method === 'gold' || method === 'silver') && !button.classList.contains('record-paid')) {
      await addOldGold({ sourceId: record.number + ':settlement:' + settledAt, metal: method, source: (method === 'gold' ? 'Gold' : 'Silver') + ' settlement', invoice: record.number, customer: record.customer, date: new Date(settledAt).toLocaleDateString('en-GB'), weight, rate, value: settled, receivedAt: settledAt });
    }
    await renderRecords();
    showAppMessage('Settlement of ' + money(settled) + ' saved for invoice ' + record.number + '. Remaining due: ' + money(record.due) + '.', 'success');
  });

  let pendingRecord = null;
  const originalStorageSet = window.storage.set.bind(window.storage);
  const savePendingRecord = async () => {
    if (!pendingRecord) return;
    const record = pendingRecord;
    pendingRecord = null;
    const records = await getRecords();
    const existing = records.findIndex(saved => saved.number === record.number);
    if (existing >= 0) {
      record.paid = Number(records[existing].paid) || 0;
      record.due = Number(records[existing].due) || 0;
      record.payments = records[existing].payments || [];
      records[existing] = record;
    } else records.unshift(record);
    await originalStorageSet('invoice-records', JSON.stringify(records));
    const exchanges = Array.isArray(record.exchanges) ? record.exchanges : record.exchange ? [record.exchange] : [];
    for (const exchange of exchanges) {
      if (!exchange || !['gold', 'silver'].includes(exchange.metal) || !(Number(exchange.weight) > 0)) continue;
      await addOldGold({ sourceId: record.number + ':exchange:' + exchange.metal, metal: exchange.metal, source: 'Invoice exchange', invoice: record.number, customer: record.customer, date: record.date, weight: Number(exchange.weight), rate: Number(exchange.rate), value: Number(exchange.value), receivedAt: record.savedAt });
    }
    showInvoiceSuccess(record);
    if (document.getElementById('page-records').classList.contains('active')) renderRecords();
  };
  window.storage.set = async (key, value) => {
    const result = await originalStorageSet(key, value);
    if (key === 'stock-list') {
      const completedInvoice = Boolean(pendingRecord);
      await savePendingRecord();
      // This runs after the stock and invoice record have both been saved. The
      // existing New Invoice handler increments and persists the counter.
      if (completedInvoice) setTimeout(() => document.getElementById('btnNewInvoice').click(), 0);
    }
    return result;
  };

  const collectInvoiceRecord = status => {
    const paid = amount(document.getElementById('amount-paid').value);
    return {
      number: document.getElementById('inv-no').value || '—',
      date: document.getElementById('p-date').textContent || '—',
      invoiceDate: document.getElementById('inv-date').value || '',
      status,
      customer: document.getElementById('cust-name').value || 'Walk-in customer',
      mobile: document.getElementById('cust-mobile').value || '',
      address: document.getElementById('cust-address').value || '',
      business: document.getElementById('biz-name').value || 'Vishesh Jewellers',
      gstin: document.getElementById('biz-gstin').value || '',
      terms: document.getElementById('inv-terms').value || '',
      items: Array.from(document.querySelectorAll('#p-items-body tr')).map(row => row.cells[1] ? row.cells[1].textContent.trim() : '').filter(Boolean).join(', '),
      subtotal: document.getElementById('mini-sub').textContent || '₹0.00',
      discount: document.getElementById('mini-disc').textContent || '₹0.00',
      tax: document.getElementById('mini-gst').textContent || '₹0.00',
      total: document.getElementById('mini-grand').textContent || '₹0.00',
      soldItems: rows.filter(row => row.stockId).map(row => ({ lineId: row.id, stockId: row.stockId, name: row.name, hsn: row.hsn || '', purity: row.purity, gross: Number(row.gross) || 0, net: Number(row.net) || 0, pcs: Number(row.pcs) || 1, rate: Number(row.rate) || 0, making: Number(row.making) || 0 })),
      exchanges: getExchangeEntries().filter(exchange => exchange.weight > 0),
      manualDiscount: Math.max(Number(document.getElementById('invoice-discount').value) || 0, 0),
      gstRate: Number(document.getElementById('gst-rate').value) * 2 || 0,
      initialPaid: paid,
      paid,
      due: Math.max(amount(document.getElementById('mini-grand').textContent) - paid, 0),
      payments: paid > 0 ? [{ method: 'amount', amount: paid, initialPayment: true, settledAt: new Date().toISOString() }] : [],
      invoiceMarkup: document.getElementById('invoicePaper').outerHTML,
      savedAt: new Date().toISOString()
    };
  };
  document.getElementById('btnSavePendingOrder').addEventListener('click', async () => {
    const customer = document.getElementById('cust-name').value.trim();
    const orderItems = rows.filter(row => row.name && ((Number(row.gross) > 0) || (Number(row.net) > 0)) && Number(row.rate) > 0);
    if (!customer) { toast('Customer name is required for a pending order.'); document.getElementById('cust-name').focus(); return; }
    if (!orderItems.length) { toast('Enter at least one ordered item with its name, weight, and rate.'); return; }
    const record = collectInvoiceRecord('pending');
    record.orderItems = orderItems.map((row, index) => ({ lineId: row.id || ('order-' + index), stockId: '', name: row.name, hsn: row.hsn || '', purity: row.purity || '', gross: Number(row.gross) || 0, net: Number(row.net) || 0, rate: Number(row.rate) || 0, making: Number(row.making) || 0 }));
    record.soldItems = [];
    const records = await getRecords();
    records.unshift(record);
    await originalStorageSet('invoice-records', JSON.stringify(records));
    const oldMetal = await getOldGold();
    record.exchanges.forEach((exchange, index) => {
      if (Number(exchange.weight) > 0) oldMetal.unshift({ sourceId: record.number + ':exchange:' + exchange.metal + ':' + index, metal: exchange.metal, source: 'Invoice exchange', invoice: record.number, customer: record.customer, date: record.date, weight: Number(exchange.weight), rate: Number(exchange.rate), value: Number(exchange.value), receivedAt: record.savedAt });
    });
    await originalStorageSet('old-gold-records', JSON.stringify(oldMetal));
    if (document.getElementById('page-records').classList.contains('active')) await renderRecords();
    showInvoiceSuccess(record);
    document.getElementById('btnNewInvoice').click();
  });
  document.getElementById('btnCompleteSale').addEventListener('click', event => {
    pendingRecord = collectInvoiceRecord('completed');
    setTimeout(async () => {
      if (pendingRecord && document.getElementById('saleStatus').textContent.startsWith('✔ Stock updated')) await savePendingRecord();
      else if (pendingRecord) pendingRecord = null;
    }, 500);
  }, true);
})();
</script>\n`;
  return html
    .replace('</head>', pwaHead + '</head>')
    .replace('</main>', dashboardPage + settingsPage + paymentsPage + purchasesPage + recordsPage + '</main>')
    .replace('<script>', adapter + '<script>')
    .replace('</body>', recordsScript + '</body>');
}

jsonStore.migrate();
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const match = url.pathname.match(/^\/api\/storage\/([^/]+)$/);
  const invoiceDeletion = url.pathname.match(/^\/api\/invoices\/([^/]+)$/);
  if (invoiceDeletion && req.method === 'DELETE') {
    try {
      const next = deleteInvoice(jsonStore.read(), decodeURIComponent(invoiceDeletion[1]));
      jsonStore.write(next);
      return send(res, 200, JSON.stringify({ ok: true }));
    } catch (error) {
      return send(res, 400, JSON.stringify({ error: error.message }));
    }
  }

  if (url.pathname === '/api/version' && req.method === 'GET') {
    return send(res, 200, JSON.stringify({ version: serverVersion }));
  }

  if (url.pathname === '/api/data-location' && req.method === 'GET') {
    return send(res, 200, JSON.stringify({ path: dataDir, desktop: Boolean(process.send) }));
  }

  if (url.pathname === '/api/data-location' && req.method === 'POST') {
    if (!process.send) return send(res, 400, JSON.stringify({ error: 'Desktop app required' }));
    process.send({ type: 'choose-data-location' });
    return send(res, 202, JSON.stringify({ ok: true }));
  }

  if (url.pathname === '/api/live-rates' && req.method === 'GET') {
    return getLiveMetalRates(url.searchParams.get('refresh') === '1')
      .then(rates => send(res, 200, JSON.stringify(rates)))
      .catch(() => send(res, 503, JSON.stringify({ error: 'Live rates unavailable' })));
  }

  if (url.pathname === '/assets/vishesh-jewellers-logo.png' && req.method === 'GET') {
    return send(res, 200, fs.readFileSync(path.join(root, 'assets', 'vishesh-jewellers-logo.png')), 'image/png');
  }

  if (url.pathname === '/manifest.webmanifest' && req.method === 'GET') {
    return send(res, 200, fs.readFileSync(path.join(root, 'public', 'manifest.webmanifest')), 'application/manifest+json; charset=utf-8');
  }

  if (url.pathname === '/service-worker.js' && req.method === 'GET') {
    return send(res, 200, fs.readFileSync(path.join(root, 'public', 'service-worker.js')), 'application/javascript; charset=utf-8');
  }

  if (match && req.method === 'GET') {
    const key = decodeURIComponent(match[1]);
    const value = jsonStore.read()[key];
    return value === undefined ? send(res, 404, JSON.stringify({ error: 'Not found' })) : send(res, 200, JSON.stringify({ value: JSON.stringify(value) }));
  }

  if (match && req.method === 'PUT') {
    const key = decodeURIComponent(match[1]);
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 1_000_000) req.destroy(); });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        if (typeof payload.value !== 'string') throw new Error('Value must be a string');
        const store = jsonStore.read();
        store[key] = JSON.parse(payload.value);
        jsonStore.write(store);
        send(res, 200, JSON.stringify({ ok: true }));
      } catch (error) {
        send(res, 400, JSON.stringify({ error: error.message }));
      }
    });
    return;
  }

  if ((url.pathname === '/' || url.pathname === '/index.html') && req.method === 'GET') {
    try {
      return send(res, 200, injectJsonStorage(applyStockFlow(fs.readFileSync(sourceHtml, 'utf8'))), 'text/html; charset=utf-8');
    } catch {
      return send(res, 500, 'Source HTML was not found. Set SOURCE_HTML to the path of index.html.', 'text/plain; charset=utf-8');
    }
  }

  send(res, 404, JSON.stringify({ error: 'Not found' }));
});

server.listen(port, host, () => {
  const address = server.address();
  const activePort = typeof address === 'object' && address ? address.port : port;
  const url = `http://${host}:${activePort}`;
  console.log(`Vishesh Jewellers app: ${url}`);
  if (process.send) process.send({ type: 'server-ready', url });
});
