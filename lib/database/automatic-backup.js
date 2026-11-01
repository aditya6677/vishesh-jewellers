'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, randomUUID, createCipheriv, createDecipheriv } = require('node:crypto');
const { checkPassword, deriveKey, sealRecoveryKey } = require('./key-recovery');
const { createPortableBackup } = require('./portable-backup');
const AAD = Buffer.from('karatdesk-automatic-backup-v1');

// The recovery-derived key is encrypted by the active database key, which the
// desktop stores using Keychain/DPAPI. Neither the passphrase nor plaintext keys
// are persisted. Each portable bundle still uses the existing v1 recovery format.
class AutomaticBackup {
  constructor(databaseFile, key) { this.file = databaseFile + '.automatic-backup.json'; this.key = key; }
  read() {
    if (!fs.existsSync(this.file)) return null;
    if (fs.lstatSync(this.file).isSymbolicLink() || fs.statSync(this.file).size > 8192) throw new Error('Invalid automatic backup configuration.');
    const record = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    if (record.version !== 1) throw new Error('Unsupported automatic backup configuration.');
    return record;
  }
  write(record) {
    const temporary = this.file + '.' + randomUUID() + '.tmp';
    try {
      const fd = fs.openSync(temporary, 'wx', 0o600);
      try { fs.writeFileSync(fd, JSON.stringify(record)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(temporary, this.file);
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  async configure(passphrase, confirmation) {
    checkPassword(passphrase);
    if (passphrase !== confirmation) throw new Error('Recovery passphrases do not match.');
    const salt = randomBytes(16), wrappingKey = await deriveKey(passphrase, salt), iv = randomBytes(12);
    try {
      const cipher = createCipheriv('aes-256-gcm', this.key, iv); cipher.setAAD(Buffer.concat([AAD, salt]));
      const ciphertext = Buffer.concat([cipher.update(wrappingKey), cipher.final()]);
      this.write({ version: 1, salt: salt.toString('base64'), iv: iv.toString('base64'), ciphertext: ciphertext.toString('base64'), tag: cipher.getAuthTag().toString('base64'), lastSuccess: null, lastError: null });
    } finally { wrappingKey.fill(0); }
  }
  status() {
    try {
      const record = this.read();
      return { enabled: !!record, lastSuccess: record?.lastSuccess || null, lastError: record?.lastError || null, nextDue: record?.lastSuccess ? new Date(Date.parse(record.lastSuccess) + 86400000).toISOString() : null };
    } catch { return { enabled: false, lastSuccess: null, nextDue: null, lastError: 'Automatic backup configuration could not be read. Set up recovery again; existing backups are unchanged.' }; }
  }
  async run(db, directory, now) {
    const record = this.read();
    if (!record) return;
    if (record.lastSuccess && now.getTime() - Date.parse(record.lastSuccess) < 86400000) return;
    let wrappingKey;
    try {
      const decode = (name, size) => { const value = Buffer.from(record[name], 'base64'); if (value.length !== size) throw new Error('Invalid automatic recovery key.'); return value; };
      const salt = decode('salt', 16);
      const decipher = createDecipheriv('aes-256-gcm', this.key, decode('iv', 12)); decipher.setAAD(Buffer.concat([AAD, salt])); decipher.setAuthTag(decode('tag', 16));
      wrappingKey = Buffer.concat([decipher.update(decode('ciphertext', 32)), decipher.final()]);
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      const destination = path.join(directory, 'portable-' + randomUUID());
      const result = await createPortableBackup(db, this.key, undefined, destination, digest => sealRecoveryKey(this.key, wrappingKey, salt, digest));
      this.write({ ...record, lastSuccess: now.toISOString(), lastError: null });
      return result;
    } catch (error) {
      this.write({ ...record, lastError: 'Automatic backup failed: ' + error.message });
      throw error;
    } finally { wrappingKey?.fill(0); }
  }
}
module.exports = { AutomaticBackup };
