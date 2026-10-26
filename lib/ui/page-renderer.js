'use strict';

const fs = require('node:fs');
const path = require('node:path');
const manifest = require('./manifest');
const { calculateDashboard } = require('../dashboard-summary');
const { applyWeightOnlyStockFlow } = require('../stock-flow');
const { applyReactStocks, removeLegacyStockSetup } = require('./react-stocks');
const recordFilters = require('../record-filters');

class PageRenderer {
  constructor({ root, sourceHtml }, { readFile = file => fs.readFileSync(file, 'utf8') } = {}) {
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
    const html = reactDashboard ? applyReactStocks(originalHtml) : originalHtml;
    const views = manifest.views.map(name => reactDashboard && name === 'dashboard'
      ? '<section class="page" id="page-dashboard"><div id="react-dashboard"><p role="status">Loading dashboard…</p><a href="/?frontend=legacy">Open the original dashboard</a></div></section>'
      : reactDashboard && ['purchases', 'payments', 'settings', 'records'].includes(name)
        ? `<section class="page react-page" id="page-${name}"><div id="react-${name}"><p role="status">Loading…</p></div></section>`
        : this.read(`views/${name}.html`)).join('');
    const adapter = '\n<style>' + this.read('styles/application.css') + '</style>\n<script>' + this.read('scripts/core/storage-adapter.js') + '</script>\n';
    // Preserve the shared lexical scope used by the original invoice application.
    // The manifest makes each feature's source and initialization order explicit.
    const script = '\n<script>\n(() => {\n  const dashboardSummary = ' + calculateDashboard.toString() + ';\n' +
      manifest.scripts.map(name => {
        if (reactDashboard && name === 'records/list') return this.read('scripts/records/react-bridge.js');
        if (reactDashboard && ['records/filter-events', 'records/settlements', 'records/payment-confirmation'].includes(name)) return '';
        if (name === 'records/filters') return Object.entries(recordFilters).map(([key, fn]) => 'const ' + key + ' = ' + fn.toString() + ';\n').join('');
        if (reactDashboard && name === 'settings/events') return '';
        if (reactDashboard && name === 'settings/status') return `const openSettings = async () => {
          document.querySelectorAll('.tab-btn').forEach(button => button.classList.remove('active'));
          document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
          document.getElementById('settingsTab').classList.add('active');
          document.getElementById('page-settings').classList.add('active');
          window.dispatchEvent(new Event('vj:settings-refresh'));
        };\n`;
        if (reactDashboard && ['purchases/list', 'payments/list'].includes(name)) {
          const kind = name.split('/')[0];
          const label = kind[0].toUpperCase() + kind.slice(1);
          return `const render${label} = async () => window.dispatchEvent(new Event('vj:${kind}-refresh'));\n`;
        }
        if (reactDashboard && ['purchases/calculation', 'purchases/form', 'payments/form', 'shared/transaction-editor', 'shared/transaction-events'].includes(name)) return '';
        if (reactDashboard && name === 'dashboard/events') return '';
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
    return rendered.replace('</head>',
      '<script>window.vjDashboardReady = new Promise(resolve => { window.resolveVjDashboard = resolve; });</script>' +
      '<script type="module" src="/frontend/' + entry.file + '"></script></head>');
  }
}

module.exports = { PageRenderer };
