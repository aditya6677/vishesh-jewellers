'use strict';

const { readJson } = require('../http/request');
const { sendJson } = require('../http/response');
const { HttpMethod, HttpStatus } = require('../domain/constants');

function registerStockRoutes(router, { stocks }) {
  router.add(HttpMethod.GET, '/api/stocks', ({ res, url }) => sendJson(res, HttpStatus.OK, stocks.list({ page: url.searchParams.get('page'), pageSize: url.searchParams.get('pageSize'), query: url.searchParams.get('query') || '' })));
  router.add(HttpMethod.GET, '/api/stocks/:id', ({ res, match }) => {
    if (!stocks.get) return sendJson(res, 404, { error: 'Not found' });
    sendJson(res, 200, stocks.get(decodeURIComponent(match[1])));
  });
  const mutation = operation => async ({ req, res, match }) => {
    try {
      const input = await readJson(req);
      const result = operation === 'create' ? stocks.create(input) : stocks.mutate(decodeURIComponent(match[1]), input, operation);
      sendJson(res, HttpStatus.OK, result);
    } catch (error) {
      sendJson(res, error.statusCode || HttpStatus.BAD_REQUEST, { error: error.message });
    }
  };
  router.add(HttpMethod.POST, '/api/stocks', mutation('create'));
  router.add(HttpMethod.PUT, '/api/stocks/:id', mutation('edit'));
  router.add(HttpMethod.POST, '/api/stocks/:id/batches', mutation('batch'));
  router.add(HttpMethod.DELETE, '/api/stocks/:id', mutation('delete'));
}

module.exports = { registerStockRoutes };
