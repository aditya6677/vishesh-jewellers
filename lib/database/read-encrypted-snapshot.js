'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createDecipheriv, createHash } = require('node:crypto');

function readBounded(file, maximum) {
  if (!path.isAbsolute(file)) throw new Error('An absolute existing file is required.');
  const fd = fs.openSync(file, 'r');
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size < 1 || stat.size > maximum) throw new Error('Invalid snapshot/key file size.');
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!count) throw new Error('File changed during read.');
      offset += count;
    }
    const after = fs.fstatSync(fd);
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw new Error('File changed during read.');
    return bytes;
  } finally { fs.closeSync(fd); }
}

function base64(value, length) {
  if (typeof value !== 'string') throw new Error('Invalid encrypted snapshot encoding.');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value || (length !== undefined && bytes.length !== length)) throw new Error('Invalid encrypted snapshot encoding.');
  return bytes;
}

function readExistingKey(file) {
  const bytes = readBounded(file, 1024);
  try { return base64(bytes.toString('utf8').trim(), 32); } finally { bytes.fill(0); }
}

function readEncryptedSnapshot(file, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('An existing 32-byte key is required.');
  const bytes = readBounded(file, 64 * 1024 * 1024);
  let plaintext, partial;
  try {
    const envelope = JSON.parse(bytes.toString('utf8'));
    if (envelope?.format !== 'vishesh-jewellers-encrypted-v1' || envelope.algorithm !== 'aes-256-gcm') throw new Error('Encrypted snapshot required; plaintext conversion is not enabled.');
    const decipher = createDecipheriv('aes-256-gcm', key, base64(envelope.iv, 12), { authTagLength: 16 });
    decipher.setAuthTag(base64(envelope.tag, 16));
    partial = decipher.update(base64(envelope.ciphertext));
    plaintext = Buffer.concat([partial, decipher.final()]);
    let snapshot = JSON.parse(plaintext.toString('utf8'));
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new Error('Invalid snapshot root.');
    if (snapshot.values && typeof snapshot.values === 'object' && !Array.isArray(snapshot.values)) {
      snapshot = Object.fromEntries(Object.entries(snapshot.values).map(([name, value]) => {
        if (typeof value !== 'string') return [name, value];
        try { return [name, JSON.parse(value)]; } catch { return [name, value]; }
      }));
    }
    return { snapshot, sourceSha256: createHash('sha256').update(bytes).digest('hex') };
  } finally { plaintext?.fill(0); partial?.fill(0); }
}

module.exports = { readExistingKey, readEncryptedSnapshot };
