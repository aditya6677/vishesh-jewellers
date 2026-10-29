'use strict';

const { randomBytes, scrypt, createCipheriv, createDecipheriv, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const derive = promisify(scrypt);
const FORMAT = 'vj-db-key-recovery';
const AAD = Buffer.from(FORMAT + ':1:scrypt-65536-8-1:aes-256-gcm');

function checkPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password) > 1024) throw new Error('Use a separate recovery passphrase of at least 12 characters (maximum 1024 bytes), not your app PIN.');
}
function checkDigest(digest) {
  if (!Buffer.isBuffer(digest) || digest.length !== 32) throw new Error('A SHA-256 backup digest is required.');
}
function decode(value, size) {
  if (typeof value !== 'string') throw new Error('Invalid recovery file.');
  const result = Buffer.from(value, 'base64');
  if (result.length !== size || result.toString('base64') !== value) throw new Error('Invalid recovery file.');
  return result;
}
function deriveKey(password, salt) {
  // Fixed parameters: imported files cannot request arbitrary CPU/memory usage.
  return derive(password, salt, 32, { N: 65536, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
}

async function protectRecoveryKey(databaseKey, password, backupDigest) {
  checkPassword(password); checkDigest(backupDigest);
  if (!Buffer.isBuffer(databaseKey) || databaseKey.length !== 32) throw new Error('A 32-byte database key is required.');
  const salt = randomBytes(16), iv = randomBytes(12);
  const payload = Buffer.concat([databaseKey, backupDigest]);
  let wrappingKey;
  try {
    wrappingKey = await deriveKey(password, salt);
    const cipher = createCipheriv('aes-256-gcm', wrappingKey, iv);
    cipher.setAAD(AAD);
    const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
    return JSON.stringify({ format: FORMAT, version: 1, salt: salt.toString('base64'), iv: iv.toString('base64'), ciphertext: ciphertext.toString('base64'), tag: cipher.getAuthTag().toString('base64') });
  } finally { payload.fill(0); wrappingKey?.fill(0); }
}

async function recoverDatabaseKey(serialized, password, backupDigest) {
  checkPassword(password); checkDigest(backupDigest);
  if (typeof serialized !== 'string' || Buffer.byteLength(serialized) > 4096) throw new Error('Invalid recovery file.');
  let record;
  try { record = JSON.parse(serialized); } catch { throw new Error('Invalid recovery file.'); }
  if (!record || Array.isArray(record) || record.format !== FORMAT || record.version !== 1 || Object.keys(record).sort().join(',') !== 'ciphertext,format,iv,salt,tag,version') throw new Error('Unsupported or invalid recovery file.');
  const salt = decode(record.salt, 16), iv = decode(record.iv, 12);
  const ciphertext = decode(record.ciphertext, 64), tag = decode(record.tag, 16);
  const wrappingKey = await deriveKey(password, salt);
  let partial, payload;
  try {
    const decipher = createDecipheriv('aes-256-gcm', wrappingKey, iv);
    decipher.setAAD(AAD); decipher.setAuthTag(tag);
    partial = decipher.update(ciphertext);
    payload = Buffer.concat([partial, decipher.final()]);
    if (!timingSafeEqual(payload.subarray(32), backupDigest)) throw new Error('Backup mismatch.');
    return Buffer.from(payload.subarray(0, 32));
  } catch { throw new Error('Recovery failed: wrong passphrase, damaged recovery file or different backup.'); }
  finally { partial?.fill(0); payload?.fill(0); wrappingKey.fill(0); }
}

module.exports = { protectRecoveryKey, recoverDatabaseKey, checkPassword };
