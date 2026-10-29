'use strict';
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');

function acquireDatabaseLock(databaseFile) {
  const file = databaseFile + '.app-lock';
  const contents = JSON.stringify({ version: 1, pid: process.pid, nonce: randomUUID() });
  for (let attempt = 0; attempt < 2; attempt++) {
    let descriptor;
    try {
      descriptor = fs.openSync(file, 'wx', 0o600);
      fs.writeFileSync(descriptor, contents); fs.fsyncSync(descriptor); fs.closeSync(descriptor);
      return () => { if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === contents) fs.unlinkSync(file); };
    } catch (error) {
      if (descriptor !== undefined) { try { fs.closeSync(descriptor); } catch { /* Already closed. */ } }
      if (error.code !== 'EEXIST') throw error;
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.size > 1024) throw new Error('Database process lock is invalid. Do not delete recovery files; contact support.');
      const previous = fs.readFileSync(file, 'utf8');
      let record;
      try { record = JSON.parse(previous); } catch { throw new Error('Database process lock is unreadable. Contact support.'); }
      if (record.version !== 1 || !Number.isSafeInteger(record.pid) || record.pid < 1) throw new Error('Database process lock is invalid.');
      try { process.kill(record.pid, 0); throw new Error('This database is already open in another app process. Close it before continuing.'); }
      catch (probe) { if (probe.code !== 'ESRCH') throw probe; }
      if (fs.readFileSync(file, 'utf8') !== previous || fs.lstatSync(file).ino !== stat.ino) throw new Error('Database lock changed; retry startup.');
      fs.unlinkSync(file); // Only a verified stale app-generated coordination file.
    }
  }
  throw new Error('Database lock could not be acquired.');
}
module.exports = { acquireDatabaseLock };
