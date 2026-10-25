'use strict';

const { HttpMethod, HttpStatus } = require('../domain/constants');
const { sendJson } = require('../http/response');

function registerInvoiceRoutes(router, { invoices }) {
  router.add(HttpMethod.DELETE, '/api/invoices/:number', ({ res, match }) => {
    try {
      invoices.delete(decodeURIComponent(match[1]));
      sendJson(res, HttpStatus.OK, { ok: true });
    } catch (error) {
      sendJson(res, HttpStatus.BAD_REQUEST, { error: error.message });
    }
  });
}

module.exports = { registerInvoiceRoutes };
