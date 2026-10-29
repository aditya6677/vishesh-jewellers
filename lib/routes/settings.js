'use strict';

const { HttpMethod, HttpStatus, DesktopMessage } = require('../domain/constants');
const { send, sendJson } = require('../http/response');
const { readJson } = require('../http/request');

function registerSettingsRoutes(router, { config, backups, desktop, database }) {
  router.add(HttpMethod.GET, '/api/version', ({ res }) => sendJson(res, HttpStatus.OK, { version: config.serverVersion, appVersion: require('../../package.json').version, ...(config.dataBackend === 'sqlite' ? { dataBackend: 'sqlite' } : {}) }));
  router.add(HttpMethod.GET, '/api/data-location', ({ res }) => sendJson(res, HttpStatus.OK, { path: config.dataBackend === 'sqlite' ? require('node:path').dirname(config.databaseFile) : config.dataDir, desktop: desktop.enabled }));
  router.add(HttpMethod.POST, '/api/data-location', ({ res }) => {
    if (database) return sendJson(res, 409, { error: 'Changing the database folder is not enabled. Keep the database and protected key configuration together.' });
    if (!desktop.enabled) return sendJson(res, HttpStatus.BAD_REQUEST, { error: 'Desktop app required' });
    desktop.send({ type: DesktopMessage.CHOOSE_LOCATION });
    sendJson(res, HttpStatus.ACCEPTED, { ok: true });
  });
  router.add(HttpMethod.GET, '/api/backup-status', ({ res }) => {
    let latest = null;
    try { latest = backups.latest(); } catch (_) { /* No readable backup directory yet. */ }
    sendJson(res, HttpStatus.OK, { desktop: desktop.enabled, latest, ...(database ? backups.status() : {}) });
  });
  if (database) {
    for (const action of ['portable', 'verify', 'import', 'prepare', 'activate', 'location']) router.add(HttpMethod.POST, '/api/database-backup/' + action, async ({ req, res }) => {
      try {
        const headers = req.headers;
        if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(headers.host || '')) throw new Error('Database backup controls are available only on localhost.');
        if (headers.origin && headers.origin !== 'http://' + headers.host) throw new Error('Backup requests must come from this app.');
        if (!String(headers['content-type'] || '').startsWith('application/json')) throw new Error('A JSON backup request is required.');
        const input = await readJson(req, action === 'import' ? 35_000_000 : 8192);
        const result = action === 'location' ? await backups.changeLocation(input?.path)
          : action === 'portable' ? await backups.createPortable(input?.passphrase)
          : action === 'verify' ? await backups.verifyPortable(input?.name, input?.passphrase)
          : action === 'import' ? await backups.importPortable(input?.files, input?.passphrase)
          : action === 'prepare' ? await backups.prepareRecovery(input?.name, input?.passphrase)
          : await backups.activatePrepared(input?.token, input?.confirmation);
        sendJson(res, HttpStatus.OK, result);
      } catch (error) { sendJson(res, error.statusCode || HttpStatus.BAD_REQUEST, { error: error.message || 'Backup operation failed.' }); }
    });
  }
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
    if (database) return sendJson(res, 409, { error: 'Use Create Portable Backup for database backups.' });
    if (!desktop.enabled) return sendJson(res, HttpStatus.BAD_REQUEST, { error: 'Backup is available in the desktop app.' });
    desktop.send({ type: DesktopMessage.CREATE_BACKUP });
    sendJson(res, HttpStatus.ACCEPTED, { ok: true });
  });
  router.add(HttpMethod.POST, '/api/backup/restore', async ({ req, res }) => {
    if (database) return sendJson(res, 409, { error: 'Use the prepare-and-confirm database restore workflow.' });
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
