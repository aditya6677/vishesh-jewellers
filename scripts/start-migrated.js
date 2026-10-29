'use strict';
// Explicit local cutover. Default JSON startup remains available for rollback.
const fs = require('node:fs');
const path = require('node:path');
const { createApplication } = require('../lib/app');
const { createConfig } = require('../lib/config');
const root = path.resolve(__dirname, '..');
let application;
async function main() {
  const active = JSON.parse(fs.readFileSync(path.join(root, 'data/database-active.json'), 'utf8'));
  if (active.version !== 1 || !path.isAbsolute(active.databaseFile || '') || !path.isAbsolute(active.keyFile || '') || typeof active.storeId !== 'string') throw new Error('Invalid local database activation settings.');
  const config = createConfig({ ...process.env, DATA_BACKEND: 'sqlite', DATABASE_FILE: active.databaseFile, DATABASE_KEY: undefined, DATABASE_KEY_FILE: active.keyFile, STORE_ID: active.storeId, ACCOUNTS_ENABLED: active.accountsEnabled ? '1' : process.env.ACCOUNTS_ENABLED, LICENSING_ENABLED: active.licensingEnabled ? '1' : process.env.LICENSING_ENABLED });
  application = createApplication({ config });
  await application.initialize();
  const port = process.env.LOCAL_DATABASE_PORT ? Number(process.env.LOCAL_DATABASE_PORT) : config.port;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid local database port.');
  await new Promise((resolve, reject) => { application.server.once('error', reject); application.server.listen(port, '127.0.0.1', resolve); });
  console.log(`Encrypted database app: http://127.0.0.1:${port}/`);
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await application?.close(); process.exit(0); });
main().catch(async error => { console.error('Database startup failed:', error.message); await application?.close(); process.exitCode = 1; });
