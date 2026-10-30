'use strict';
const fs = require('node:fs');
const { decryptSnapshotBytes } = require('./database/read-encrypted-snapshot');
const read = (file, maximum) => { const size = fs.statSync(file).size; if (size < 1 || size > maximum) throw new Error('Legacy file exceeds the supported size limit.'); return fs.readFileSync(file); };
async function readLegacySource({ parent, dialog, safeStorage, keyFile }) {
  const chosen = await dialog.showOpenDialog(parent, { title: 'Select older encrypted JSON or backup', properties: ['openFile'], filters: [{ name: 'Encrypted legacy data', extensions: ['json'] }] });
  if (chosen.canceled) return null;
  const input = JSON.parse(read(chosen.filePaths[0], 24_000_000));
  const envelope = input.encryptedStore || input;
  if (envelope.format !== 'vishesh-jewellers-encrypted-v1') throw new Error('Select an encrypted older-app JSON file. Original files are never modified.');
  let key;
  try {
    try {
      if (input.keyEnvelope) key = Buffer.from(safeStorage.decryptString(Buffer.from(input.keyEnvelope, 'base64')), 'base64');
      else if (fs.existsSync(keyFile)) key = Buffer.from(safeStorage.decryptString(Buffer.from(read(keyFile, 8192).toString('utf8').trim(), 'base64')), 'base64');
      if (key?.length === 32) return decryptSnapshotBytes(Buffer.from(JSON.stringify(envelope)), key).snapshot;
    } catch { /* Ask for the original matching key rather than generating one. */ }
    key?.fill(0);
    const selected = await dialog.showOpenDialog(parent, { title: 'Select the original data-key.bin or .data-encryption-key', properties: ['openFile', 'showHiddenFiles'] });
    if (selected.canceled) return null;
    const encoded = read(selected.filePaths[0], 8192).toString('utf8').trim();
    key = /\.bin$/i.test(selected.filePaths[0]) ? Buffer.from(safeStorage.decryptString(Buffer.from(encoded, 'base64')), 'base64') : Buffer.from(encoded, 'base64');
    return decryptSnapshotBytes(Buffer.from(JSON.stringify(envelope)), key).snapshot;
  } catch { throw new Error('Unable to decrypt the old data. Use the original computer and OS account with its matching key. Do not uninstall the old app or delete its files.'); }
  finally { key?.fill(0); }
}
module.exports = { readLegacySource };
