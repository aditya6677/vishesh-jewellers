'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.join(__dirname, '..');

function themeApi(storage) {
  const module = { exports: {} }, document = { documentElement: { dataset: {} } };
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, 'frontend/theme.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(compiled, { module, exports: module.exports, document, window: { localStorage: storage } });
  return { ...module.exports, document };
}

test('appearance defaults to dark and persists light without touching session or business keys', () => {
  const values = new Map([['session', 'unchanged']]);
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const api = themeApi(storage);
  api.restoreTheme(); assert.equal(api.document.documentElement.dataset.theme, 'dark');
  assert.equal(api.persistTheme('light'), true);
  api.restoreTheme(); assert.equal(api.document.documentElement.dataset.theme, 'light');
  assert.equal(values.get('session'), 'unchanged');
  assert.equal(values.size, 2);
  values.set(api.THEME_KEY, 'unexpected');
  assert.equal(api.readTheme(storage), 'dark');
});

test('blocked preference storage never prevents opening or changing the current theme', () => {
  const api = themeApi({ getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } });
  assert.doesNotThrow(() => api.restoreTheme());
  assert.equal(api.document.documentElement.dataset.theme, 'dark');
  assert.equal(api.persistTheme('light'), false);
  api.applyTheme('light'); assert.equal(api.document.documentElement.dataset.theme, 'light');
});

test('theme control is accessible and synchronizes saved appearance between windows', () => {
  const source = fs.readFileSync(path.join(root, 'frontend/components/ThemeToggle.tsx'), 'utf8');
  assert.match(source, /type="button"/);
  assert.match(source, /aria-pressed=\{theme === 'light'\}/);
  assert.match(source, /Switch to \$\{next\} mode/);
  assert.match(source, /removeEventListener\('storage', sync\)/);
  const account = fs.readFileSync(path.join(root, 'lib/security/account-page.html'), 'utf8');
  assert.match(account, /localStorage\.getItem\('vj-ui-theme'\)/);
});

test('light workspace overrides leave invoice paper colors explicitly pinned', () => {
  const css = fs.readFileSync(path.join(root, 'source/styles/application.css'), 'utf8');
  assert.match(css, /html\[data-theme="light"\]/);
  assert.match(css, /#invoicePaper\s*\{ --ivory:#FAF5E7;[^}]*--gold:#C69A3A;[^}]*--text-dark:#2B2317/);
});
