'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { HttpMethod, HttpStatus } = require('../domain/constants');
const { send } = require('../http/response');
const fonts = require('../ui/offline-fonts');

function registerPageRoutes(router, { config, pages, logger = console }) {
  const assets = [
    ['/vendor/fonts.css', 'public/vendor/fonts.css', 'text/css; charset=utf-8'],
    ...fonts.map(font => ['/vendor/fonts/' + font.file, 'public/vendor/fonts/' + font.file, 'font/woff2']),
    ['/vendor/html2canvas.min.js', 'public/vendor/html2canvas.min.js', 'application/javascript; charset=utf-8'],
    ['/vendor/jspdf.umd.min.js', 'public/vendor/jspdf.umd.min.js', 'application/javascript; charset=utf-8'],
    ['/assets/vishesh-jewellers-logo.png', 'assets/vishesh-jewellers-logo.png', 'image/png'],
    ['/assets/karatdesk-logo.png', 'assets/desktop/karatdesk.png', 'image/png'],
    ['/manifest.webmanifest', 'public/manifest.webmanifest', 'application/manifest+json; charset=utf-8'],
    ['/service-worker.js', 'public/service-worker.js', 'application/javascript; charset=utf-8']
  ];
  for (const [url, file, type] of assets) {
    router.add(HttpMethod.GET, url, ({ res }) => {
      if (config.accountsEnabled && url === '/service-worker.js') return send(res, 200, "self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.map(key=>caches.delete(key)))).then(()=>self.clients.claim())));", type);
      send(res, HttpStatus.OK, fs.readFileSync(path.join(config.root, file)), type);
    });
  }
  router.add(HttpMethod.GET, '/frontend/assets/:file', ({ res, match }) => {
    const file = decodeURIComponent(match[1]);
    if (!/^[\w.-]+\.(js|css)$/.test(file)) return send(res, HttpStatus.NOT_FOUND, 'Not found', 'text/plain');
    const asset = path.join(config.root, 'public/frontend/assets', file);
    if (!fs.existsSync(asset)) return send(res, HttpStatus.NOT_FOUND, 'Not found', 'text/plain');
    send(res, HttpStatus.OK, fs.readFileSync(asset), file.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/javascript; charset=utf-8');
  });
  const render = ({ req, res, url }) => {
    if (config.dataBackend === 'sqlite' && url.searchParams.get('frontend') === 'legacy') return send(res, 409, 'SQLite preview requires the React frontend.', 'text/plain');
    try {
      if (config.accountsEnabled && url.searchParams.get('frontend') === 'legacy') return send(res, 409, 'Account mode requires React.', 'text/plain');
      let html = pages.render({ reactDashboard: url.searchParams.get('frontend') !== 'legacy' });
      if (config.accountsEnabled) html = html.replace('</head>', '<script>window.vjAccountSession=' + JSON.stringify(req.accountSession).replace(/</g, '\\u003c') + ';</script></head>');
      send(res, HttpStatus.OK, html, 'text/html; charset=utf-8');
    }
    catch (error) {
      logger.error('Application page could not be rendered:', error);
      send(res, HttpStatus.INTERNAL_ERROR, 'Source HTML was not found. Set SOURCE_HTML to the path of index.html.', 'text/plain; charset=utf-8');
    }
  };
  router.add(HttpMethod.GET, '/', render);
  router.add(HttpMethod.GET, '/index.html', render);
}

module.exports = { registerPageRoutes };
