'use strict';

const { HttpMethod, HttpStatus, DesktopMessage } = require('../domain/constants');
const { send, sendJson } = require('../http/response');
const { readJson } = require('../http/request');

function registerSettingsRoutes(router, { config, backups, desktop }) {
  router.add(HttpMethod.GET, '/api/version', ({ res }) => sendJson(res, HttpStatus.OK, { version: config.serverVersion }));
  router.add(HttpMethod.GET, '/api/data-location', ({ res }) => sendJson(res, HttpStatus.OK, { path: config.dataDir, desktop: desktop.enabled }));
  router.add(HttpMethod.POST, '/api/data-location', ({ res }) => {
    if (!desktop.enabled) return sendJson(res, HttpStatus.BAD_REQUEST, { error: 'Desktop app required' });
    desktop.send({ type: DesktopMessage.CHOOSE_LOCATION });
    sendJson(res, HttpStatus.ACCEPTED, { ok: true });
  });
  router.add(HttpMethod.GET, '/api/backup-status', ({ res }) => {
    let latest = null;
    try { latest = backups.latest(); } catch (_) { /* No readable backup directory yet. */ }
    sendJson(res, HttpStatus.OK, { desktop: desktop.enabled, latest });
  });
  router.add(HttpMethod.GET, '/api/backup/download', ({ res }) => {
    if (desktop.enabled) return sendJson(res, HttpStatus.BAD_REQUEST, { error: 'Use the desktop backup dialog.' });
    try {
      const filename = 'Vishesh-Jewellers-Backup-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
      send(res, HttpStatus.OK, JSON.stringify(backups.createPayload(), null, 2), 'application/json; charset=utf-8', {
        'content-disposition': 'attachment; filename="' + filename + '"'
      });
    } catch (error) {
      sendJson(res, HttpStatus.INTERNAL_ERROR, { error: error.message || 'Could not create the encrypted backup.' });
    }
  });
  router.add(HttpMethod.POST, '/api/backup/create', ({ res }) => {
    if (!desktop.enabled) return sendJson(res, HttpStatus.BAD_REQUEST, { error: 'Backup is available in the desktop app.' });
    desktop.send({ type: DesktopMessage.CREATE_BACKUP });
    sendJson(res, HttpStatus.ACCEPTED, { ok: true });
  });
  router.add(HttpMethod.POST, '/api/backup/restore', async ({ req, res }) => {
    if (desktop.enabled) {
      desktop.send({ type: DesktopMessage.RESTORE_BACKUP });
      return sendJson(res, HttpStatus.ACCEPTED, { ok: true });
    }
    try {
      const backup = await readJson(req, 50_000_000, 'Backup file is too large (maximum 50 MB).');
      backups.restore(backup);
      sendJson(res, HttpStatus.OK, { ok: true });
    } catch (error) {
      sendJson(res, error.statusCode || HttpStatus.BAD_REQUEST, { error: error.message || 'Could not restore this backup.' });
    }
  });
}

module.exports = { registerSettingsRoutes };
