'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const css = fs.readFileSync(path.join(__dirname, '../source/styles/application.css'), 'utf8');
const token = name => css.match(new RegExp('--' + name + ':\\s*(#[a-fA-F0-9]{6})'))?.[1];
function luminance(hex) {
  const rgb = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
}
function contrast(a, b) {
  const one = luminance(a), two = luminance(b);
  return (Math.max(one, two) + .05) / (Math.min(one, two) + .05);
}

test('light-mode warning, status and secondary text meet 4.5:1 contrast on their surfaces', () => {
  for (const [name, background] of [
    ['status-warning', '#fff3e2'], ['status-warning', '#fffaf2'],
    ['status-positive', '#f4ede0'], ['status-negative', '#f4ede0'],
    ['light-secondary', '#f7f4ed'], ['light-placeholder', '#fffdf8']
  ]) {
    const foreground = token(name);
    assert.ok(foreground, 'Missing light theme token: ' + name);
    assert.ok(contrast(foreground, background) >= 4.5, name + ' must stay readable');
  }
});

test('light warnings and financial statuses override pale dark-mode colors', () => {
  assert.match(css, /html\[data-theme="light"\] \.low-stock-panel h3,html\[data-theme="light"\] \.low-stock-item b \{ color:var\(--status-warning\)/);
  assert.match(css, /html\[data-theme="light"\] \.dashboard-negative \{ color:var\(--status-negative\)!important/);
  assert.match(css, /html\[data-theme="light"\] :is\(\.dashboard-total,\.exchange-row-value/);
  assert.match(css, /\.low-stock-item span \{ color: var\(--ivory-1, var\(--ivory\)\)/);
});
