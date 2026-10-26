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
  const store = options.store || createJsonStore(config.dataFile, { encryptionKey: config.encryptionKey });
  const desktop = options.desktop || { enabled: Boolean(process.send), send: message => process.send?.(message) };
  const backups = options.backups || new BackupService(config);
  const services = {
    config, logger, store, desktop, backups,
    dashboard: options.dashboard || new DashboardService(store),
    stocks: options.stocks || new StockService(store),
    transactions: options.transactions || new TransactionService(store),
    invoices: options.invoices || new InvoiceService(store),
    rates: options.rates || new MetalRatesService(),
    pages: options.pages || new PageRenderer(config)
  };
  const router = config.backend === 'legacy' ? new Router({ logger }) : new FastifyRouter({ logger });
  [registerStorageRoutes, registerInvoiceRoutes, registerReportRoutes, registerMarketRateRoutes, registerSettingsRoutes, registerDashboardRoutes, registerStockRoutes, registerTransactionRoutes, registerPageRoutes]
    .forEach(register => register(router, services));
  const server = router.app ? router.app.server : http.createServer((req, res) => router.handle(req, res));
  return {
    server,
    config,
    async initialize() {
      if (router.app) await router.app.ready();
      store.migrate();
      if (!desktop.enabled) {
        try { backups.createWeekly(); }
        catch (error) { logger.error('Weekly encrypted backup failed:', error.message); }
      }
    }
  };
}

module.exports = { createApplication };
