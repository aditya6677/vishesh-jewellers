'use strict';

const http = require('node:http');
const { createConfig } = require('./config');
const { createJsonStore } = require('./json-store');
const { Router } = require('./http/router');
const { FastifyRouter } = require('./http/fastify-router');
const { BackupService } = require('./services/backup-service');
const { InvoiceService } = require('./services/invoice-service');
const { MetalRatesService } = require('./services/metal-rates-service');
const { PageRenderer } = require('./ui/page-renderer');
const { DashboardService } = require('./services/dashboard-service');
const { registerDashboardRoutes } = require('./routes/dashboard');
const { StockService } = require('./services/stock-service');
const { registerStockRoutes } = require('./routes/stocks');
const { RecordService } = require('./services/record-service');
const { registerRecordRoutes } = require('./routes/records');
const { TransactionService } = require('./services/transaction-service');
const { registerTransactionRoutes } = require('./routes/transactions');
const { registerStorageRoutes } = require('./routes/storage');
const { registerInvoiceRoutes } = require('./routes/invoices');
const { registerReportRoutes } = require('./routes/reports');
const { registerMarketRateRoutes } = require('./routes/market-rates');
const { registerSettingsRoutes } = require('./routes/settings');
const { registerPageRoutes } = require('./routes/pages');

// Composition root: dependencies are created here, then injected into routes.
// Importing this module never migrates data, makes backups, or opens a port.
function createApplication(options = {}) {
  const config = options.config || createConfig();
  const logger = options.logger || console;
  const desktop = options.desktop || { enabled: Boolean(process.send), send: message => process.send?.(message) };
  if (config.dataBackend === 'sqlite' && desktop.enabled && config.databaseKeySource !== 'os-protected-ipc') throw new Error('SQLite desktop activation requires a verified OS-protected key from the desktop launcher.');
  const database = config.dataBackend === 'sqlite' && !options.store ? new (require('./database/runtime').DatabaseRuntime)(config) : null;
  const store = options.store || database?.store || createJsonStore(config.dataFile, { encryptionKey: config.encryptionKey });
  const backups = options.backups || database?.backups || new BackupService(config);
  let license;
  if (config.licensingEnabled) {
    if (!database || !config.accountsEnabled) throw new Error('Trial licensing requires encrypted SQLite and username/password setup.');
    const fs = require('node:fs');
    license = new (require('./services/license-service').LicenseService)(database, { publicKey: fs.existsSync(config.licensePublicKeyFile) ? fs.readFileSync(config.licensePublicKeyFile, 'utf8') : null, now: options.licenseClock || Date.now });
    const create = database.invoices.create;
    database.invoices.create = (...args) => license.issueInvoice(() => create(...args), args[0]);
    for (const [service, names] of [[database.invoices, ['edit','void','delete','settle']], [database.stocks,['create','mutate']], [database.records,['settle']], [database.transactions,['save']], [database.store,['setValue']]]) for (const name of names) {
      const operation = service[name]; service[name] = (...args) => { license.assertWrite(); return operation(...args); };
    }
  }
  const services = {
    config, logger, store, desktop, backups,
    database,
    license,
    branding: new (require('./services/branding-service').BrandingService)(store),
    dashboard: options.dashboard || database?.dashboard || new DashboardService(store),
    stocks: options.stocks || database?.stocks || new StockService(store),
    records: options.records || database?.records || new RecordService(store),
    transactions: options.transactions || database?.transactions || new TransactionService(store),
    invoices: options.invoices || database?.invoices || new InvoiceService(store),
    rates: options.rates || new MetalRatesService(),
    pages: options.pages || new PageRenderer(config)
  };
  const router = config.backend === 'legacy' ? new Router({ logger }) : new FastifyRouter({ logger });
  if (database) {
    const add = router.add.bind(router);
    router.add = (method, pattern, handler) => add(method, pattern, context => { database.assertAvailable(); return handler(context); });
  }
  const accounts = config.accountsEnabled ? require('./security/http-accounts').installAccounts(router, services) : null;
  [require('./routes/branding').registerBrandingRoutes, registerStorageRoutes, registerInvoiceRoutes, registerReportRoutes, registerMarketRateRoutes, registerSettingsRoutes, registerDashboardRoutes, registerStockRoutes, registerTransactionRoutes, registerRecordRoutes, registerPageRoutes]
    .forEach(register => register(router, services));
  const server = router.app ? router.app.server : http.createServer((req, res) => router.handle(req, res));
  if (database) server.once('close', () => database.close());
  if (accounts) server.once('close', () => { void accounts.close(); });
  let backupTimer;
  return {
    server,
    config,
    async close() {
      clearInterval(backupTimer);
      await accounts?.close();
      if (router.app) await router.app.close();
      else if (server.listening) await new Promise(resolve => server.close(resolve));
      await database?.close();
    },
    async initialize() {
      try { await accounts?.ready; if (router.app) await router.app.ready(); store.migrate(); }
      catch (error) { await accounts?.close(); await database?.close(); throw error; }
      if (!desktop.enabled || database) {
        try { backups.createWeekly(); }
        catch (error) { logger.error('Weekly encrypted backup failed:', error.message); }
        if (database) {
          backupTimer = setInterval(() => {
            try { backups.createWeekly(); }
            catch (error) { logger.error('Weekly encrypted backup failed:', error.message); }
          }, 24 * 60 * 60 * 1000);
          backupTimer.unref();
          server.once('close', () => clearInterval(backupTimer));
        }
      }
    }
  };
}

module.exports = { createApplication };
