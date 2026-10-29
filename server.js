'use strict';

const { createApplication } = require('./lib/app');
const { DesktopMessage } = require('./lib/domain/constants');
const { createConfig } = require('./lib/config');

async function startServer(options = {}) {
  const app = createApplication(options);
  await app.initialize();
  app.server.listen(app.config.port, app.config.host, () => {
    const address = app.server.address();
    const activePort = typeof address === 'object' && address ? address.port : app.config.port;
    const url = `http://${app.config.host}:${activePort}`;
    console.log(`Vishesh Jewellers app: ${url}`);
    if (process.send) process.send({ type: DesktopMessage.READY, url });
  });
  return app.server;
}

if (require.main === module) {
  const failed = error => { console.error('Could not start the app:', error.message); process.exitCode = 1; if (process.env.VJ_DATABASE_KEY_IPC === '1' && process.connected) process.disconnect(); };
  if (process.env.VJ_DATABASE_KEY_IPC === '1') {
    const timeout = setTimeout(() => { console.error('Protected database key was not received.'); process.exit(1); }, 10000);
    process.once('message', async message => {
      clearTimeout(timeout);
      try {
        if (message?.type !== 'protected-database-key' || !Buffer.isBuffer(message.key) || message.key.length !== 32 || !process.send) throw new Error('Invalid protected database bootstrap.');
        const config = Object.freeze({ ...createConfig({ ...process.env, DATA_BACKEND: 'sqlite', DATABASE_KEY: message.key, DATABASE_KEY_FILE: undefined }), databaseKeySource: 'os-protected-ipc' });
        await startServer({ config });
      } catch (error) { failed(error); }
      finally { message?.key?.fill?.(0); }
    });
  } else startServer().catch(failed);
}

module.exports = { startServer };
