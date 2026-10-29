'use strict';
const { app, safeStorage } = require('electron');
const { setupRecoveryScenario } = require('./setup-recovery-scenario');
app.whenReady().then(async () => {
  try { console.log(JSON.stringify(await setupRecoveryScenario(safeStorage, process.platform))); app.exit(0); }
  catch (error) { console.error(JSON.stringify({ verified: false, error: error.message })); app.exit(1); }
}).catch(error => { console.error(error.message); app.exit(1); });
