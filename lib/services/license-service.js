'use strict';
const fs = require('node:fs');
const { randomUUID, randomBytes, createCipheriv, createDecipheriv, verify, createPublicKey } = require('node:crypto');
const DAY = 86400000;
const fail = message => { throw Object.assign(new Error(message), { statusCode: 402 }); };
function verifyLicense(token, publicKey, installationId) {
  if (typeof token !== 'string' || token.length > 12000 || !publicKey) throw new Error('A valid vendor-issued activation and configured verification key are required.');
  const pieces = token.trim().split('.'), [payload, signature] = pieces;
  const verificationKey = typeof publicKey === 'string' || Buffer.isBuffer(publicKey) ? createPublicKey(publicKey) : publicKey;
  if (verificationKey.asymmetricKeyType !== 'ed25519' || pieces.length !== 2 || !payload || !signature || !/^[A-Za-z0-9_-]+$/.test(payload) || !/^[A-Za-z0-9_-]+$/.test(signature) || !verify(null, Buffer.from(payload), verificationKey, Buffer.from(signature, 'base64url'))) throw new Error('Activation signature is invalid.');
  const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (value.version !== 1 || value.installationId !== installationId || value.type !== 'paid' || typeof value.plan !== 'string' || !value.plan.trim() || value.plan.length > 80 || (value.expiresAt !== null && (!Number.isSafeInteger(value.expiresAt) || value.expiresAt <= 0)) || (value.invoiceLimit !== null && (!Number.isSafeInteger(value.invoiceLimit) || value.invoiceLimit < 1))) throw new Error('Activation does not match this store or contains invalid limits.');
  return value;
}
class LicenseService {
  constructor(database, { publicKey = null, now = Date.now } = {}) {
    this.database = database; this.publicKey = publicKey; this.now = now;
    this.anchorFile = database.databaseFile + '.license-anchor.json';
    database.db.exec('CREATE TABLE IF NOT EXISTS store_licenses(store_id TEXT PRIMARY KEY REFERENCES stores(store_id),payload TEXT NOT NULL CHECK(json_valid(payload)))');
  }
  read() {
    const db = this.database.db;
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='store_licenses'").get()) fail('License data is missing. Contact team; your records remain accessible.');
    const row = db.prepare('SELECT payload FROM store_licenses WHERE store_id=?').get(this.database.storeId);
    if (!row) { if (fs.existsSync(this.anchorFile)) fail('Store license data is missing. Contact team.'); return null; }
    const stored = JSON.parse(row.payload);
    if (typeof stored.installationId !== 'string' || !Number.isSafeInteger(stored.startedAt) || stored.expiresAt !== stored.startedAt + 14 * DAY || !Number.isSafeInteger(stored.issued) || stored.issued < 0 || !Number.isSafeInteger(stored.lastSeen)) fail('Store license data is invalid. Contact team.');
    if (!fs.existsSync(this.anchorFile)) { this.writeAnchor(stored); return stored; }
    let anchor;
    try {
      if (fs.statSync(this.anchorFile).size > 32768) throw new Error('Invalid anchor size.');
      const envelope = JSON.parse(fs.readFileSync(this.anchorFile, 'utf8'));
      if (envelope.format !== 'vj-license-anchor-v1') throw new Error('Invalid anchor format.');
      const iv = Buffer.from(envelope.iv,'base64'), tag = Buffer.from(envelope.tag,'base64');
      if (iv.length !== 12 || tag.length !== 16) throw new Error('Invalid anchor encoding.');
      const decipher = createDecipheriv('aes-256-gcm',this.database.databaseKey,iv);
      decipher.setAAD(Buffer.from('vj-license-anchor-v1'));decipher.setAuthTag(tag);
      anchor = JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext,'base64')),decipher.final()]).toString('utf8'));
    } catch { fail('License protection check failed. Contact team.'); }
    if (anchor.installationId !== stored.installationId || anchor.startedAt !== stored.startedAt || anchor.expiresAt !== stored.expiresAt) fail('This backup belongs to another licensed store. Contact team.');
    if (!Number.isSafeInteger(anchor.issued) || anchor.issued < 0 || !Number.isSafeInteger(anchor.lastSeen) || (anchor.activation !== null && typeof anchor.activation !== 'string')) fail('License protection check failed. Contact team.');
    return { ...stored, ...anchor, issued: Math.max(stored.issued, anchor.issued), lastSeen: Math.max(stored.lastSeen, anchor.lastSeen) };
  }
  writeAnchor(value) {
    const payload = JSON.stringify(value), file = this.anchorFile + '.' + randomUUID() + '.tmp';
    const iv = randomBytes(12),cipher = createCipheriv('aes-256-gcm',this.database.databaseKey,iv);cipher.setAAD(Buffer.from('vj-license-anchor-v1'));
    const ciphertext = Buffer.concat([cipher.update(payload,'utf8'),cipher.final()]);
    try {
      const descriptor = fs.openSync(file, 'wx', 0o600);
      try { fs.writeFileSync(descriptor, JSON.stringify({format:'vj-license-anchor-v1',iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')})); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
      fs.renameSync(file, this.anchorFile);
    } finally { if (fs.existsSync(file)) fs.unlinkSync(file); }
  }
  save(value) {
    this.database.db.prepare('INSERT INTO store_licenses VALUES(?,?) ON CONFLICT(store_id) DO UPDATE SET payload=excluded.payload').run(this.database.storeId, JSON.stringify(value));
    this.writeAnchor(value);
  }
  beginTrial() {
    try { if (this.read()) return this.status(); } catch { return this.status(); }
    const now = this.now();
    const counter = this.database.db.prepare("SELECT payload FROM store_properties WHERE store_id=? AND name='invoice-counter'").get(this.database.storeId);
    const existing = Math.max(Number(counter?.payload || 1) - 1, this.database.db.prepare("SELECT count(*) AS total FROM documents WHERE store_id=? AND collection='invoice-records'").get(this.database.storeId).total);
    if (!Number.isSafeInteger(existing) || existing < 0) fail('Invoice history needs review before license setup. Contact team.');
    this.save({ installationId: randomUUID(), startedAt: now, expiresAt: now + 14 * DAY, lastSeen: now, issued: existing, activation: null });
    return this.status();
  }
  status() {
    let value;
    try { value = this.read(); } catch (error) { return { state: 'blocked', writable: false, message: error.message }; }
    if (!value) return { state: 'not-started', writable: false, trialDays: 14, message: 'Complete basic setup to start your 14-day full-feature trial.' };
    const now = this.now(), clockChanged = now < value.lastSeen - 5 * 60000;
    let activation;
    try { if (value.activation) activation = verifyLicense(value.activation, this.publicKey, value.installationId); }
    catch { return { state: 'blocked', writable: false, installationId: value.installationId, message: 'Paid activation could not be verified. Contact team.' }; }
    if (!clockChanged && now > value.lastSeen + 60000) { value.lastSeen = now; this.save(value); }
    const expiresAt = activation ? activation.expiresAt : value.expiresAt;
    const expired = expiresAt !== null && now >= expiresAt;
    const limited = activation?.invoiceLimit !== null && activation?.invoiceLimit !== undefined && value.issued >= activation.invoiceLimit;
    const writable = !expired && !clockChanged && !limited;
    return { state: clockChanged ? 'clock-check' : expired ? 'expired' : limited ? 'limit-reached' : activation ? 'paid' : 'trial', writable, canCreateInvoice: writable && !limited, installationId: value.installationId, plan: activation?.plan || 'Full-feature trial', startedAt: new Date(value.startedAt).toISOString(), expiresAt: expiresAt === null ? null : new Date(expiresAt).toISOString(), daysRemaining: expiresAt === null ? null : Math.max(0, Math.ceil((expiresAt - now) / DAY)), invoiceLimit: activation?.invoiceLimit ?? null, invoicesIssued: value.issued, activationConfigured: Boolean(this.publicKey), message: clockChanged ? 'Computer clock moved backwards. Correct the date or contact team.' : expired ? 'Your plan has expired. Contact team to activate. Existing records, exports and backups remain accessible.' : limited ? 'Invoice allowance reached. Contact team to upgrade. Existing records and backups remain accessible.' : activation ? 'Paid plan active.' : 'All features available for 14 days. No trial invoice cap.' };
  }
  assertWrite(invoice = false) { const status = this.status(); if (!status.writable || invoice && !status.canCreateInvoice) fail(status.message); }
  issueInvoice(operation, input = {}) {
    // Financial changes and the lifetime invoice counter share one SQL transaction.
    const result = this.database.db.transaction(() => {
      const replay = typeof input.requestId === 'string' && this.database.db.prepare("SELECT 1 FROM documents WHERE store_id=? AND collection='invoice-records' AND json_extract(payload,'$.creationRequestId')=?").get(this.database.storeId, input.requestId);
      if (!replay) this.assertWrite(true);
      const result = operation();
      if (!result.replayed) { this.assertWrite(true); const value = this.read(); if (value.issued >= Number.MAX_SAFE_INTEGER) fail('Invoice allowance counter requires review.'); value.issued++; value.lastSeen = Math.max(value.lastSeen, this.now()); this.database.db.prepare('UPDATE store_licenses SET payload=? WHERE store_id=?').run(JSON.stringify(value), this.database.storeId); }
      return result;
    }).immediate();
    this.writeAnchor(this.read());
    return result;
  }
  preview(token) {
    const value = this.read(); if (!value) fail('Complete basic setup first.');
    const activation = verifyLicense(token, this.publicKey, value.installationId);
    if (activation.expiresAt !== null && activation.expiresAt <= this.now()) throw new Error('This activation has already expired.');
    return { plan: activation.plan, expiresAt: activation.expiresAt === null ? null : new Date(activation.expiresAt).toISOString(), invoiceLimit: activation.invoiceLimit, installationId: value.installationId };
  }
  activate(token) {
    const value = this.read(); if (!value) fail('Complete basic setup first.');
    const activation = verifyLicense(token, this.publicKey, value.installationId);
    if (activation.expiresAt !== null && activation.expiresAt <= this.now()) throw new Error('This activation has already expired.');
    value.activation = token.trim(); value.lastSeen = Math.max(value.lastSeen, this.now()); this.save(value);
    return this.status();
  }
}
module.exports = { LicenseService, verifyLicense, DAY };
