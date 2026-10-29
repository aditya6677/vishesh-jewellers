'use strict';
const path = require('node:path');
const { Worker } = require('node:worker_threads');
class AsyncAccounts {
  constructor(file, key, storeId) {
    this.pending = new Map(); this.nextId = 0; this.closed = false;
    this.worker = new Worker(path.join(__dirname, 'account-worker.js'), { workerData: { file, key, storeId } });
    this.ready = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
    this.worker.on('message', message => {
      if (message.ready) return this.resolveReady();
      const pending = this.pending.get(message.id); if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(Object.assign(new Error(message.error.message), { statusCode: message.error.statusCode })); else pending.resolve(message.result);
    });
    const fail = error => { this.closed = true; this.rejectReady(error); for (const pending of this.pending.values()) pending.reject(error); this.pending.clear(); };
    this.worker.on('error', fail);
    this.worker.on('exit', () => fail(new Error('Account worker stopped.')));
  }
  async call(operation, ...args) {
    await this.ready;
    if (this.closed) throw new Error('Account worker is closed.');
    if (this.pending.size >= 64 || (['setup', 'setupWithLegal', 'login', 'createUser', 'resetPassword', 'changePassword'].includes(operation) && [...this.pending.values()].filter(item => item.expensive).length >= 4)) throw Object.assign(new Error('Account service is busy. Try again shortly.'), { statusCode: 429 });
    const id = ++this.nextId;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject, expensive: ['setup', 'setupWithLegal', 'login', 'createUser', 'resetPassword', 'changePassword'].includes(operation) }); this.worker.postMessage({ id, operation, args }); });
  }
  close() { this.closed = true; if (!this.closing) this.closing = this.worker.terminate(); return this.closing; }
}
module.exports = { AsyncAccounts };
