'use strict';

const { HttpMethod, HttpStatus } = require('../domain/constants');
const { sendJson } = require('../http/response');

function registerMarketRateRoutes(router, { rates }) {
  router.add(HttpMethod.GET, '/api/live-rates', async ({ res, url }) => {
    try {
      sendJson(res, HttpStatus.OK, await rates.getRates(url.searchParams.get('refresh') === '1'));
    } catch (_) {
      sendJson(res, HttpStatus.UNAVAILABLE, { error: 'Live rates unavailable' });
    }
  });
}

module.exports = { registerMarketRateRoutes };
