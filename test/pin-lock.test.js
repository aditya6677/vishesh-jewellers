'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { PageRenderer } = require('../lib/ui/page-renderer');
const { createConfig } = require('../lib/config');

test('PIN validation preserves required/incorrect messages and accepts only the existing PIN', async () => {
  const { pinError } = await import('../lib/pin-lock.mjs');
  for (const value of ['', '   ']) assert.equal(pinError(value), 'PIN is required.');
  for (const value of ['1234', '551', '55120', ' 5512', 'abcd']) assert.equal(pinError(value), 'Incorrect PIN. Please try again.');
  assert.equal(pinError('5512'), '');
});

test('PIN sessions keep the same key, stay tab-scoped, and fail closed when storage is blocked', async () => {
  const { PIN_SESSION_KEY, isPinUnlocked, savePinSession } = await import('../lib/pin-lock.mjs');
  const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  assert.equal(isPinUnlocked(storage), false); assert.equal(savePinSession(storage), true);
  assert.equal(values.get(PIN_SESSION_KEY), 'true'); assert.equal(isPinUnlocked(storage), true);
  assert.equal(isPinUnlocked({ getItem: () => null }), false);
  assert.equal(isPinUnlocked({ getItem() { throw Error('Blocked'); } }), false);
  assert.equal(savePinSession({ setItem() { throw Error('Blocked'); } }), false);
  assert.equal(values.size, 1);
});

test('React PIN bootstrap hides workspace before mounting; legacy PIN remains in original mode', () => {
  const renderer = new PageRenderer(createConfig({}));
  const react = renderer.render({ reactDashboard: true }), legacy = renderer.render();
  assert.ok(react.includes('id="react-pin-lock" class="pin-lock"'));
  assert.ok(react.indexOf('body.pin-locked > *:not(.pin-lock){visibility:hidden}') < react.indexOf('<body>'));
  assert.ok(!react.includes("const PIN_CODE = '5512'"));
  assert.ok(!react.includes("getElementById('pinLockForm').addEventListener"));
  assert.ok(legacy.includes("getElementById('pinLockForm').addEventListener"));
  const bootstrap = /<body><script>([\s\S]*?)<\/script>/.exec(react)[1];
  for (const state of ['true', null, 'false', 'blocked']) {
    const classes = [];
    vm.runInNewContext(bootstrap, { sessionStorage: { getItem() { if (state === 'blocked') throw Error('Blocked'); return state; } }, document: { body: { classList: { add: value => classes.push(value) } } } });
    assert.deepEqual(classes, state === 'true' ? [] : ['pin-locked']);
  }
});
