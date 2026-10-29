'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { isoWeekStamp } = require('../services/backup-service');
const { createDatabaseBackup, validateBackup } = require('./backup');
const { createPortableBackup, restorePortableBackup } = require('./portable-backup');

class DatabaseBackupService {
  constructor(db, key, config, { now = () => new Date() } = {}) {
    this.db = db; this.key = key; this.now = now; this.busy = false; this.prepared = null;
    this.requireAccounts = config.accountsEnabled;
    this.requireLicense = config.licensingEnabled;
    this.storeId = config.storeId;
    const identity = createHash('sha256').update(config.databaseFile).digest('hex').slice(0, 16);
    this.identity = identity;
    this.locationFile = config.databaseFile + '.backup-location.json';
    this.root = config.backupDir;
    if (fs.existsSync(this.locationFile)) {
      const saved = JSON.parse(fs.readFileSync(this.locationFile, 'utf8'));
      if (saved.version !== 1 || !path.isAbsolute(saved.root || '')) throw new Error('Invalid saved backup location.');
      this.root = saved.root;
    }
    this.directory = path.join(this.root, 'SQLite-' + identity);
  }
  async changeLocation(root) {
    return this.exclusive(async () => {
      if (this.prepared) throw new Error('Finish or cancel the prepared restoration before changing the backup folder.');
      if (typeof root !== 'string' || !path.isAbsolute(root) || root.length > 4096) throw new Error('Enter the full absolute path of an existing backup folder.');
      const canonical = fs.realpathSync(root);
      if (!fs.statSync(canonical).isDirectory() || canonical === path.parse(canonical).root) throw new Error('Choose a dedicated backup folder, not a drive root.');
      const destination = path.join(canonical, 'SQLite-' + this.identity);
      fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
      if (fs.lstatSync(destination).isSymbolicLink()) throw new Error('Backup location must not be a symbolic link.');
      const probe = path.join(destination, '.write-check-' + randomUUID());
      let fd;
      try { fd = fs.openSync(probe, 'wx', 0o600); fs.fsyncSync(fd); }
      finally { if (fd !== undefined) { fs.closeSync(fd); fs.unlinkSync(probe); } }
      const temporary = this.locationFile + '.' + randomUUID() + '.tmp';
      try {
        const descriptor = fs.openSync(temporary, 'wx', 0o600);
        try { fs.writeFileSync(descriptor, JSON.stringify({ version: 1, root: canonical })); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
        fs.renameSync(temporary, this.locationFile);
      } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
      const previous = this.directory;
      this.root = canonical; this.directory = destination;
      return { ok: true, path: destination, previous, message: 'Future backups will use the new folder. Existing backups were not moved or deleted.' };
    });
  }
  latest() { return this.status().backups[0]?.name || null; }
  status() {
    const names = fs.existsSync(this.directory) ? fs.readdirSync(this.directory) : [];
    const backups = names.filter(name => /^(portable-[a-f0-9-]{36}|weekly-\d{4}-\d{2}\.db)$/.test(name)).flatMap(name => {
      const file = path.join(this.directory, name), stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) return [];
      const portable = name.startsWith('portable-');
      if (portable ? !stat.isDirectory() || !fs.existsSync(path.join(file, 'manifest.json')) : !stat.isFile()) return [];
      return [{ name, portable, createdAt: stat.mtime.toISOString() }];
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50);
    return { backend: 'sqlite', directory: this.directory, backupRoot: this.root, backups, weekly: 'same-key', recovery: this.runtime ? 'prepare-confirm-restore' : 'verify-only' };
  }
  createWeekly() {
    if (this.busy) return;
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const file = path.join(this.directory, 'weekly-' + isoWeekStamp(this.now()) + '.db');
    if (fs.existsSync(file)) { validateBackup(file, this.key); return; }
    return createDatabaseBackup(this.db, this.key, file);
  }
  async createPortable(passphrase) {
    return this.exclusive(async () => {
      fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
      const result = await createPortableBackup(this.db, this.key, passphrase, path.join(this.directory, 'portable-' + randomUUID()));
      return { ok: true, path: result.path, verified: result.verified };
    });
  }
  async verifyPortable(name, passphrase) {
    return this.exclusive(async () => {
      const source = this.source(name);
      const temporary = fs.mkdtempSync(path.join(this.directory, '.verify-'));
      let result;
      try {
        result = await restorePortableBackup(source, passphrase, path.join(temporary, 'candidate.db'));
        return { ok: true, verified: true, stores: result.stores.length, message: 'Recovery verified. Your current data has not been replaced.' };
      } finally {
        result?.key.fill(0);
        fs.rmSync(temporary, { recursive: true, force: true });
      }
    });
  }
  source(name) {
    if (typeof name !== 'string' || !/^portable-[a-f0-9-]{36}$/.test(name)) throw new Error('Select a portable backup from this app.');
    const source = path.join(this.directory, name);
    if (fs.lstatSync(source).isSymbolicLink() || fs.realpathSync(source) !== path.join(fs.realpathSync(this.directory), name)) throw new Error('Backup folder must not be a symbolic link.');
    return source;
  }
  async importPortable(files, passphrase) {
    return this.exclusive(async () => {
      if (!files || typeof files.database !== 'string' || files.database.length > 34_000_000 || typeof files.manifest !== 'string' || Buffer.byteLength(files.manifest) > 1024 || typeof files.recovery !== 'string' || Buffer.byteLength(files.recovery) > 4096) throw new Error('Select all three portable backup files (database maximum 25 MB for browser import).');
      const data = Buffer.from(files.database, 'base64');
      if (!data.length || data.length > 25_000_000 || data.toString('base64') !== files.database) throw new Error('Invalid or oversized database upload (maximum 25 MB).');
      fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
      const temporary = fs.mkdtempSync(path.join(this.directory, '.import-'));
      let result;
      try {
        for (const [name, value] of [['database.db', data], ['recovery.json', files.recovery], ['manifest.json', files.manifest]]) fs.writeFileSync(path.join(temporary, name), value, { flag: 'wx', mode: 0o600 });
        result = await restorePortableBackup(temporary, passphrase, path.join(temporary, 'verification.db'));
        result.key.fill(0);
        fs.unlinkSync(path.join(temporary, 'verification.db'));
        const name = 'portable-' + randomUUID();
        fs.renameSync(temporary, path.join(this.directory, name));
        return { ok: true, verified: true, name };
      } finally {
        result?.key.fill(0);
        if (fs.existsSync(temporary)) fs.rmSync(temporary, { recursive: true, force: true });
      }
    });
  }
  async prepareRecovery(name, passphrase) {
    return this.exclusive(async () => {
      if (!this.runtime) throw new Error('Database runtime is required for restore.');
      this.runtime.assertAvailable(); this.discardPrepared();
      const { restorePaths } = require('./restore-files');
      const { openDatabase } = require('./database');
      const id = randomUUID(), paths = restorePaths(this.runtime.databaseFile, id);
      let recovered, candidate;
      try {
        recovered = await restorePortableBackup(this.source(name), passphrase, paths.candidate);
        this.runtime.assertAvailable();
        candidate = openDatabase(paths.candidate, recovered.key);
        if (this.requireLicense) {
          const current = this.db.prepare('SELECT payload FROM store_licenses WHERE store_id=?').get(this.storeId);
          const saved = candidate.prepare("SELECT 1 FROM sqlite_master WHERE name='store_licenses'").get() && candidate.prepare('SELECT payload FROM store_licenses WHERE store_id=?').get(this.storeId);
          if (!current || !saved || JSON.parse(current.payload).installationId !== JSON.parse(saved.payload).installationId) throw new Error('Restore requires a backup from this licensed store. Earlier or other-store backups cannot reset the trial. Contact team.');
        }
        if (this.requireAccounts && (!candidate.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='account_users'").get() || !candidate.prepare("SELECT 1 FROM account_users WHERE store_id=? AND json_extract(payload,'$.role')='superadmin' AND json_extract(payload,'$.active')=1").get(this.storeId))) throw new Error('This backup predates user-account setup. Restore an account-enabled backup to preserve ownership protection.');
        if (!candidate.prepare('SELECT 1 FROM stores WHERE store_id=?').get(this.runtime.storeId)) throw new Error('This backup does not contain the configured store.');
        const counts = candidate.prepare('SELECT collection, count(*) AS count FROM documents WHERE store_id=? GROUP BY collection').all(this.runtime.storeId);
        // Keep the active installation key unchanged: only one database file is
        // switched, not a non-atomic database/key pair.
        candidate.rekey(this.key);
        candidate.pragma('wal_checkpoint(TRUNCATE)'); candidate.pragma('journal_mode=DELETE');
        candidate.close(); candidate = null;
        validateBackup(paths.candidate, this.key);
        const descriptor = fs.openSync(paths.candidate, 'r+');
        try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
        this.prepared = { id, revision: this.runtime.revision(), expires: Date.now() + 10 * 60 * 1000 };
        return { ok: true, token: id, counts, expiresInSeconds: 600 };
      } catch (error) {
        if (candidate?.open) candidate.close();
        for (const suffix of ['', '-wal', '-shm']) if (fs.existsSync(paths.candidate + suffix)) fs.unlinkSync(paths.candidate + suffix);
        throw error;
      } finally { recovered?.key.fill(0); }
    });
  }
  async activatePrepared(token, confirmation) {
    return this.exclusive(async () => {
      const prepared = this.prepared;
      if (!prepared || token !== prepared.id || Date.now() > prepared.expires) throw new Error('Recovery preparation expired. Prepare the backup again.');
      if (confirmation !== 'RESTORE') throw new Error('Type RESTORE to confirm replacement of current data.');
      const result = await this.runtime.activateRecovery(prepared.id, prepared.revision);
      this.prepared = null;
      return result;
    });
  }
  discardPrepared() {
    if (!this.prepared || !this.runtime) return;
    const { candidate } = require('./restore-files').restorePaths(this.runtime.databaseFile, this.prepared.id);
    for (const suffix of ['', '-wal', '-shm']) if (fs.existsSync(candidate + suffix)) fs.unlinkSync(candidate + suffix);
    this.prepared = null;
  }
  async exclusive(action) {
    if (this.busy) throw Object.assign(new Error('A backup operation is already running. Please wait.'), { statusCode: 409 });
    this.busy = true;
    try { return await action(); } finally { this.busy = false; }
  }
  createPayload() { throw new Error('Use the database backup controls instead of JSON download.'); }
  restore() { throw new Error('Use the prepare-and-confirm database restore workflow.'); }
}
module.exports = { DatabaseBackupService };
