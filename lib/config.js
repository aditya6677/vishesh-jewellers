'use strict';

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

function createConfig(env = process.env, root = path.resolve(__dirname, '..')) {
  const dataDir = env.DATA_DIR || path.join(root, 'data');
  const dataBackend = env.DATA_BACKEND || 'json';
  if (!['json', 'sqlite'].includes(dataBackend)) throw new Error('DATA_BACKEND must be json or sqlite.');
  if (dataBackend === 'sqlite' && (!env.DATABASE_FILE || !path.isAbsolute(env.DATABASE_FILE) || (!env.DATABASE_KEY && !env.DATABASE_KEY_FILE))) throw new Error('SQLite requires an explicit DATABASE_FILE and existing database key.');
  return Object.freeze({
    root,
    dataBackend,
    databaseFile: env.DATABASE_FILE,
    databaseKey: env.DATABASE_KEY,
    databaseKeyFile: env.DATABASE_KEY_FILE,
    storeId: env.STORE_ID || 'main',
    accountsEnabled: env.ACCOUNTS_ENABLED === '1' || (dataBackend === 'sqlite' && fs.existsSync(env.DATABASE_FILE + '.accounts-enabled')),
    licensingEnabled: env.LICENSING_ENABLED === '1' || (dataBackend === 'sqlite' && fs.existsSync(env.DATABASE_FILE + '.license-anchor.json')),
    licensePublicKeyFile: path.join(root, 'assets', 'license-public-key.pem'),
    backend: env.BACKEND_MODE === 'legacy' ? 'legacy' : 'fastify',
    // Electron requests an ephemeral port; the browser app retains port 3000.
    port: env.PORT === '0' ? 0 : 3000,
    host: env.HOST || '127.0.0.1',
    sourceHtml: env.SOURCE_HTML || path.join(root, 'source', 'index.html'),
    dataDir,
    dataFile: path.join(dataDir, 'store.json'),
    backupDir: env.BACKUP_DIR || (dataBackend === 'sqlite' ? path.join(path.dirname(env.DATABASE_FILE), 'backups') : path.join(os.homedir(), 'Documents', 'Vishesh Jewellers Backups')),
    encryptionKey: env.DATA_ENCRYPTION_KEY,
    serverVersion: String(Date.now())
  });
}

module.exports = { createConfig };
