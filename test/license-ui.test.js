'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript'), React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
function load(relative, overrides = {}) {
  const file = path.join(__dirname, '../frontend/', relative), module = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  vm.runInNewContext(compiled, { module, exports: module.exports, require: name => overrides[name] || require(name.startsWith('.') ? path.resolve(path.dirname(file), name) : name) });
  return module.exports;
}
const { TeamContact } = load('components/TeamContact.tsx');
test('Legal and Support offers phone and email help for trial and paid customers', () => {
  let stateIndex = 0;
  const { LegalSupport } = load('legal/LegalSupport.tsx', {
    react: { ...React, useEffect() {}, useState: initial => [stateIndex++ === 0 ? { business: { name: 'Tech Aditya', address: 'India' }, documents: [] } : initial, () => {}] },
    './legal-api': {}, './PolicyReader': { PolicyReader: () => null }
  });
  const html = renderToStaticMarkup(React.createElement(LegalSupport));
  for (const value of ['Trial or paid plan', 'mailto:6677aditya@gmail.com', 'tel:+917275493769', '+91 7275493769']) assert.ok(html.includes(value), value);
});
function banner(plan) {
  const { LicenseBanner } = load('components/LicenseBanner.tsx', {
    react: { ...React, useEffect() {}, useState: () => [plan, () => {}] }, './TeamContact': { TeamContact }
  });
  return renderToStaticMarkup(React.createElement(LicenseBanner));
}
test('expired plan displays a read-only notice and actionable Team KaratDesk contacts', () => {
  const html = banner({ state: 'expired', daysRemaining: 0, message: 'Expired' });
  for (const value of ['Read-only access', 'Your data is safe', 'Team KaratDesk', 'mailto:6677aditya@gmail.com', 'tel:+917275493769']) assert.ok(html.includes(value), value);
});
test('plan banner shows trial days and upcoming renewal, without permanent paid-plan clutter', () => {
  assert.ok(banner({ state: 'trial', daysRemaining: 14 }).includes('14 days remaining'));
  assert.ok(banner({ state: 'paid', daysRemaining: 7 }).includes('subscription renews soon'));
  assert.equal(banner({ state: 'paid', daysRemaining: 365 }), '');
  assert.equal(banner({ state: 'disabled' }), '');
  assert.equal(banner({ state: 'paid', daysRemaining: null }), '');
});
