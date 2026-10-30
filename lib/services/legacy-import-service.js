'use strict';
const { randomBytes, createHash, scryptSync, createCipheriv, createDecipheriv } = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { StorageKey } = require('../domain/constants');
const { auditSnapshot } = require('../database/migration-preflight');
const { readSnapshot } = require('../database/snapshot-migration');
const { DashboardService } = require('./dashboard-service');
const { createDatabaseBackup } = require('../database/backup');
const FORMAT = 'karatdesk-legacy-portable-v1';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const collections = Object.values(StorageKey);
const allowed = [...collections, 'business-info', 'items-master', 'invoice-counter'];

function portable(snapshot, passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < 12 || passphrase.length > 512) throw new Error('Use a recovery passphrase of 12–512 characters.');
  const salt = randomBytes(16), iv = randomBytes(12), key = scryptSync(passphrase, salt, 32);
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(snapshot)), cipher.final()]);
    return { format: FORMAT, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
  } finally { key.fill(0); }
}
function unlock(envelope, passphrase) {
  if (envelope?.format !== FORMAT || typeof passphrase !== 'string' || passphrase.length > 512) throw new Error('Choose a supported portable legacy file and enter its passphrase.');
  const bytes = (value, size) => { if (typeof value !== 'string') throw new Error('Invalid portable file.'); const result = Buffer.from(value, 'base64'); if (result.toString('base64') !== value || (size && result.length !== size)) throw new Error('Invalid portable file.'); return result; };
  const key = scryptSync(passphrase, bytes(envelope.salt, 16), 32);
  let plain;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, bytes(envelope.iv, 12));
    decipher.setAuthTag(bytes(envelope.tag, 16));
    plain = Buffer.concat([decipher.update(bytes(envelope.ciphertext)), decipher.final()]);
    return JSON.parse(plain.toString('utf8'));
  } catch { throw new Error('Could not unlock the file. Check the passphrase and original file.'); }
  finally { key.fill(0); plain?.fill(0); }
}
function prepare(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('Invalid legacy snapshot.');
  const snapshot = structuredClone(Object.fromEntries(allowed.filter(key => Object.hasOwn(source, key)).map(key => [key, source[key]])));
  for (const name of collections) snapshot[name] ??= [];
  const audit = auditSnapshot(snapshot);
  if (audit.blockingErrors) throw new Error('Legacy data has validation errors: ' + audit.issues.filter(issue => issue.severity === 'error').slice(0, 5).map(issue => `${issue.collection} row ${issue.index + 1}: ${issue.code}`).join('; '));
  if (!collections.some(name => snapshot[name].length)) throw new Error('No business records were found in this file.');
  let next = Number(snapshot['invoice-counter'] || 1);
  if (!Number.isSafeInteger(next) || next < 1) throw new Error('Invalid invoice counter.');
  for (const record of snapshot['invoice-records']) { const match = /^VJ(\d+)$/.exec(record.number); if (match) next = Math.max(next, Number(match[1]) + 1); }
  if (!Number.isSafeInteger(next)) throw new Error('Invoice counter is too large.');
  snapshot['invoice-counter'] = next;
  return { snapshot, counts: audit.counts, warnings: audit.issues, ignoredKeys: Object.keys(source).filter(key => !allowed.includes(key)), nextInvoice: 'VJ' + String(next).padStart(6, '0'), summary: new DashboardService({ read: () => snapshot }).snapshot() };
}

class LegacyImportService {
  constructor(database, { now = Date.now } = {}) { this.database = database; this.now = now; this.staged = null; this.busy = false; }
  assertEmpty() {
    const { db, storeId } = this.database;
    if (db.prepare('SELECT count(*) AS n FROM documents WHERE store_id=?').get(storeId).n || db.prepare("SELECT 1 FROM store_properties WHERE store_id=? AND name='legacy-import-receipt'").get(storeId)) throw new Error('Import is only available for an empty store that has not already imported legacy data.');
    const catalog = db.prepare("SELECT payload FROM store_properties WHERE store_id=? AND name='items-master'").get(storeId);
    if (catalog && JSON.parse(catalog.payload)?.length) throw new Error('Remove the destination item catalog before importing into this store.');
    const counter = db.prepare("SELECT payload FROM store_properties WHERE store_id=? AND name='invoice-counter'").get(storeId);
    if (counter && Number(JSON.parse(counter.payload)) > 1) throw new Error('This store has already issued invoices. Use a new, empty store for legacy import.');
  }
  preview(input) {
    if (this.busy) throw new Error('An import is already running.');
    this.assertEmpty();
    const result = prepare(input.portable ? unlock(input.portable, input.passphrase) : input.snapshot);
    const token = randomBytes(32).toString('hex');
    this.staged = { ...result, token, expires: this.now() + 10 * 60_000, fingerprint: hash(result.snapshot) };
    clearTimeout(this.expiryTimer);
    this.expiryTimer = setTimeout(() => { if (this.staged?.token === token && !this.busy) this.staged = null; }, 10 * 60_000);
    this.expiryTimer.unref?.();
    const { snapshot, ...view } = result;
    return { ...view, token, storeName: snapshot['business-info']?.name || 'Older store', expiresInMinutes: 10 };
  }
  async commit(input) {
    return this.database.backups.exclusive ? this.database.backups.exclusive(() => this.commitUnlocked(input)) : this.commitUnlocked(input);
  }
  async commitUnlocked({ token, confirmation, acknowledgeLegacy }) {
    const staged = this.staged;
    if (this.busy || !staged || token !== staged.token || this.now() >= staged.expires) throw new Error('Preview expired or unavailable. Select and preview the file again.');
    if (confirmation !== 'IMPORT' || acknowledgeLegacy !== true) throw new Error('Acknowledge preservation of historical records and type IMPORT.');
    this.busy = true;
    try {
      const runtime = this.database;
      runtime.assertAvailable(); this.assertEmpty();
      fs.mkdirSync(runtime.backups.directory, { recursive: true, mode: 0o700 });
      const backup = path.join(runtime.backups.directory, 'before-legacy-import-' + randomBytes(12).toString('hex') + '.db');
      await createDatabaseBackup(runtime.db, runtime.databaseKey, backup);
      runtime.assertAvailable();
      const result = runtime.db.transaction(() => {
        this.assertEmpty();
        const db = runtime.db, storeId = runtime.storeId;
        let position = db.prepare('SELECT coalesce(max(position),-1)+1 AS n FROM store_properties WHERE store_id=?').get(storeId).n;
        const property = (name, value, collection = false) => {
          db.prepare('DELETE FROM store_properties WHERE store_id=? AND name=?').run(storeId, name);
          db.prepare('INSERT INTO store_properties VALUES(?,?,?,?,?)').run(storeId, name, position++, collection ? 1 : 0, collection ? null : JSON.stringify(value));
        };
        for (const [name, value] of Object.entries(staged.snapshot)) {
          const collection = collections.includes(name); property(name, value, collection);
          if (collection) value.forEach((row, ordinal) => db.prepare('INSERT INTO documents VALUES(?,?,?,?,?)').run(storeId, name, ordinal, name === StorageKey.OLD_METAL ? null : String(name === StorageKey.INVOICES ? row.number : row.id), JSON.stringify(row)));
        }
        const actual = readSnapshot(db, storeId);
        for (const [key, value] of Object.entries(staged.snapshot)) assert.deepStrictEqual(actual[key], value);
        assert.deepStrictEqual(new DashboardService({ read: () => actual }).snapshot(), staged.summary);
        assert.deepStrictEqual(runtime.query.dashboard().summary, staged.summary.summary);
        const dates = staged.snapshot['invoice-records'].map(record => record.invoiceDate).filter(value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)).sort();
        const ranges = dates.length ? [{ from: dates[0], to: dates.at(-1) }, { from: dates.at(-1), to: dates.at(-1) }] : [];
        for (const range of ranges) assert.deepStrictEqual(runtime.query.dashboard(range).summary, new DashboardService({ read: () => staged.snapshot }).snapshot(range).summary);
        property('legacy-import-receipt', { fingerprint: staged.fingerprint, importedAt: new Date(this.now()).toISOString(), counts: staged.counts, nextInvoice: staged.nextInvoice });
        db.prepare('UPDATE store_revisions SET revision=revision+1 WHERE store_id=?').run(storeId);
        return { ok: true, verified: true, counts: staged.counts, checkedDateRanges: ranges.length, nextInvoice: staged.nextInvoice, safetyBackup: path.basename(backup) };
      }).immediate();
      runtime.query.reportCache.clear(); this.staged = null;
      return result;
    } finally { this.busy = false; }
  }
}
module.exports = { LegacyImportService, prepare, portable, unlock };
