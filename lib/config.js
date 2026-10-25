'use strict';

const path = require('node:path');
const os = require('node:os');

function createConfig(env = process.env, root = path.resolve(__dirname, '..')) {
  const dataDir = env.DATA_DIR || path.join(root, 'data');
  return Object.freeze({
    root,
    backend: env.BACKEND_MODE === 'legacy' ? 'legacy' : 'fastify',
    // Electron requests an ephemeral port; the browser app retains port 3000.
    port: env.PORT === '0' ? 0 : 3000,
    host: env.HOST || '127.0.0.1',
    sourceHtml: env.SOURCE_HTML || path.join(root, 'source', 'index.html'),
    dataDir,
    dataFile: path.join(dataDir, 'store.json'),
    backupDir: env.BACKUP_DIR || path.join(os.homedir(), 'Documents', 'Vishesh Jewellers Backups'),
    encryptionKey: env.DATA_ENCRYPTION_KEY,
    serverVersion: String(Date.now())
  });
}

module.exports = { createConfig };
