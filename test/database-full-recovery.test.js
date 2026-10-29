'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setupRecoveryScenario } = require('../scripts/setup-recovery-scenario');
test('complete setup, stock, invoice, settlement and trade flow survives fresh-installation recovery', async () => {
  // OS API contract double; native check:setup-recovery separately uses real safeStorage.
  const storage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value).map(x => x ^ 93), decryptString: value => Buffer.from(value).map(x => x ^ 93).toString() };
  const result = await setupRecoveryScenario(storage, 'darwin');
  assert.equal(result.verified, true);
  assert.equal(result.startupRecoveryPreservesOriginalFiles, true);
});
