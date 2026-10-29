'use strict';
const { Role } = require('./roles');
const { defaultBusinessPermissions, validatePermissions } = require('./business-permissions');

// Dedicated tables: never included in generic business storage or Excel exports.
function createSqlAccountRepository(db, storeId) {
  if (!db.prepare('SELECT 1 FROM stores WHERE store_id=?').get(storeId)) throw new Error('Account store does not exist.');
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS account_schema(version INTEGER PRIMARY KEY CHECK(version=1));
      CREATE TABLE IF NOT EXISTS account_installations(store_id TEXT PRIMARY KEY REFERENCES stores(store_id), format TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS account_users(store_id TEXT NOT NULL REFERENCES stores(store_id), id TEXT NOT NULL, username TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)), PRIMARY KEY(store_id,id), UNIQUE(store_id,username));
      CREATE TABLE IF NOT EXISTS account_roles(store_id TEXT NOT NULL REFERENCES stores(store_id), role_id TEXT NOT NULL, permissions TEXT NOT NULL CHECK(json_valid(permissions)), PRIMARY KEY(store_id,role_id));
      CREATE TABLE IF NOT EXISTS account_audit(id INTEGER PRIMARY KEY, store_id TEXT NOT NULL REFERENCES stores(store_id), occurred_at TEXT NOT NULL, action TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS account_attempts(store_id TEXT NOT NULL REFERENCES stores(store_id), username TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)), PRIMARY KEY(store_id,username));
    `);
    const version = db.prepare('SELECT version FROM account_schema').get();
    if (version && version.version !== 1) throw new Error('Unsupported account schema.');
    db.prepare('INSERT OR IGNORE INTO account_schema VALUES(1)').run();
    const insert = db.prepare('INSERT OR IGNORE INTO account_roles VALUES(?,?,?)');
    for (const [role, permissions] of Object.entries(defaultBusinessPermissions)) insert.run(storeId, role, JSON.stringify(permissions));
  }).immediate();
  return {
    read() {
      const metadata = db.prepare('SELECT format FROM account_installations WHERE store_id=?').get(storeId);
      const users = db.prepare('SELECT payload FROM account_users WHERE store_id=? ORDER BY rowid').all(storeId).map(row => JSON.parse(row.payload));
      if (!metadata && users.length) throw new Error('Account installation metadata is missing; recovery is required.');
      return { format: metadata?.format || 'vj-accounts-v1', storeId, users };
    },
    write(data) {
      if (data.format !== 'vj-accounts-v1' || !Array.isArray(data.users)) throw new Error('Invalid account data.');
      for (const user of data.users) if (!user || typeof user.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{2,63}$/.test(user.username || '') || !Object.values(Role).includes(user.role) || typeof user.active !== 'boolean' || !user.credential) throw new Error('Invalid user record.');
      db.transaction(() => {
        const before = this.read();
        const previousIds = new Set(before.users.map(user => user.id));
        const ids = new Set(data.users.map(user => user.id));
        if (ids.size !== data.users.length || before.users.some(user => !ids.has(user.id))) throw new Error('Account history cannot be deleted.');
        if (!data.users.some(user => user.active && user.role === Role.SUPERADMIN)) throw new Error('Keep at least one active Superadmin.');
        db.prepare('INSERT OR IGNORE INTO account_installations VALUES(?,?)').run(storeId, data.format);
        const save = db.prepare('INSERT INTO account_users VALUES(?,?,?,?) ON CONFLICT(store_id,id) DO UPDATE SET username=excluded.username,payload=excluded.payload');
        for (const user of data.users) save.run(storeId, user.id, user.username, JSON.stringify(user));
        db.prepare('UPDATE store_revisions SET revision=revision+1 WHERE store_id=?').run(storeId);
        db.prepare('INSERT INTO account_audit(store_id,occurred_at,action) VALUES(?,?,?)').run(storeId, new Date().toISOString(), previousIds.size ? 'accounts.updated' : 'superadmin.initialized');
      }).immediate();
    },
    permissions(role) {
      const row = db.prepare('SELECT permissions FROM account_roles WHERE store_id=? AND role_id=?').get(storeId, role);
      return row ? validatePermissions(JSON.parse(row.permissions)) : [];
    },
    roles() { return db.prepare('SELECT role_id,permissions FROM account_roles WHERE store_id=?').all(storeId).map(row => ({ role: row.role_id, permissions: JSON.parse(row.permissions) })); },
    getAttempt(username) { const row = db.prepare('SELECT payload FROM account_attempts WHERE store_id=? AND username=?').get(storeId, username); return row ? JSON.parse(row.payload) : undefined; },
    saveAttempt(username, attempt) {
      if (!attempt) db.prepare('DELETE FROM account_attempts WHERE store_id=? AND username=?').run(storeId, username);
      else db.transaction(() => {
        db.prepare('INSERT INTO account_attempts VALUES(?,?,?) ON CONFLICT(store_id,username) DO UPDATE SET payload=excluded.payload').run(storeId, username, JSON.stringify(attempt));
        db.prepare('DELETE FROM account_attempts WHERE store_id=? AND username NOT IN (SELECT username FROM account_attempts WHERE store_id=? ORDER BY json_extract(payload,\'$.last\') DESC LIMIT 1000)').run(storeId, storeId);
      }).immediate();
    },
    audit(action) { db.prepare('INSERT INTO account_audit(store_id,occurred_at,action) VALUES(?,?,?)').run(storeId, new Date().toISOString(), action); },
    auditList() { return db.prepare('SELECT id,occurred_at,action FROM account_audit WHERE store_id=? ORDER BY id DESC LIMIT 200').all(storeId); },
    setRolePermissions(role, permissions) {
      if (!Object.values(Role).includes(role) || role === Role.SUPERADMIN) throw new Error('Choose a non-Superadmin role.');
      const validated = validatePermissions(permissions);
      if (validated.includes('users.roles') || (validated.includes('users.manage') && role !== Role.OWNER)) throw new Error('Role administration is Superadmin-only; user administration can be assigned only to Owner.');
      if (!validated.some(permission => permission.endsWith('.view'))) throw new Error('A role requires at least one visible menu.');
      for (const permission of validated) if (!permission.endsWith('.view') && !validated.includes(permission.split('.')[0] + '.view')) throw new Error('Enable menu viewing before assigning its actions: ' + permission);
      db.transaction(() => {
        db.prepare('UPDATE account_roles SET permissions=? WHERE store_id=? AND role_id=?').run(JSON.stringify(validated), storeId, role);
        db.prepare('UPDATE store_revisions SET revision=revision+1 WHERE store_id=?').run(storeId);
        db.prepare('INSERT INTO account_audit(store_id,occurred_at,action) VALUES(?,?,?)').run(storeId, new Date().toISOString(), 'role.permissions.updated:' + role);
      }).immediate();
    }
  };
}
module.exports = { createSqlAccountRepository };
