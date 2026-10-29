'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const { openDatabase } = require('../database/database');
const { createSqlAccountRepository } = require('./sql-account-repository');
const { AccountService } = require('./account-service');
const key = Buffer.from(workerData.key);
let db;
try {
  db = openDatabase(workerData.file, key);
  const accounts = new AccountService(createSqlAccountRepository(db, workerData.storeId));
  const allowed = new Set(['status', 'permissions', 'listUsers', 'roles', 'audit', 'auditList', 'editUser', 'setRolePermissions', 'setup', 'login', 'current', 'logout', 'createUser', 'resetPassword', 'changePassword', 'setAccess']);
  parentPort.on('message', ({ id, operation, args }) => {
    try {
      if (!allowed.has(operation) || !Array.isArray(args)) throw new Error('Invalid account operation.');
      let actor;
      if (['createUser', 'editUser', 'resetPassword', 'setAccess', 'setRolePermissions', 'changePassword'].includes(operation)) actor = accounts.current(args[0], operation === 'changePassword');
      const result = accounts[operation](...args);
      if (actor) accounts.repository.audit(JSON.stringify({ actorId: actor.id, operation, targetId: typeof args[1] === 'string' && operation !== 'changePassword' ? args[1] : undefined }));
      parentPort.postMessage({ id, result });
    } catch (error) { parentPort.postMessage({ id, error: { message: error.message, statusCode: error.statusCode || 400 } }); }
  });
  parentPort.postMessage({ ready: true });
} finally { key.fill(0); workerData.key.fill(0); }
