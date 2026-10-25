'use strict';

const { createApplication } = require('./lib/app');
const { DesktopMessage } = require('./lib/domain/constants');

async function startServer() {
  const app = createApplication();
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

if (require.main === module) startServer().catch(error => { console.error('Could not start the app:', error); process.exitCode = 1; });

module.exports = { startServer };
