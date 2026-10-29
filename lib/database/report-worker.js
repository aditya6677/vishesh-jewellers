'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const { openDatabase } = require('./database');
const { DatabaseQueries } = require('./queries');
const key = Buffer.from(workerData.key);
let db;
try { db = openDatabase(workerData.file, key, { readonly: true }); }
finally { key.fill(0); workerData.key.fill(0); }
const queries = new DatabaseQueries(db, workerData.storeId);
parentPort.on('message', ({ id, range }) => {
  try { parentPort.postMessage({ id, result: queries.dashboard(range) }); }
  catch (error) { parentPort.postMessage({ id, error: error.message, statusCode: error.statusCode || 500 }); }
});
parentPort.on('close', () => { if (db.open) db.close(); });
