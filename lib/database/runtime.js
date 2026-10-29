'use strict';
const { openDatabase } = require('./database');
const { readExistingKey } = require('./read-encrypted-snapshot');
const { readSnapshot } = require('./snapshot-migration');
const { DatabaseQueries } = require('./queries');
const { StockRepository } = require('./stock-repository');
const { InvoiceRepository } = require('./invoice-repository');
const { TransactionRepository } = require('./transaction-repository');
const { ReportRunner } = require('./report-runner');
const { recoverInterruptedRestore, beginRestore, completeRestore, restorePaths, syncDirectory } = require('./restore-files');
const { createDatabaseBackup, validateBackup } = require('./backup');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
class DatabaseRuntime {
  constructor(config) {
    let key;
    try {
      key = config.databaseKeyFile ? readExistingKey(config.databaseKeyFile) : Buffer.from(config.databaseKey || '', 'base64');
      this.releaseLock = require('./process-lock').acquireDatabaseLock(config.databaseFile);
      recoverInterruptedRestore(config.databaseFile, key);
      this.db = openDatabase(config.databaseFile, key);
      this.databaseKey = Buffer.from(key); this.databaseFile = config.databaseFile;
      if (!this.db.prepare('SELECT 1 FROM stores WHERE store_id=?').get(config.storeId)) throw new Error('Configured store was not imported.');
      this.storeId = config.storeId; this.query = new DatabaseQueries(this.db, this.storeId);
      this.stockRepository = new StockRepository(this.db, this.storeId);
      this.invoiceRepository = new InvoiceRepository(this.db, this.storeId);
      this.transactionRepository = new TransactionRepository(this.db, this.storeId);
    } catch (error) { if (this.db?.open) this.db.close(); this.databaseKey?.fill(0); this.releaseLock?.(); throw error; }
    finally { key?.fill(0); }
    this.readers = new Set();
    const refresh = result => ({ ...this.query.stockList(), refreshRequired: true, affected: result.item ? [result.item] : [] });
    this.stocks = { list: options => this.query.stockList(options), get: id => this.stockRepository.get(id), create: input => refresh(this.stockRepository.create(input)), mutate: (id, input, operation) => refresh(this.stockRepository.mutate(id, input, operation)) };
    this.records = { list: filters => this.query.recordList(filters), get: (number, version) => this.invoiceRepository.get(number, version), settle: (number, input) => this.invoiceRepository.settle(number, input) };
    this.transactions = { list: (kind, options) => this.query.transactionList(kind, options), save: (kind, input, id, deleting) => { this.transactionRepository.save(kind, input, id, deleting); return { ...this.query.transactionList(kind), refreshRequired: true }; } };
    this.invoices = Object.fromEntries(['create', 'edit', 'void', 'delete', 'get', 'settle'].map(name => [name, (...args) => { this.assertAvailable(); return this.invoiceRepository[name](...args); }]));
    this.reports = new ReportRunner(this.databaseFile, this.databaseKey, this.storeId);
    this.dashboard = { snapshot: range => this.reports.snapshot(range) };
    this.store = {
      migrate: () => {},
      isPartial: name => this.db.prepare('SELECT is_collection FROM store_properties WHERE store_id=? AND name=?').get(this.storeId, name)?.is_collection === 1,
      read: () => this.db.transaction(() => readSnapshot(this.db, this.storeId))(),
      getValue: name => {
        const property = this.db.prepare('SELECT * FROM store_properties WHERE store_id=? AND name=?').get(this.storeId, name);
        if (!property) return undefined;
        return property.is_collection ? this.db.prepare('SELECT payload FROM documents WHERE store_id=? AND collection=? ORDER BY ordinal LIMIT 100').all(this.storeId, name).map(row => JSON.parse(row.payload)) : JSON.parse(property.payload);
      },
      setValue: (name, value) => {
        this.assertAvailable();
        if (!['business-info', 'items-master'].includes(name)) throw new Error('Use the dedicated transaction API; direct financial storage writes are disabled in database mode.');
        this.db.transaction(() => {
          this.invoiceRepository.ensureProperty(name, false, JSON.stringify(value));
          this.db.prepare('UPDATE store_properties SET payload=? WHERE store_id=? AND name=?').run(JSON.stringify(value), this.storeId, name);
          this.db.prepare('UPDATE store_revisions SET revision=revision+1 WHERE store_id=?').run(this.storeId);
        }).immediate();
      },
      write: () => { throw new Error('Whole-store writes are disabled in database mode.'); }
    };
    this.backups = new (require('./backup-service').DatabaseBackupService)(this.db, this.databaseKey, config);
    this.backups.runtime = this;
    for (const service of [this.stocks, this.records, this.transactions]) for (const name of Object.keys(service)) {
      const operation = service[name]; service[name] = (...args) => { this.assertAvailable(); return operation(...args); };
    }
  }
  assertAvailable() { if (this.failed || this.maintenance || this.stopping) throw Object.assign(new Error('Database is unavailable or recovery is in progress. Please wait or restart the app.'), { statusCode: 503 }); }
  revision() { return this.db.prepare('SELECT revision FROM store_revisions WHERE store_id=?').get(this.storeId).revision; }
  openReader() {
    this.assertAvailable();
    const reader = openDatabase(this.databaseFile, this.databaseKey, { readonly: true });
    this.readers.add(reader);
    const close = reader.close.bind(reader);
    reader.close = () => { this.readers.delete(reader); return close(); };
    return reader;
  }
  rebind() {
    this.db = openDatabase(this.databaseFile, this.databaseKey);
    this.query = new DatabaseQueries(this.db, this.storeId);
    this.stockRepository = new StockRepository(this.db, this.storeId);
    this.invoiceRepository = new InvoiceRepository(this.db, this.storeId);
    this.transactionRepository = new TransactionRepository(this.db, this.storeId);
    this.reports = new ReportRunner(this.databaseFile, this.databaseKey, this.storeId);
    this.backups.db = this.db;
  }
  async activateRecovery(id, revision) {
    this.assertAvailable();
    if (revision !== this.revision()) throw Object.assign(new Error('Data changed after recovery was prepared. Prepare the backup again before restoring.'), { statusCode: 409 });
    for (const reader of this.readers) { if (reader.open) throw Object.assign(new Error('An export is still running. Finish it before restoring.'), { statusCode: 409 }); this.readers.delete(reader); }
    const paths = restorePaths(this.databaseFile, id);
    validateBackup(paths.candidate, this.databaseKey);
    this.maintenance = true;
    let journalStarted = false;
    try {
      await this.reports.close();
      const safety = path.join(this.backups.directory, 'before-restore-' + id + '.db');
      createDatabaseBackup(this.db, this.databaseKey, safety);
      const checkpoint = this.db.pragma('wal_checkpoint(TRUNCATE)')[0];
      if (checkpoint.busy || checkpoint.log > 0) throw new Error('Database is busy; restoration was not started.');
      this.db.close();
      if (fs.existsSync(this.databaseFile + '-wal') && fs.statSync(this.databaseFile + '-wal').size) throw new Error('Database journal is still active. Restoration was not started.');
      beginRestore(this.databaseFile, id, this.databaseKey); journalStarted = true;
      fs.renameSync(this.databaseFile, paths.previous); syncDirectory(this.databaseFile);
      fs.renameSync(paths.candidate, this.databaseFile); syncDirectory(this.databaseFile);
      validateBackup(this.databaseFile, this.databaseKey);
      this.rebind();
      completeRestore(this.databaseFile, id); journalStarted = false;
      return { ok: true, restored: true, safety, previous: paths.previous };
    } catch (error) {
      try {
        await this.reports.close();
        if (journalStarted) {
          if (this.db.open) this.db.close();
          recoverInterruptedRestore(this.databaseFile, this.databaseKey);
        }
        if (!this.db.open) this.rebind();
        else this.reports = new ReportRunner(this.databaseFile, this.databaseKey, this.storeId);
      } catch { this.failed = true; throw new Error('Restore could not finish and automatic rollback requires attention. Keep all database and recovery files; do not delete them.'); }
      throw error;
    } finally { this.maintenance = false; }
  }
  close() {
    if (!this.stopping) { this.backups.discardPrepared(); this.stopping = this.reports.close().finally(() => this.releaseLock?.()); if (this.db.open) this.db.close(); this.databaseKey.fill(0); }
    return this.stopping;
  }
}
module.exports = { DatabaseRuntime };
