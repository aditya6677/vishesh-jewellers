'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('React Records bridge resolves invoice identities and rejects stale or voided edits', async () => {
  const calls = [];
  const records = [{ number: 'B', status: 'voided' }, { number: 'A', status: 'completed' }];
  const window = { addEventListener() {}, dispatchEvent() {} };
  const context = {
    window, getRecords: async () => records, recordVersions: { A: 'a1', B: 'b1' },
    reprintInvoice: record => calls.push(['view', record.number]),
    openEditInvoiceModal: (record, index) => calls.push(['edit', record.number, index]),
    openVoidModal: (record, index) => calls.push(['void', record.number, index]),
    exportRecordPdf: async filters => calls.push(['export', filters.status])
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../source/scripts/records/react-bridge.js'), 'utf8'), context);
  await window.vjRecordAction('edit', 'A', 'a1');
  await window.vjRecordAction('view', 'B', 'b1');
  await window.vjRecordAction('void', 'A', 'a1');
  await window.vjRecordExport({ status: 'due' });
  assert.deepEqual(calls, [['edit', 'A', 1], ['view', 'B'], ['void', 'A', 1], ['export', 'due']]);
  await assert.rejects(window.vjRecordAction('edit', 'A', 'old'), /changed/);
  await assert.rejects(window.vjRecordAction('edit', 'B', 'b1'), /Voided/);
  await assert.rejects(window.vjRecordAction('view', 'missing', 'x'), /no longer exists/);
});
