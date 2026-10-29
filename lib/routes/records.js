'use strict';

const { sendJson } = require('../http/response');
const { readJson } = require('../http/request');

function registerRecordRoutes(router, { records }) {
  router.add('GET', '/api/records', ({ res, url }) => {
    try { sendJson(res, 200, records.list({ query: url.searchParams.get('q') || '', status: url.searchParams.get('status') || 'all', from: url.searchParams.get('from') || '', to: url.searchParams.get('to') || '', page: url.searchParams.get('page'), pageSize: url.searchParams.get('pageSize') })); }
    catch (error) { sendJson(res, error.statusCode || 500, { error: error.message }); }
  });
  router.add('GET', '/api/records/:number', ({ res, url, match }) => {
    try { sendJson(res, 200, records.get(decodeURIComponent(match[1]), url.searchParams.get('version') || '')); }
    catch (error) { sendJson(res, error.statusCode || 500, { error: error.message }); }
  });
  router.add('POST', '/api/records/:number/settlements', async ({ req, res, match }) => {
    try { sendJson(res, 200, records.settle(decodeURIComponent(match[1]), await readJson(req))); }
    catch (error) { sendJson(res, error.statusCode || 500, { error: error.message }); }
  });
}

module.exports = { registerRecordRoutes };
