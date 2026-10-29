'use strict';
const fs = require('node:fs');
const path = require('node:path');
function desktopBackend({ backend, isPackaged, userData, exists = fs.existsSync }) {
  if (backend) { if (!['json','sqlite'].includes(backend)) throw new Error('Choose json or sqlite desktop storage.'); return backend; }
  if (exists(path.join(userData, 'database-installation.json'))) return 'sqlite';
  const legacy = exists(path.join(userData, 'data-location.json')) || exists(path.join(userData, 'data', 'store.json'));
  return isPackaged && !legacy ? 'sqlite' : 'json';
}
module.exports = { desktopBackend };
