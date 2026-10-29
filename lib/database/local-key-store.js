'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, timingSafeEqual } = require('node:crypto');
const FORMAT = 'vj-local-database-key';

class LocalKeyStore {
  constructor(safeStorage, platform = process.platform) { this.storage = safeStorage; this.platform = platform; }
  assertSecure() {
    if (!['darwin', 'win32'].includes(this.platform) || !this.storage.isEncryptionAvailable()) throw new Error('macOS Keychain or Windows DPAPI secure storage is required. No database key was created or replaced.');
  }
  save(file, suppliedKey) {
    this.assertSecure();
    if (!path.isAbsolute(file) || !Buffer.isBuffer(suppliedKey) || suppliedKey.length !== 32) throw new Error('An absolute key path and 32-byte database key are required.');
    const encrypted = this.storage.encryptString(JSON.stringify({ format: FORMAT, version: 1, key: suppliedKey.toString('base64') }));
    if (!Buffer.isBuffer(encrypted) || !encrypted.length || encrypted.length > 16384) throw new Error('Invalid OS-protected key result.');
    const fd = fs.openSync(file, 'wx', 0o600);
    try { fs.writeFileSync(fd, encrypted); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    const loaded = this.load(file);
    try { if (!timingSafeEqual(loaded, suppliedKey)) throw new Error('OS-protected key verification failed.'); }
    finally { loaded.fill(0); }
  }
  load(file) {
    this.assertSecure();
    if (!path.isAbsolute(file) || fs.lstatSync(file).isSymbolicLink()) throw new Error('An absolute, non-symlink protected key path is required.');
    const fd = fs.openSync(file, 'r');
    let encrypted;
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size < 1 || stat.size > 16384) throw new Error('Invalid protected key file.');
      encrypted = fs.readFileSync(fd);
    } finally { fs.closeSync(fd); }
    try {
      const record = JSON.parse(this.storage.decryptString(encrypted));
      if (!record || record.format !== FORMAT || record.version !== 1 || Object.keys(record).sort().join(',') !== 'format,key,version' || typeof record.key !== 'string') throw new Error('Invalid key metadata.');
      const key = Buffer.from(record.key, 'base64');
      if (key.length !== 32 || key.toString('base64') !== record.key) { key.fill(0); throw new Error('Invalid key.'); }
      return key;
    } catch { throw new Error('Cannot unlock the database key for this OS account. No replacement key was generated; use portable backup recovery.'); }
  }
  verify(directory) {
    this.assertSecure();
    const folder = fs.mkdtempSync(path.join(directory, 'vj-os-key-check-')), key = randomBytes(32);
    try {
      const file = path.join(folder, 'protected.key'); this.save(file, key);
      if (fs.readFileSync(file).includes(Buffer.from(key.toString('base64')))) throw new Error('Secure storage returned an unprotected key.');
      return { verified: true, platform: this.platform, mechanism: this.platform === 'darwin' ? 'Keychain-backed Electron safeStorage' : 'Windows DPAPI-backed Electron safeStorage' };
    } finally { key.fill(0); fs.rmSync(folder, { recursive: true, force: true }); }
  }
}
module.exports = { LocalKeyStore };
