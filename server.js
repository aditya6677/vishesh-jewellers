const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createJsonStore } = require('./lib/json-store');
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
    "  toast('Stock weight updated — sale recorded');",
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
    .replace('class="f-name" value="${escapeHtml(r.name)}" placeholder="Item name">', 'class="f-name" value="${escapeHtml(r.name)}" placeholder="Select from stock" readonly>')
    .replace('class="f-hsn" value="${escapeHtml(r.hsn)}" style="width:56px;">', 'class="f-hsn" value="${escapeHtml(r.hsn)}" style="width:56px;" readonly>')
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
          <div class="record-info"><b>Amount Payments</b><span class="due-amount" id="dash-amount-payments">₹0.00</span></div>
          <div class="record-info"><b>Final Net Collection</b><span class="paid-amount" id="dash-final-net-collected">₹0.00</span></div>
        </div></div>
        <div class="snapshot-section"><h4>Today</h4><div class="record-info-grid">
          <div class="record-info"><b>Invoices</b><span id="dash-today-invoices">0</span></div>
          <div class="record-info"><b>Collection</b><span class="paid-amount" id="dash-today-collected">₹0.00</span></div>
          <div class="record-info"><b>Old Metal Purchases</b><span class="due-amount" id="dash-today-purchases">₹0.00</span></div>
          <div class="record-info"><b>Net after Purchases</b><span class="paid-amount" id="dash-today-net-collected">₹0.00</span></div>
          <div class="record-info"><b>Amount Payments</b><span class="due-amount" id="dash-today-amount-payments">₹0.00</span></div>
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
      <p class="sub">Record cash payments or metal-to-metal payments from your old Gold and Silver balance.</p>
    </div>
    <div class="stat-cards">
      <div class="stat-card"><div class="lbl">Cash Payments</div><div class="val" id="paymentCashTotal">₹0.00</div></div>
      <div class="stat-card"><div class="lbl">Gold Used</div><div class="val" id="paymentGoldWeight">0.000 g</div></div>
      <div class="stat-card"><div class="lbl">Silver Used</div><div class="val" id="paymentSilverWeight">0.000 g</div></div>
    </div>
    <div class="panel">
      <h3><span class="dot"></span>Add Payment</h3>
      <form id="paymentForm">
        <div class="row row-2">
          <div class="field"><label>Payment type</label><select id="paymentType"><option value="amount">Amount</option><option value="metal">Metal to Metal</option></select></div>
          <div class="field" id="paymentAmountField"><label>Amount paid (₹)</label><input type="number" id="paymentAmountInput" min="0.01" step="0.01" placeholder="0.00"></div>
        </div>
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
      <div class="data-table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Type</th><th>Metal</th><th>Gross Wt</th><th>Purity</th><th>Fine Wt</th><th>Amount</th></tr></thead><tbody id="paymentTbody"></tbody></table></div>
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
      <div class="data-table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Metal</th><th>Weight</th><th>Rate / g</th><th>Amount</th></tr></thead><tbody id="purchaseTbody"></tbody></table></div>
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
    const formatExchangeMoney = amount => '₹' + amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    exchangeRows.querySelectorAll('.exchange-row').forEach((row, index) => { row.querySelector('.exchange-row-value').textContent = formatExchangeMoney(entries[index].value); });
    document.getElementById('exchange-value').textContent = formatExchangeMoney(value);
    hiddenExchangeInput.value = value.toFixed(2);
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
  paymentRow.className = 'row row-2';
  paymentRow.id = 'invoicePaymentRow';
  paymentRow.style.marginTop = '16px';
  paymentRow.innerHTML = '<div class="field"><label>Amount Paid (₹)</label><input type="number" id="amount-paid" value="0" min="0" step="0.01" placeholder="0.00"></div><div class="field"><label id="amount-balance-label">Amount Due (₹)</label><div id="amount-balance" class="payment-balance">₹0.00</div></div>';
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
    document.getElementById('purchaseTbody').innerHTML = purchases.map(purchase => '<tr><td>' + safe(new Date(purchase.savedAt).toLocaleDateString('en-GB')) + '</td><td>' + safe(String(purchase.metal || 'gold').replace(/^./, char => char.toUpperCase())) + '</td><td style="font-family:var(--font-mono); color:var(--gold-pale);">' + (Number(purchase.weight) || 0).toFixed(3) + ' g</td><td>' + money(purchase.rate) + '</td><td class="paid-amount">' + money(purchase.amount) + '</td></tr>').join('');
    document.getElementById('purchasesEmpty').style.display = purchases.length ? 'none' : 'block';
  };
  const getPayments = async () => {
    const result = await window.storage.get('payment-records');
    return result ? JSON.parse(result.value) : [];
  };
  const renderPayments = async () => {
    const payments = await getPayments();
    const metalWeight = metal => payments.filter(payment => payment.type === 'metal' && payment.metal === metal).reduce((total, payment) => total + (Number(payment.weight) || 0), 0);
    document.getElementById('paymentCashTotal').textContent = money(payments.filter(payment => payment.type === 'amount').reduce((total, payment) => total + (Number(payment.amount) || 0), 0));
    document.getElementById('paymentGoldWeight').textContent = metalWeight('gold').toFixed(3) + ' g';
    document.getElementById('paymentSilverWeight').textContent = metalWeight('silver').toFixed(3) + ' g';
    document.getElementById('paymentCount').textContent = payments.length + (payments.length === 1 ? ' payment' : ' payments');
    document.getElementById('paymentTbody').innerHTML = payments.map(payment => '<tr><td>' + safe(new Date(payment.savedAt).toLocaleDateString('en-GB')) + '</td><td>' + safe(payment.type === 'metal' ? 'Metal to Metal' : 'Amount') + '</td><td>' + safe(payment.metal ? payment.metal.replace(/^./, char => char.toUpperCase()) : '—') + '</td><td>' + (payment.type === 'metal' ? (Number(payment.weight) || 0).toFixed(3) + ' g' : '—') + '</td><td>' + (payment.type === 'metal' ? (Number(payment.purity) || 0).toFixed(2) + '%' : '—') + '</td><td class="paid-amount">' + (payment.type === 'metal' ? (Number(payment.fineWeight) || 0).toFixed(3) + ' g' : '—') + '</td><td>' + (payment.type === 'amount' ? money(payment.amount) : '—') + '</td></tr>').join('');
    document.getElementById('paymentsEmpty').style.display = payments.length ? 'none' : 'block';
  };
  const addOldGold = async entry => {
    if (!entry || !Number(entry.weight)) return;
    const entries = await getOldGold();
    if (entries.some(saved => saved.sourceId === entry.sourceId)) return;
    entries.unshift(entry);
    await originalStorageSet('old-gold-records', JSON.stringify(entries));
  };
  const dateForRecord = record => {
    if (record.savedAt) {
      const savedDate = new Date(record.savedAt);
      if (!Number.isNaN(savedDate.getTime())) return savedDate;
    }
    const parts = String(record.date || '').split('/');
    return parts.length === 3 ? new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0])) : new Date(0);
  };
  const renderDashboard = async (forceLiveRates = false) => {
    const records = await getRecords();
    const now = new Date();
    const startToday = new Date(now);
    startToday.setHours(0, 0, 0, 0);
    const startWeek = new Date(startToday);
    startWeek.setDate(startWeek.getDate() - startWeek.getDay());
    const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startYear = new Date(now.getFullYear(), 0, 1);
    const salesSince = start => records.reduce((total, record) => dateForRecord(record) >= start ? total + amount(record.total) : total, 0);
    document.getElementById('dash-today').textContent = money(salesSince(startToday));
    document.getElementById('dash-week').textContent = money(salesSince(startWeek));
    document.getElementById('dash-month').textContent = money(salesSince(startMonth));
    document.getElementById('dash-year').textContent = money(salesSince(startYear));
    const purchases = await getPurchases();
    const payments = await getPayments();
    const collected = records.reduce((total, record) => total + (Number(record.paid) || 0), 0);
    const purchaseValue = purchases.reduce((total, purchase) => total + (Number(purchase.amount) || 0), 0);
    const amountPayments = payments.filter(payment => payment.type === 'amount').reduce((total, payment) => total + (Number(payment.amount) || 0), 0);
    document.getElementById('dash-invoices').textContent = records.length;
    document.getElementById('dash-collected').textContent = money(collected);
    document.getElementById('dash-purchases').textContent = money(purchaseValue);
    document.getElementById('dash-net-collected').textContent = money(collected - purchaseValue);
    document.getElementById('dash-amount-payments').textContent = money(amountPayments);
    document.getElementById('dash-final-net-collected').textContent = money(collected - purchaseValue - amountPayments);
    document.getElementById('dash-due').textContent = money(records.reduce((total, record) => total + Math.max(Number(record.due) || 0, 0), 0));
    const todayRecords = records.filter(record => dateForRecord(record) >= startToday);
    document.getElementById('dash-today-invoices').textContent = todayRecords.length;
    const todayPurchaseValue = purchases.filter(purchase => new Date(purchase.savedAt) >= startToday).reduce((total, purchase) => total + (Number(purchase.amount) || 0), 0);
    const todayAmountPayments = payments.filter(payment => payment.type === 'amount' && new Date(payment.savedAt) >= startToday).reduce((total, payment) => total + (Number(payment.amount) || 0), 0);
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
  const renderRecords = async () => {
    const query = (document.getElementById('recordSearch').value || '').trim().toLowerCase();
    const records = await getRecords();
    const filtered = records.map((record, index) => ({ record, index })).filter(entry => (entry.record.customer + ' ' + entry.record.mobile).toLowerCase().includes(query));
    document.getElementById('recordCountLabel').textContent = filtered.length + ' of ' + records.length + ' shown';
    document.getElementById('recordsTbody').innerHTML = filtered.map(entry => {
      const record = entry.record;
      const index = entry.index;
      const due = Number(record.due) || 0;
      const paid = Number(record.paid) || 0;
      const settlementHistory = (record.payments || []).map(payment => {
        const method = payment.method === 'gold' ? 'Gold' : payment.method === 'silver' ? 'Silver' : 'Amount';
        const itemDetail = payment.weight ? ' · ' + payment.weight + 'g × ₹' + payment.rate + '/g' : '';
        return safe(method + itemDetail + ' — ' + money(payment.amount));
      }).join('<br>') || 'No settlement recorded';
      return '<tr><td style="font-family:var(--font-mono);">' + safe(record.number) + '</td><td>' + safe(record.date) + '</td><td>' + safe(record.customer || 'Walk-in customer') + '</td><td>' + safe(record.mobile || '—') + '</td><td style="font-family:var(--font-mono); color:var(--gold-pale);">' + safe(record.total) + '</td><td class="due-amount">' + money(due) + '</td><td><button class="btn btn-ghost btn-sm record-toggle" data-index="' + index + '">Details</button></td></tr>' +
        '<tr class="record-detail" data-detail="' + index + '" style="display:none;"><td colspan="7"><div class="record-detail-card"><div class="record-info-grid"><div class="record-info"><b>Customer address</b>' + safe(record.address || '—') + '</div><div class="record-info"><b>Items</b>' + safe(record.items || '—') + '</div><div class="record-info"><b>Business / GSTIN</b>' + safe(record.business || 'Vishesh Jewellers') + '<br>' + safe(record.gstin || '—') + '</div><div class="record-info"><b>Subtotal / Tax / Discount</b>' + safe(record.subtotal || '₹0.00') + ' / ' + safe(record.tax || '₹0.00') + ' / ' + safe(record.discount || '₹0.00') + '</div><div class="record-info"><b>Paid</b><span class="paid-amount">' + money(paid) + '</span></div><div class="record-info"><b>Due amount</b><span class="due-amount">' + money(due) + '</span></div><div class="record-info"><b>Payment / settlement history</b>' + settlementHistory + '</div></div><div class="record-actions"><div class="field"><label>Settlement type</label><select class="record-method" data-index="' + index + '" ' + (due <= 0 ? 'disabled' : '') + '><option value="amount">Amount / Cash</option><option value="gold">Gold item</option><option value="silver">Silver item</option></select></div><div class="field" data-amount-field="' + index + '"><label>Settle amount (₹)</label><input type="number" min="0.01" step="0.01" id="settlement-' + index + '" placeholder="Enter received amount" ' + (due <= 0 ? 'disabled' : '') + '></div><div class="field" data-item-field="' + index + '" style="display:none;"><label>Weight (g)</label><input type="number" min="0.001" step="0.001" id="settlement-weight-' + index + '" placeholder="0.000" ' + (due <= 0 ? 'disabled' : '') + '></div><div class="field" data-item-field="' + index + '" style="display:none;"><label>Price per gram (₹)</label><input type="number" min="0.01" step="0.01" id="settlement-rate-' + index + '" placeholder="0.00" ' + (due <= 0 ? 'disabled' : '') + '></div><div class="field" data-item-field="' + index + '" style="display:none;"><label>Calculated settlement (₹)</label><div class="payment-balance" id="settlement-value-' + index + '">₹0.00</div></div><button class="btn btn-gold btn-sm record-settle" data-index="' + index + '" ' + (due <= 0 ? 'disabled' : '') + '>Settle Amount</button><button class="btn btn-ghost btn-sm record-paid" data-index="' + index + '" ' + (due <= 0 ? 'disabled' : '') + '>Mark Fully Paid</button><button class="btn btn-ghost btn-sm record-reprint" data-index="' + index + '">Regenerate Invoice</button></div></div></td></tr>';
    }).join('');
    document.getElementById('recordsEmpty').style.display = records.length ? 'none' : 'block';
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
  const updatePaymentType = () => {
    const isMetal = document.getElementById('paymentType').value === 'metal';
    document.getElementById('paymentAmountField').style.display = isMetal ? 'none' : 'block';
    document.getElementById('paymentMetalFields').style.display = isMetal ? 'block' : 'none';
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
    if (type === 'amount') {
      const amountPaid = Number(document.getElementById('paymentAmountInput').value);
      if (!(amountPaid > 0)) return;
      payments.unshift({ id: Date.now().toString(), type: 'amount', amount: amountPaid, savedAt });
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
      const payment = { id: Date.now().toString(), type: 'metal', metal, weight, purity, fineWeight, savedAt };
      payments.unshift(payment);
      await originalStorageSet('payment-records', JSON.stringify(payments));
      await addOldGold({ sourceId: 'payment:' + payment.id, metal, source: 'Metal payment', invoice: '—', customer: '—', date: new Date(savedAt).toLocaleDateString('en-GB'), weight: -weight, rate: 0, value: 0, receivedAt: savedAt });
      document.getElementById('paymentWeight').value = '';
      document.getElementById('paymentPurity').value = '';
      updateFineWeight();
    }
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
    const due = Number(record.due) || 0;
    const settlementInput = document.getElementById('settlement-' + index);
    const method = document.querySelector('.record-method[data-index="' + index + '"]').value;
    const weight = Number(document.getElementById('settlement-weight-' + index).value);
    const rate = Number(document.getElementById('settlement-rate-' + index).value);
    const settled = button.classList.contains('record-paid') ? due : method === 'amount' ? Number(settlementInput.value) : weight * rate;
    if (!settled || settled <= 0 || settled > due) {
      alert(method === 'amount' ? 'Enter a valid amount up to the outstanding due of ' + money(due) + '.' : 'Enter a valid weight and price per gram whose value does not exceed the due of ' + money(due) + '.');
      return;
    }
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

  document.getElementById('btnCompleteSale').addEventListener('click', event => {
    pendingRecord = {
      number: document.getElementById('inv-no').value || '—',
      date: document.getElementById('p-date').textContent || '—',
      customer: document.getElementById('cust-name').value || 'Walk-in customer',
      mobile: document.getElementById('cust-mobile').value || '',
      address: document.getElementById('cust-address').value || '',
      business: document.getElementById('biz-name').value || 'Vishesh Jewellers',
      gstin: document.getElementById('biz-gstin').value || '',
      items: Array.from(document.querySelectorAll('#p-items-body tr')).map(row => row.cells[1] ? row.cells[1].textContent.trim() : '').filter(Boolean).join(', '),
      subtotal: document.getElementById('mini-sub').textContent || '₹0.00',
      discount: document.getElementById('mini-disc').textContent || '₹0.00',
      tax: document.getElementById('mini-gst').textContent || '₹0.00',
      total: document.getElementById('mini-grand').textContent || '₹0.00',
      exchanges: getExchangeEntries().filter(exchange => exchange.weight > 0),
      paid: amount(document.getElementById('amount-paid').value),
      due: Math.max(amount(document.getElementById('mini-grand').textContent) - amount(document.getElementById('amount-paid').value), 0),
      payments: amount(document.getElementById('amount-paid').value) > 0 ? [{ method: 'amount', amount: amount(document.getElementById('amount-paid').value), settledAt: new Date().toISOString() }] : [],
      invoiceMarkup: document.getElementById('invoicePaper').outerHTML,
      savedAt: new Date().toISOString()
    };
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
