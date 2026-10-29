'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../scripts/setup.html'), 'utf8');

function preview() {
  const fields = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => [id, { value: '', textContent: '', checked: false, hidden: false, disabled: false, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; }, focus() { context.document.activeElement = this; }, addEventListener() {}, contains(value) { return value === this; } }]));
  fields['mode-options'].hidden = true;
  fields.mode.value = 'new';
  const submitted = [];
  const context = {
    document: {
      addEventListener() {},
      getElementById: id => fields[id],
      createElement: () => ({}),
      querySelector: () => ({ append() {} }),
      querySelectorAll: () => Object.values(fields)
    },
    window: { storeSetup: { chooseBackup: async () => '/synthetic/backup', submit: async value => { submitted.push(value); return { ok: true }; } } }
  };
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  return { fields, submitted, document: context.document };
}

test('compact onboarding keeps responsive columns and every setup field accessible', () => {
  assert.match(html, /grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)/);
  assert.match(html, /@media\(max-width:620px\)/);
  assert.match(html, /grid-template-columns:1fr/);
  assert.doesNotMatch(html, /overflow\s*:\s*hidden/);
  for (const id of ['mode', 'store-name', 'store-tagline', 'choose', 'folder', 'passphrase', 'confirm', 'ack', 'continue', 'error']) {
    assert.equal([...html.matchAll(new RegExp(`id="${id}"`, 'g'))].length, 1);
  }
});

test('new layout retains validation, secure setup payload and passphrase clearing', async () => {
  const { fields: f, submitted } = preview();
  await f.continue.onclick();
  assert.match(f.error.textContent, /Choose a folder/);
  assert.equal(submitted.length, 0);
  await f.choose.onclick();
  f.passphrase.value = f.confirm.value = 'Synthetic recovery phrase!';
  await f.continue.onclick();
  assert.match(f.error.textContent, /store name/);
  f['store-name'].value = 'Synthetic store';
  f.ack.checked = true;
  await f.continue.onclick();
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0].storeName, 'Synthetic store');
  assert.equal(submitted[0].recoveryAcknowledged, true);
  assert.equal(f.passphrase.value, '');
  assert.equal(f.confirm.value, '');
  assert.equal(f.continue.disabled, false);
});

test('switching to restore hides only new-store fields and clears sensitive values', () => {
  const { fields: f } = preview();
  f.passphrase.value = f.confirm.value = 'Synthetic recovery phrase!';
  f.ack.checked = true;
  f.mode.value = 'restore';
  f.mode.onchange();
  assert.equal(f['store-details'].hidden, true);
  assert.equal(f['new-options'].hidden, true);
  assert.equal(f.passphrase.value, '');
  assert.equal(f.confirm.value, '');
  assert.equal(f.ack.checked, false);
  assert.equal(f.continue.textContent, 'Restore & open app');
});

test('custom setup dropdown selects restore, updates its label and returns focus', () => {
  const { fields: f, document } = preview();
  f['mode-trigger'].onclick();
  assert.equal(f['mode-options'].hidden, false);
  assert.equal(f['mode-trigger'].attributes['aria-expanded'], 'true');
  assert.equal(document.activeElement, f['mode-new']);
  f['mode-restore'].onclick();
  assert.equal(f.mode.value, 'restore');
  assert.equal(f['mode-value'].textContent, 'Restore encrypted backup');
  assert.equal(f['mode-restore'].attributes['aria-selected'], 'true');
  assert.equal(f['mode-new'].attributes['aria-selected'], 'false');
  assert.equal(f['store-details'].hidden, true);
  assert.equal(f['mode-options'].hidden, true);
  assert.equal(document.activeElement, f['mode-trigger']);
});

test('custom setup dropdown supports keyboard navigation and Escape without selection', () => {
  const { fields: f, document } = preview();
  const key = value => ({ key: value, preventDefault() {} });
  f['mode-trigger'].onkeydown(key('ArrowDown'));
  f['mode-options'].onkeydown(key('End'));
  assert.equal(document.activeElement, f['mode-restore']);
  f['mode-options'].onkeydown(key('ArrowUp'));
  assert.equal(document.activeElement, f['mode-new']);
  f['mode-options'].onkeydown(key('Escape'));
  assert.equal(f['mode-options'].hidden, true);
  assert.equal(f.mode.value, 'new');
  assert.equal(document.activeElement, f['mode-trigger']);
});
