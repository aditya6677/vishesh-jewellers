'use strict';
const { send, sendJson } = require('../http/response');
const { manifest } = require('../legal/documents');
const { renderDocument } = require('../legal/render-document');
function registerLegalRoutes(router, { config }) {
  router.add('GET', '/legal/:document', ({ res, match, url }) => {
    const html = renderDocument(decodeURIComponent(match[1]), url.searchParams.get('theme') === 'light');
    return html ? send(res, 200, html, 'text/html; charset=utf-8', { 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'", 'x-content-type-options': 'nosniff' }) : send(res, 404, 'Document not found', 'text/plain');
  });
  if (!config.accountsEnabled) router.add('GET', '/api/legal', ({ res }) => sendJson(res, 200, { ...manifest, enabled: false, accepted: false, canAccept: false, acceptance: null }));
}
module.exports = { registerLegalRoutes };
