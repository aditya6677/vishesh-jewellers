'use strict';

const { readJson } = require('../http/request');
const { sendJson } = require('../http/response');
const { TransactionKind } = require('../services/transaction-service');

function registerTransactionRoutes(router, { transactions }) {
  for (const kind of Object.values(TransactionKind)) {
    const path = '/api/' + kind;
    router.add('GET', path, ({ res, url }) => sendJson(res, 200, transactions.list(kind, { page: url.searchParams.get('page'), pageSize: url.searchParams.get('pageSize') })));
    for (const method of ['POST', 'PUT', 'DELETE']) {
      router.add(method, path + (method === 'POST' ? '' : '/:id'), async ({ req, res, match }) => {
        try {
          const input = await readJson(req);
          const id = method === 'POST' ? undefined : decodeURIComponent(match[1]);
          sendJson(res, 200, transactions.save(kind, input, id, method === 'DELETE'));
        } catch (error) { sendJson(res, error.statusCode || 500, { error: error.message }); }
      });
    }
  }
}

module.exports = { registerTransactionRoutes };
