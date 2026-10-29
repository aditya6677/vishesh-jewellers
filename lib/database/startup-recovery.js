'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

function within(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative);
}

// Setup/restore happens in a new directory. Only a fully validated installation
// pointer is activated; old databases, encrypted keys and settings remain intact.
function activateRecovery({ userData, recoveryDirectory, safeStorage, platform = process.platform }) {
  const { LocalKeyStore } = require('./local-key-store');
  const { validateBackup } = require('./backup');
  const { readInstallation } = require('./first-run');
  if (!path.isAbsolute(userData) || !path.isAbsolute(recoveryDirectory) || !within(userData, recoveryDirectory) || fs.lstatSync(recoveryDirectory).isSymbolicLink()) throw new Error('Invalid recovery directory.');
  if (!within(fs.realpathSync(userData), fs.realpathSync(recoveryDirectory))) throw new Error('Recovery directory must stay inside app data.');
  const config = readInstallation(recoveryDirectory);
  if (!config || !within(recoveryDirectory, config.databaseFile) || !within(fs.realpathSync(recoveryDirectory), fs.realpathSync(config.databaseFile))) throw new Error('Recovery database is outside its isolated directory.');
  const keys = new LocalKeyStore(safeStorage, platform);
  const filename = createHash('sha256').update(config.databaseFile).digest('hex') + '.bin';
  const key = keys.load(path.join(recoveryDirectory, 'database-keys', filename));
  const target = path.join(userData, 'database-installation.json');
  const previous = fs.existsSync(target) ? fs.readFileSync(target) : null;
  const temporary = path.join(recoveryDirectory, 'installation-to-activate.json');
  try {
    const stores = validateBackup(config.databaseFile, key);
    if (stores.length !== 1 || stores[0] !== config.storeId) throw new Error('Recovered store identity does not match its installation settings.');
    const archive = path.join(recoveryDirectory, 'previous-settings');
    fs.mkdirSync(archive, { mode: 0o700 });
    for (const file of ['database-installation.json', 'data-location.json']) {
      const source = path.join(userData, file);
      if (!fs.existsSync(source)) continue;
      if (!fs.lstatSync(source).isFile() || fs.lstatSync(source).isSymbolicLink()) throw new Error('Recovery cannot replace linked or non-file installation settings.');
      fs.copyFileSync(source, path.join(archive, file), fs.constants.COPYFILE_EXCL);
    }
    const keyDirectory = path.join(userData, 'database-keys');
    fs.mkdirSync(keyDirectory, { recursive: true, mode: 0o700 });
    if (fs.lstatSync(keyDirectory).isSymbolicLink()) throw new Error('Recovery cannot use a linked key directory.');
    keys.save(path.join(keyDirectory, filename), key);
    const current = fs.existsSync(target) ? fs.readFileSync(target) : null;
    if ((previous === null) !== (current === null) || (previous && !previous.equals(current))) throw new Error('Installation settings changed during recovery. No switch was made.');
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(config)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, target);
    return { installation: config, archive };
  } finally { key.fill(0); }
}

function startupExplanation(error) {
  const message = String(error?.message || 'The application could not start.');
  if (/decryptString|ciphertext|unlock.*key|protected.*key|secure storage|keychain|DPAPI/i.test(message)) return {
    title: 'We couldn’t unlock your store',
    message: 'This Windows account or macOS Keychain could not unlock the saved encryption key. The key may belong to another account or be damaged. Your existing files have not been reset.',
    guidance: 'Try the original computer account first. Otherwise restore a portable backup using its recovery passphrase. Never delete AppData or replace a key to unlock existing records.'
  };
  return { title: 'Your store couldn’t start', message: 'The app could not open its local workspace. Existing records have not been reset.', guidance: 'Retry, open the data folder for support, or recover from a portable backup. Creating a separate new store does not recover old records.' };
}
module.exports = { activateRecovery, startupExplanation };
