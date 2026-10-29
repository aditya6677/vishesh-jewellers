const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;

function localDevelopmentKey(dataFile) {
  const keyFile = path.join(path.dirname(dataFile), '.data-encryption-key');
  if (fs.existsSync(keyFile)) return fs.readFileSync(keyFile, 'utf8').trim();
  const key = crypto.randomBytes(KEY_BYTES).toString('base64');
  fs.mkdirSync(path.dirname(keyFile), { recursive: true });
  fs.writeFileSync(keyFile, key + '\n', { mode: 0o600 });
  return key;
}

function encryptionKey(dataFile, suppliedKey) {
  const key = Buffer.from(suppliedKey || localDevelopmentKey(dataFile), 'base64');
  if (key.length !== KEY_BYTES) throw new Error('Data encryption key must be a 256-bit base64 value.');
  return key;
}

function isEncrypted(value) {
  return value && value.format === 'vishesh-jewellers-encrypted-v1' && value.algorithm === ALGORITHM;
}

function encrypt(value, key) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: 16 });
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return {
    format: 'vishesh-jewellers-encrypted-v1',
    algorithm: ALGORITHM,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64')
  };
}

function decrypt(value, key) {
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(value.iv, 'base64'), { authTagLength: 16 });
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.ciphertext, 'base64')), decipher.final()]).toString('utf8'));
}

function normalize(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  // Support the original format while data is gradually written in the new shape.
  if (value.values && typeof value.values === 'object') {
    return Object.fromEntries(Object.entries(value.values).map(([key, item]) => {
      try { return [key, JSON.parse(item)]; } catch { return [key, item]; }
    }));
  }
  return value;
}

function createJsonStore(dataFile, options = {}) {
  const key = encryptionKey(dataFile, options.encryptionKey);
  const ensure = () => {
    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    if (!fs.existsSync(dataFile)) write({});
  };

  const readRaw = () => JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  const read = () => {
    ensure();
    try {
      const stored = readRaw();
      if (options.requireEncrypted && !isEncrypted(stored)) throw new Error('Authenticated encryption is required.');
      return normalize(isEncrypted(stored) ? decrypt(stored, key) : stored);
    } catch (error) {
      throw new Error('Stored data could not be read or decrypted. Do not delete store.json; restore its matching app key or a backup.');
    }
  };

  const write = store => {
    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    const tempFile = dataFile + '.tmp';
    fs.writeFileSync(tempFile, JSON.stringify(encrypt(normalize(store), key), null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(tempFile, dataFile);
  };

  const migrate = () => {
    ensure();
    const raw = readRaw();
    if (!isEncrypted(raw)) write(normalize(raw));
  };

  return { ensure, read, write, migrate };
}

module.exports = { createJsonStore };
