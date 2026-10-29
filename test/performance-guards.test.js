'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { gzipSync } = require('node:zlib');
const root = path.join(__dirname, '..');

test('production React JavaScript stays within a 160 KiB gzip budget', () => {
  const directory = path.join(root, 'public/frontend/assets');
  const size = fs.readdirSync(directory).filter(file => file.endsWith('.js')).reduce((total, file) => total + gzipSync(fs.readFileSync(path.join(directory, file))).length, 0);
  assert.ok(size > 0);
  assert.ok(size <= 160 * 1024, `Frontend grew to ${size} gzip bytes; review new dependencies before increasing the budget.`);
});

test('business date changes do not trigger unrelated market-rate downloads', () => {
  const source = fs.readFileSync(path.join(root, 'frontend/dashboard/Dashboard.tsx'), 'utf8');
  const effects = [...source.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\}, \[([^\]]*)\]\);/g)];
  const report = effects.find(effect => effect[2] === 'range, revision');
  const rates = effects.find(effect => effect[2] === 'revision');
  assert.ok(report); assert.ok(rates);
  assert.doesNotMatch(report[1], /loadRates/);
  assert.match(rates[1], /loadRates/);
});

test('trimmed PDF parser retains its executable CommonJS entry without source maps or ESM', t => {
  const config = require('../package.json').build.files;
  assert.ok(config.includes('!node_modules/pdf2json/dist/*.map'));
  assert.ok(config.includes('!node_modules/pdf2json/dist/pdfparser.js'));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vj-parser-runtime-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, 'dist'));
  const original = path.join(root, 'node_modules/pdf2json');
  fs.copyFileSync(path.join(original, 'package.json'), path.join(directory, 'package.json'));
  fs.copyFileSync(path.join(original, 'dist/pdfparser.cjs'), path.join(directory, 'dist/pdfparser.cjs'));
  assert.equal(typeof require(directory), 'function');
});
