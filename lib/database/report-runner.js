'use strict';
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { rangeBounds } = require('./queries');
class ReportRunner {
  constructor(file, key, storeId) {
    const copy = Buffer.from(key);
    try { this.worker = new Worker(path.join(__dirname, 'report-worker.js'), { workerData: { file, key: copy, storeId } }); }
    finally { copy.fill(0); }
    this.jobs = new Map(); this.sequence = 0; this.closed = false;
    this.worker.unref();
    this.worker.on('message', message => {
      const job = this.jobs.get(message.id); if (!job) return;
      clearTimeout(job.timer); this.jobs.delete(message.id);
      if (message.error) job.reject(Object.assign(new Error(message.error), { statusCode: message.statusCode })); else job.resolve(message.result);
    });
    const failed = () => {
      this.closed = true;
      for (const job of this.jobs.values()) { clearTimeout(job.timer); job.reject(new Error('Database reporting stopped. Restart the app before retrying.')); }
      this.jobs.clear();
    };
    this.worker.on('error', failed); this.worker.on('exit', failed);
  }
  snapshot(range = {}) {
    rangeBounds(range);
    if (this.closed) return Promise.reject(new Error('Database reporting is unavailable.'));
    if (this.jobs.size >= 4) return Promise.reject(Object.assign(new Error('Reports are busy. Please retry shortly.'), { statusCode: 503 }));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.jobs.delete(id); reject(new Error('The report exceeded its time limit. Narrow the date range and retry.')); }, 60000);
      timer.unref(); this.jobs.set(id, { resolve, reject, timer });
      this.worker.postMessage({ id, range });
    });
  }
  close() { if (this.stopping) return this.stopping; this.closed = true; this.stopping = this.worker.terminate(); return this.stopping; }
}
module.exports = { ReportRunner };
