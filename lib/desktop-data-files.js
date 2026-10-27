'use strict';

const fileSystem = require('node:fs');

// The caller authenticates the incoming backup and saves a recovery copy first.
// Two files cannot be atomically renamed as a pair; roll back both on a reported
// replacement failure. A process/power-loss recovery still requires the backup.
function replaceDesktopData({ storePath, keyPath, encryptedStore, keyEnvelope }, fs = fileSystem) {
  const targets = [
    { path: keyPath, next: keyEnvelope + '\n' },
    { path: storePath, next: JSON.stringify(encryptedStore, null, 2) + '\n' }
  ].map(target => ({ ...target, previous: fs.readFileSync(target.path), temp: target.path + '.restore.tmp', rollback: target.path + '.rollback.tmp' }));
  let replacementStarted = false;
  try {
    for (const target of targets) fs.writeFileSync(target.temp, target.next, { mode: 0o600 });
    replacementStarted = true;
    for (const target of targets) fs.renameSync(target.temp, target.path);
  } catch (error) {
    if (replacementStarted) {
      const failures = [];
      for (const target of targets) {
        try { fs.writeFileSync(target.rollback, target.previous, { mode: 0o600 }); fs.renameSync(target.rollback, target.path); }
        catch (rollbackError) { failures.push(rollbackError.message); }
      }
      if (failures.length) throw new Error('Restore failed and rollback was incomplete. Keep the pre-restore backup and do not delete the data or key files. ' + failures.join('; '));
    }
    throw error;
  } finally {
    for (const target of targets) for (const file of [target.temp, target.rollback]) {
      try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch (_) { /* Preserve the original failure; encrypted temporary files may need cleanup. */ }
    }
  }
}

module.exports = { replaceDesktopData };
