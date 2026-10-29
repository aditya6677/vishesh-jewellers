'use strict';

const fs = require('node:fs');
const path = require('node:path');
const manifest = require('./manifest');
const { calculateDashboard } = require('../dashboard-summary');
const { applyWeightOnlyStockFlow } = require('../stock-flow');
const { applyReactStocks, removeLegacyStockSetup } = require('./react-stocks');
const { applyReactInvoiceExchange } = require('./react-invoice-exchange');
const { applyReactInvoiceSave } = require('./react-invoice-save');
const { applyReactInvoiceDetails } = require('./react-invoice-details');
const { applyReactInvoiceItems } = require('./react-invoice-items');
const { applyReactInvoicePreview } = require('./react-invoice-preview');
const { initialPaidFor, editTotals } = require('../services/invoice-editing');
const { applyReactMessages } = require('./react-messages');
const { applyReactNavigation } = require('./react-navigation');
const recordFilters = require('../record-filters');
const { calculateInvoiceLineAmount, calculateInvoiceTotals } = require('../invoice-calculation');

class PageRenderer {
  constructor({ root, sourceHtml, dataBackend = 'json' }, { readFile = file => fs.readFileSync(file, 'utf8') } = {}) {
    this.databaseMode = dataBackend === 'sqlite';
    this.root = root;
    this.sourceRoot = path.join(root, 'source');
    this.sourceHtml = sourceHtml;
    this.readFile = readFile;
  }

  read(relativePath) {
    return this.readFile(path.join(this.sourceRoot, relativePath));
  }

  render({ reactDashboard = false } = {}) {
    const originalHtml = applyWeightOnlyStockFlow(this.readFile(this.sourceHtml));
    let html = originalHtml;
    if (this.databaseMode) html = html.replace('if(bumpCounter){', 'if(bumpCounter && !window.vjDatabaseMode){');
    if (reactDashboard) {
      html = applyReactMessages(html);
      html = applyReactStocks(html).replace('id="react-invoice-payment-summary" hidden', 'id="react-invoice-payment-summary"');
      html = applyReactInvoiceExchange(html);
      html = applyReactInvoiceSave(html);
      html = applyReactInvoiceDetails(html);
      html = applyReactInvoiceItems(html);
      html = applyReactInvoicePreview(html);
      html = applyReactNavigation(html);
    }
    const views = manifest.views.map(name => reactDashboard && name === 'dashboard'
      ? '<section class="page" id="page-dashboard"><div id="react-dashboard"><p role="status">Loading dashboard…</p><a href="/?frontend=legacy">Open the original dashboard</a></div></section>'
      : reactDashboard && ['purchases', 'payments', 'settings', 'records'].includes(name)
        ? `<section class="page react-page" id="page-${name}"><div id="react-${name}"><p role="status">Loading…</p></div></section>`
        : this.read(`views/${name}.html`)).join('');
    const invoiceMath = '<script>window.vjInvoiceMath = (() => { const calculateInvoiceLineAmount = ' + calculateInvoiceLineAmount.toString() + '; const calculateInvoiceTotals = ' + calculateInvoiceTotals.toString() + '; return { lineAmount: calculateInvoiceLineAmount, totals: calculateInvoiceTotals }; })();</script>';
    const adapter = '\n<style>' + this.read('styles/application.css') + '</style>\n<script>window.vjDatabaseMode=' + Boolean(this.databaseMode) + ';' + this.read('scripts/core/storage-adapter.js') + '</script>\n' + invoiceMath + '\n';
    // Preserve the shared lexical scope used by the original invoice application.
    // The manifest makes each feature's source and initialization order explicit.
    const script = '\n<script>\n(() => {\n  const dashboardSummary = ' + calculateDashboard.toString() + ';\n' +
      manifest.scripts.map(name => {
        if (reactDashboard && name === 'core/tabs') return '';
        if (reactDashboard && name === 'records/pdf-export') return '';
        if (reactDashboard && name === 'core/navigation') return '';
        if (reactDashboard && name === 'core/pin-lock') return 'window.orderMode = false;\n';
        if (name === 'invoice/details-bridge') return reactDashboard ? this.read('scripts/invoice/details-bridge.js') : '';
        if (name === 'invoice/items-bridge') return reactDashboard ? this.read('scripts/invoice/items-bridge.js') : '';
        if (name === 'invoice/preview-bridge') return reactDashboard ? this.read('scripts/invoice/preview-bridge.js') : '';
        if (reactDashboard && name === 'records/list') return this.read('scripts/records/react-bridge.js');
        if (reactDashboard && name === 'invoice/exchange') return `const amount = value => Number(String(value || '').replace(/[^0-9.-]/g, '')) || 0;\nconst getExchangeEntries = () => window.vjInvoiceExchangeEntries ? window.vjInvoiceExchangeEntries() : [] ;\n`;
        if (reactDashboard && name === 'invoice/save') return this.read('scripts/invoice/save-api.js');
        if (reactDashboard && name === 'invoice/editor') return 'window.vjInvoiceEditMath = { initialPaidFor: ' + initialPaidFor.toString() + ', totals: ' + editTotals.toString().replace(/calculateInvoiceLineAmount/g, 'window.vjInvoiceMath.lineAmount') + ', words: numToWords };\n// End shared editor math.\n';
        if (reactDashboard && name === 'invoice/preview') return '';
        if (reactDashboard && name === 'invoice/success-dialog') return this.read('scripts/invoice/success-bridge.js');
        if (reactDashboard && name === 'records/void-invoice') return '';
        if (reactDashboard && name === 'records/invoice-output') return '';
        if (reactDashboard && ['records/filter-events', 'records/settlements', 'records/payment-confirmation'].includes(name)) return '';
        if (name === 'records/filters') return Object.entries(recordFilters).map(([key, fn]) => 'const ' + key + ' = ' + fn.toString() + ';\n').join('');
        if (reactDashboard && name === 'settings/events') return '';
        if (reactDashboard && name === 'settings/status') return '';
        if (reactDashboard && ['purchases/list', 'payments/list'].includes(name)) {
          const kind = name.split('/')[0];
          const label = kind[0].toUpperCase() + kind.slice(1);
          return `const render${label} = async () => window.dispatchEvent(new Event('vj:${kind}-refresh'));\n`;
        }
        if (reactDashboard && ['purchases/calculation', 'purchases/form', 'payments/form', 'shared/transaction-editor', 'shared/transaction-events'].includes(name)) return '';
        if (reactDashboard && name === 'dashboard/events') return '';
        if (reactDashboard && name === 'invoice/payment-summary') return '';
        if (reactDashboard && name === 'dashboard/summary') return '  const renderDashboard = async (force = false) => (await window.vjDashboardReady).refresh(force);\n';
        if (reactDashboard && name === 'invoice/setup') return removeLegacyStockSetup(this.read(`scripts/${name}.js`));
        return this.read(`scripts/${name}.js`);
      }).join('') + '})();\n</script>\n';
    const rendered = html
      .replace('</head>', this.read('views/pwa-head.html') + '</head>')
      .replace('</main>', views + '</main>')
      .replace('<script>', adapter + '<script>')
      .replace('</body>', script + '</body>');
    if (!reactDashboard) return rendered;
    const assets = JSON.parse(this.readFile(path.join(this.root, 'public/frontend/.vite/manifest.json')));
    const entry = assets['frontend/main.tsx'];
    if (!entry || !/^assets\/[\w.-]+\.js$/.test(entry.file)) throw new Error('React dashboard build is missing. Run npm run build:frontend.');
    return rendered.replace('<body>', '<body><script>try { if (sessionStorage.getItem("vishesh-jewellers-pin-unlocked") !== "true") document.body.classList.add("pin-locked"); } catch (_) { document.body.classList.add("pin-locked"); }</script>')
      .replace('</body>', '<section id="react-pin-lock" class="pin-lock" style="display:none" aria-label="Private workspace"></section><div id="react-saved-invoice-viewer"></div><div id="react-invoice-editor"></div><div id="react-invoice-void"></div><div id="react-invoice-success"></div><div id="react-app-messages"></div></body>').replace('</head>',
      '<style>body.pin-locked{overflow:hidden}body.pin-locked > *:not(.pin-lock){visibility:hidden}</style>' +
      '<script>window.vjDashboardReady = new Promise(resolve => { window.resolveVjDashboard = resolve; });</script>' +
      '<script type="module" src="/frontend/' + entry.file + '"></script></head>');
  }
}

module.exports = { PageRenderer };
