'use strict';

const { createJsonStore } = require('../json-store');

// A separate encrypted file prevents generic business-storage and Excel routes
// from exposing password hashes. Not wired into the running app in this phase.
function createAccountRepository(file, encryptionKey) {
  if (typeof encryptionKey !== 'string' || Buffer.from(encryptionKey, 'base64').length !== 32) {
    throw new Error('Account storage requires the installation encryption key.');
  }
  const store = createJsonStore(file, { encryptionKey, requireEncrypted: true });
  return {
    read() {
      const value = store.read();
      if (!Object.keys(value).length) return { format: 'vj-accounts-v1', storeId: null, users: [] };
      if (value.format !== 'vj-accounts-v1' || !Array.isArray(value.users) || typeof value.storeId !== 'string') {
        throw new Error('Account storage is invalid. Restore its matching backup; do not reset it.');
      }
      return value;
    },
    write(value) { store.write(value); }
  };
}
module.exports = { createAccountRepository };
