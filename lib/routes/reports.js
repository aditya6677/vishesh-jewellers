'use strict';

const { buildSystemExport } = require('../excel-export');
const { HttpMethod, HttpStatus } = require('../domain/constants');
const { send, sendJson } = require('../http/response');

function registerReportRoutes(router, { store, logger = console }) {
  router.add(HttpMethod.GET, '/api/export.xlsx', ({ res }) => {
    try {
      const workbook = buildSystemExport(store.read());
      const filename = 'Vishesh-Jewellers-Data-' + new Date().toISOString().slice(0, 10) + '.xlsx';
      send(res, HttpStatus.OK, workbook, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', {
        'content-disposition': 'attachment; filename="' + filename + '"',
        'content-length': workbook.length
      });
    } catch (error) {
      logger.error('System data export failed:', error);
      sendJson(res, HttpStatus.INTERNAL_ERROR, { error: 'Could not export the saved data. Please try again.' });
    }
  });
}

module.exports = { registerReportRoutes };
