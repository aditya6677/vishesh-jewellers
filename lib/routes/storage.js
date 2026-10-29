'use strict';

const { HttpMethod, HttpStatus } = require('../domain/constants');
const { sendJson } = require('../http/response');
const { readJson } = require('../http/request');

function registerStorageRoutes(router, { store }) {
  const pattern = '/api/storage/:key';
  router.add(HttpMethod.GET, pattern, ({ res, match }) => {
    const key = decodeURIComponent(match[1]);
    const value = store.getValue ? store.getValue(key) : store.read()[key];
    if (value === undefined) return sendJson(res, HttpStatus.NOT_FOUND, { error: 'Not found' });
    sendJson(res, HttpStatus.OK, { value: JSON.stringify(value), ...(store.isPartial?.(key) ? { partial: true } : {}) });
  });
  router.add(HttpMethod.PUT, pattern, async ({ req, res, match }) => {
    try {
      const key = decodeURIComponent(match[1]);
      const payload = await readJson(req);
      if (typeof payload.value !== 'string') throw new Error('Value must be a string');
      if (store.setValue) store.setValue(key, JSON.parse(payload.value));
      else { const data = store.read(); data[key] = JSON.parse(payload.value); store.write(data); }
      sendJson(res, HttpStatus.OK, { ok: true });
    } catch (error) {
      sendJson(res, error.statusCode || HttpStatus.BAD_REQUEST, { error: error.message });
    }
  });
}

module.exports = { registerStorageRoutes };
