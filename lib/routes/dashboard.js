'use strict';

const { HttpMethod, HttpStatus } = require('../domain/constants');
const { sendJson } = require('../http/response');

function validDate(value) {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function registerDashboardRoutes(router, { dashboard }) {
  router.add(HttpMethod.GET, '/api/dashboard', ({ res, url }) => {
    const from = url.searchParams.get('from') || '';
    const to = url.searchParams.get('to') || '';
    if (!validDate(from) || !validDate(to) || (from && to && from > to)) {
      return sendJson(res, HttpStatus.BAD_REQUEST, { error: 'Choose a valid date range: From must be on or before To.' });
    }
    sendJson(res, HttpStatus.OK, dashboard.snapshot({ from, to }));
  });
}

module.exports = { registerDashboardRoutes };
