'use strict';

const { buildSystemExport } = require('../excel-export');
const { HttpMethod, HttpStatus } = require('../domain/constants');
const { send, sendJson } = require('../http/response');
const { DatabaseQueries, rangeBounds } = require('../database/queries');

function registerReportRoutes(router, { store, database, dashboard, logger = console }) {
  router.add('GET', '/api/reports/dashboard.csv', async ({ res, url }) => {
    try {
      const range = { from: url.searchParams.get('from') || '', to: url.searchParams.get('to') || '' };
      rangeBounds(range);
      const snapshot = await dashboard.snapshot(range), rows = [];
      const visit = (value, prefix) => { for (const [key, item] of Object.entries(value)) if (item && typeof item === 'object') visit(item, prefix + key + '.'); else rows.push([prefix + key, item]); };
      visit(snapshot, '');
      const quote = value => '"' + String(value ?? '').replaceAll('"', '""') + '"';
      send(res, 200, '\ufeffMetric,Value\r\n' + rows.map(row => row.map(quote).join(',')).join('\r\n') + '\r\n', 'text/csv; charset=utf-8', { 'content-disposition': 'attachment; filename="Business-Snapshot.csv"' });
    } catch (error) { sendJson(res, error.statusCode || 400, { error: error.message }); }
  });
  router.add('GET', '/api/reports/records.csv', async ({ res, url }) => {
    if (!database) return sendJson(res, 409, { error: 'Streaming CSV is available in database mode.' });
    const reader = database.openReader();
    const raw = res.raw || res;
    try {
      const query = new DatabaseQueries(reader, database.storeId);
      const filters = { query: url.searchParams.get('q') || '', status: url.searchParams.get('status') || 'all', from: url.searchParams.get('from') || '', to: url.searchParams.get('to') || '' };
      query.recordWhere(filters);
      reader.exec('BEGIN');
      if (res.hijack) res.hijack();
      raw.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'cache-control': 'no-store', 'content-disposition': 'attachment; filename="Invoice-Records.csv"' });
      const fields = ['number','date','invoiceDate','customer','mobile','address','business','gstin','status','subtotal','discount','manualDiscount','tax','gstRate','total','initialPaid','paid','due','returnTotal','returns','soldItems','orderItems','exchanges','exchange','payments','savedAt','editedAt','voidedAt','voidReason'];
      const cell = value => { let text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value); if (typeof value === 'string' && /^(\s*[=+\-@]|[\t\r])/.test(text)) text = "'" + text; return '"' + text.replaceAll('"', '""') + '"'; };
      raw.write('\ufeff' + fields.join(',') + '\r\n');
      for (const record of query.recordExport(filters)) {
        if (raw.destroyed) break;
        if (!raw.write(fields.map(field => cell(record[field])).join(',') + '\r\n')) await new Promise((resolve, reject) => {
          const cleanup = () => { raw.off('drain', ready); raw.off('close', ready); raw.off('error', failed); };
          const ready = () => { cleanup(); resolve(); };
          const failed = error => { cleanup(); reject(error); };
          raw.once('drain', ready); raw.once('close', ready); raw.once('error', failed);
        });
      }
      if (!raw.destroyed) raw.end();
    } catch (error) {
      if (!raw.headersSent) sendJson(res, error.statusCode || 500, { error: error.message });
      else raw.destroy(error);
    } finally { if (reader.open) { if (reader.inTransaction) reader.exec('ROLLBACK'); reader.close(); } }
  });
  router.add(HttpMethod.GET, '/api/export.xlsx', ({ res }) => {
    try {
      if (database) {
        const count = database.db.prepare('SELECT count(*) AS n FROM documents WHERE store_id=?').get(database.storeId).n;
        if (count > 10000) return sendJson(res, 409, { error: 'Excel export is limited to 10,000 rows in this preview. Use streaming CSV for large invoice reports.' });
        const bytes = database.db.prepare('SELECT (SELECT coalesce(sum(length(payload)),0) FROM documents WHERE store_id=?) + (SELECT coalesce(sum(length(payload)),0) FROM store_properties WHERE store_id=?) AS n').get(database.storeId, database.storeId).n;
        if (bytes > 25000000) return sendJson(res, 409, { error: 'Excel export is limited to 25 MB of source rows in this preview. Use streaming CSV.' });
      }
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
