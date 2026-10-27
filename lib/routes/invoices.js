'use strict';

const { HttpMethod, HttpStatus } = require('../domain/constants');
const { sendJson } = require('../http/response');
const { readJson } = require('../http/request');

function registerInvoiceRoutes(router, { invoices }) {
  router.add(HttpMethod.POST, '/api/invoices/:number/void', async ({ req, res, match }) => {
    try { sendJson(res, HttpStatus.OK, invoices.void(decodeURIComponent(match[1]), await readJson(req))); }
    catch (error) { sendJson(res, error.statusCode || HttpStatus.BAD_REQUEST, { error: error.message }); }
  });
  router.add('PUT', '/api/invoices/:number', async ({ req, res, match }) => {
    try { sendJson(res, HttpStatus.OK, invoices.edit(decodeURIComponent(match[1]), await readJson(req))); }
    catch (error) { sendJson(res, error.statusCode || HttpStatus.BAD_REQUEST, { error: error.message }); }
  });
  router.add(HttpMethod.POST, '/api/invoices', async ({ req, res }) => {
    try { sendJson(res, HttpStatus.OK, invoices.create(await readJson(req))); }
    catch (error) { sendJson(res, error.statusCode || HttpStatus.BAD_REQUEST, { error: error.message }); }
  });
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
