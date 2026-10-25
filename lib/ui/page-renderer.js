'use strict';

const fs = require('node:fs');
const path = require('node:path');
const manifest = require('./manifest');
const { calculateDashboard } = require('../dashboard-summary');
const { applyWeightOnlyStockFlow } = require('../stock-flow');

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
    const html = applyWeightOnlyStockFlow(this.readFile(this.sourceHtml));
    const views = manifest.views.map(name => reactDashboard && name === 'dashboard'
      ? '<section class="page" id="page-dashboard"><div id="react-dashboard"><p role="status">Loading dashboard…</p><a href="/?frontend=legacy">Open the original dashboard</a></div></section>'
      : this.read(`views/${name}.html`)).join('');
    const adapter = '\n<style>' + this.read('styles/application.css') + '</style>\n<script>' + this.read('scripts/core/storage-adapter.js') + '</script>\n';
    // Preserve the shared lexical scope used by the original invoice application.
    // The manifest makes each feature's source and initialization order explicit.
    const script = '\n<script>\n(() => {\n  const dashboardSummary = ' + calculateDashboard.toString() + ';\n' +
      manifest.scripts.map(name => {
        if (reactDashboard && name === 'dashboard/events') return '';
        if (reactDashboard && name === 'dashboard/summary') return '  const renderDashboard = async (force = false) => (await window.vjDashboardReady).refresh(force);\n';
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
