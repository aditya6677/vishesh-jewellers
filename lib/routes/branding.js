'use strict';
const { sendJson } = require('../http/response');
const { readJson } = require('../http/request');
function registerBrandingRoutes(router, { branding }) {
  router.add('GET', '/api/branding', ({ res }) => sendJson(res, 200, branding.read()));
  router.add('PUT', '/api/branding', async ({ req, res }) => {
    try { sendJson(res, 200, branding.save(await readJson(req, 1_500_000))); }
    catch (error) { sendJson(res, error.statusCode || 400, { error: error.message }); }
  });
}
module.exports = { registerBrandingRoutes };
