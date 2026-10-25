'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { HttpMethod, HttpStatus } = require('../domain/constants');
const { send } = require('../http/response');

function registerPageRoutes(router, { config, pages, logger = console }) {
  const assets = [
    ['/assets/vishesh-jewellers-logo.png', 'assets/vishesh-jewellers-logo.png', 'image/png'],
    ['/manifest.webmanifest', 'public/manifest.webmanifest', 'application/manifest+json; charset=utf-8'],
    ['/service-worker.js', 'public/service-worker.js', 'application/javascript; charset=utf-8']
  ];
  for (const [url, file, type] of assets) {
    router.add(HttpMethod.GET, url, ({ res }) => send(res, HttpStatus.OK, fs.readFileSync(path.join(config.root, file)), type));
  }
  const render = ({ res }) => {
    try { send(res, HttpStatus.OK, pages.render(), 'text/html; charset=utf-8'); }
    catch (error) {
      logger.error('Application page could not be rendered:', error);
      send(res, HttpStatus.INTERNAL_ERROR, 'Source HTML was not found. Set SOURCE_HTML to the path of index.html.', 'text/plain; charset=utf-8');
    }
  };
  router.add(HttpMethod.GET, '/', render);
  router.add(HttpMethod.GET, '/index.html', render);
}

module.exports = { registerPageRoutes };
