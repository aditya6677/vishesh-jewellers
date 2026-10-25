'use strict';

const fs = require('node:fs');
const path = require('node:path');
const manifest = require('./manifest');
const { calculateDashboard } = require('../dashboard-summary');
const { applyWeightOnlyStockFlow } = require('../stock-flow');

class PageRenderer {
  constructor({ root, sourceHtml }, { readFile = file => fs.readFileSync(file, 'utf8') } = {}) {
    this.sourceRoot = path.join(root, 'source');
    this.sourceHtml = sourceHtml;
    this.readFile = readFile;
  }

  read(relativePath) {
    return this.readFile(path.join(this.sourceRoot, relativePath));
  }

  render() {
    const html = applyWeightOnlyStockFlow(this.readFile(this.sourceHtml));
    const views = manifest.views.map(name => this.read(`views/${name}.html`)).join('');
    const adapter = '\n<style>' + this.read('styles/application.css') + '</style>\n<script>' + this.read('scripts/core/storage-adapter.js') + '</script>\n';
    // Preserve the shared lexical scope used by the original invoice application.
    // The manifest makes each feature's source and initialization order explicit.
    const script = '\n<script>\n(() => {\n  const dashboardSummary = ' + calculateDashboard.toString() + ';\n' +
      manifest.scripts.map(name => this.read(`scripts/${name}.js`)).join('') + '})();\n</script>\n';
    return html
      .replace('</head>', this.read('views/pwa-head.html') + '</head>')
      .replace('</main>', views + '</main>')
      .replace('<script>', adapter + '<script>')
      .replace('</body>', script + '</body>');
  }
}

module.exports = { PageRenderer };
