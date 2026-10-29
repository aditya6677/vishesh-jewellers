'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('desktop child server packages production modules beside unpacked runtime and excludes business data', () => {
  const pkg = require('../package.json');
  assert.match(pkg.build.copyright, /Tech Aditya/);
  assert.doesNotMatch(pkg.build.copyright, /\$\{year\}/, 'electron-builder does not define a year macro');
  assert.ok(pkg.build.asarUnpack.includes('node_modules/**/*'));
  assert.equal(pkg.build.mac.mergeASARs, false);
  assert.equal(pkg.build.afterPack, 'scripts/verify-packaged-layout.js');
  for (const pattern of ['server.js', 'lib/**/*', 'source/**/*', 'public/**/*', 'assets/**/*']) {
    assert.ok(pkg.build.files.includes(pattern)); assert.ok(pkg.build.asarUnpack.includes(pattern));
  }
  for (const pattern of pkg.build.files) assert.ok(!/^(data|backups|\.env)(\/|$)/.test(pattern));
  const electron = fs.readFileSync(path.join(__dirname, '../electron-main.js'), 'utf8');
  assert.ok(electron.includes("path.join(process.resourcesPath, 'app.asar.unpacked')"));
  for (const script of ['package:desktop', 'package:windows', 'package:all']) assert.equal(pkg.scripts['pre' + script], 'npm run build:frontend');
});

test('packaging gate accepts complete runtime and rejects missing unpacked layout', () => {
  const { verifyRoot } = require('../scripts/verify-packaged-layout');
  verifyRoot(path.join(__dirname, '..'));
  assert.throws(() => verifyRoot(path.join(__dirname, 'nonexistent-packaged-runtime')), /layout is incomplete/);
});

test('desktop icons use the business logo with valid multi-resolution native containers', () => {
  const pkg = require('../package.json');
  assert.equal(pkg.build.mac.icon, 'assets/desktop/icon.icns');
  assert.equal(pkg.build.win.icon, 'assets/desktop/icon.ico');
  const ico = fs.readFileSync(path.join(__dirname, '..', pkg.build.win.icon));
  assert.equal(ico.readUInt16LE(0), 0); assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 6);
  let expectedOffset = 6 + 6 * 16;
  [16, 32, 48, 64, 128, 256].forEach((size, index) => {
    const entry = 6 + index * 16;
    assert.equal(ico[entry] || 256, size); assert.equal(ico[entry + 1] || 256, size);
    const length = ico.readUInt32LE(entry + 8), offset = ico.readUInt32LE(entry + 12);
    assert.equal(offset, expectedOffset); assert.ok(offset + length <= ico.length);
    assert.equal(ico.subarray(offset, offset + 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(ico.readUInt32BE(offset + 16), size); assert.equal(ico.readUInt32BE(offset + 20), size);
    expectedOffset += length;
  });
  assert.equal(expectedOffset, ico.length);
  const icns = fs.readFileSync(path.join(__dirname, '..', pkg.build.mac.icon));
  assert.equal(icns.toString('ascii', 0, 4), 'icns'); assert.equal(icns.readUInt32BE(4), icns.length);
  let offset = 8;
  const chunks = [];
  while (offset < icns.length) {
    const length = icns.readUInt32BE(offset + 4);
    assert.ok(length >= 8 && offset + length <= icns.length);
    chunks.push(icns.toString('ascii', offset, offset + 4)); offset += length;
  }
  assert.equal(offset, icns.length); assert.ok(chunks.includes('ic10'), '1024px macOS icon required');
});
