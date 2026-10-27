'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { applyReactMessages } = require('../lib/ui/react-messages');
const { PageRenderer } = require('../lib/ui/page-renderer');
const { createConfig } = require('../lib/config');

test('shared message presentation preserves error/success/notice wording without interpreting HTML', async () => {
  const { appMessage } = await import('../lib/app-message.mjs');
  for (const [type, title, icon] of [['error', 'Please check', '!'], ['success', 'Success', '✓'], ['info', 'Notice', 'i']]) {
    const value = { text: '<script>not executable</script>\nSecond line', type };
    assert.deepEqual(appMessage(value), { ...value, title, icon });
    assert.equal(value.text, '<script>not executable</script>\nSecond line');
  }
  assert.equal(appMessage({ text: 'message', type: 'unknown' }).type, 'info');
  for (const value of [null, {}, { text: 1 }]) assert.equal(appMessage(value), null);
});

test('message bridge queues startup messages, keeps classification and handles unhandled failures without storage writes', () => {
  const source = fs.readFileSync(path.join(__dirname, '../source/index.html'), 'utf8');
  const html = applyReactMessages(source);
  const start = html.indexOf("function showAppMessage(message, type = 'info'){");
  const end = html.indexOf('\nfunction fmt(n){', start);
  const events = [], listeners = {};
  const window = { dispatchEvent: event => events.push(event.type), addEventListener: (name, handler) => { listeners[name] = handler; } };
  const context = { window, document: { querySelector: () => null }, Event: class { constructor(type) { this.type = type; } } };
  vm.runInNewContext(html.slice(start, end) + '\ntoast("Customer name is required"); toast("Stock saved"); toast("Preparing PDF…"); window.alert("Error from legacy bridge");', context);
  assert.deepEqual(JSON.parse(JSON.stringify(window.vjAppMessageQueue)), [
    { text: 'Customer name is required', type: 'error' }, { text: 'Stock saved', type: 'success' },
    { text: 'Preparing PDF…', type: 'info' }, { text: 'Error from legacy bridge', type: 'error' }
  ]);
  listeners.unhandledrejection();
  assert.match(window.vjAppMessageQueue.at(-1).text, /operation could not be completed/);
  assert.ok(events.every(name => name === 'vj:app-message'));
  for (let index = 0; index < 60; index++) window.alert('message ' + index);
  assert.equal(window.vjAppMessageQueue.length, 50);
  assert.equal(window.vjAppMessageQueue.at(-1).text, 'message 59');
  assert.throws(() => applyReactMessages('changed source'), /boundary/);
});

test('React mode excludes legacy message DOM construction while legacy frontend retains it', () => {
  const renderer = new PageRenderer(createConfig({}));
  const react = renderer.render({ reactDashboard: true }), legacy = renderer.render();
  assert.ok(react.includes('id="react-app-messages"'));
  assert.ok(!react.includes("dialog.id = 'appMessageDialog'"));
  assert.ok(legacy.includes("dialog.id = 'appMessageDialog'"));
  for (const script of react.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
});
