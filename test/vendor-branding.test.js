'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('software provider is identified separately from customizable store identity', () => {
  const branding = read('source/scripts/core/branding.js');
  assert.match(branding, /class="vendor-name">Tech Aditya/);
  assert.match(branding, /querySelector\('\.footer-store'\)\.textContent = name/);
  assert.doesNotMatch(branding, /Preview copy/);
  for (const file of ['lib/security/account-page.html', 'scripts/setup.html']) {
    const html = read(file);
    assert.match(html, /Software by <strong>Tech Aditya<\/strong>/);
    assert.match(html, /new Date\(\)\.getFullYear\(\)/);
    assert.doesNotThrow(() => new Function(html.match(/<script>([\s\S]*?)<\/script>/)[1]));
  }
  const pkg = require('../package.json');
  assert.equal(pkg.author, 'Tech Aditya');
  assert.match(pkg.build.copyright, /Tech Aditya/);
  assert.equal(pkg.build.appId, 'com.visheshjewellers.billing');
  assert.match(read('electron-main.js'), /app\.setAboutPanelOptions\(/);
  assert.match(read('electron-main.js'), /Software solutions & products by Tech Aditya/);
});

test('login plan status is borderless and the background covers the viewport', () => {
  const html = read('lib/security/account-page.html');
  assert.match(html, /plan\.className='license-status'/);
  assert.match(html, /\.login \.license-status\{[^}]*border:0/);
  assert.match(html, /min-height:100svh/);
  assert.match(html, /#notice:empty\{display:none\}/);
});
