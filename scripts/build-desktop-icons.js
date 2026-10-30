'use strict';

// Regenerate on macOS; generated assets allow packaging on Windows without sips.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function buildIcons() {
  if (process.platform !== 'darwin') throw new Error('Regenerate icons on macOS; Windows builds use assets/desktop/icon.ico.');
  const root = path.join(__dirname, '..');
  const source = path.join(root, 'assets/desktop/karatdesk.png');
  const output = path.join(root, 'assets/desktop');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'vj-icons-'));
  try {
    fs.mkdirSync(output, { recursive: true });
    const pngs = new Map();
    for (const size of [16, 32, 48, 64, 128, 256, 512, 1024]) {
      const file = path.join(temporary, `${size}.png`);
      execFileSync('/usr/bin/sips', ['-z', String(size), String(size), source, '--out', file], { stdio: 'pipe' });
      pngs.set(size, fs.readFileSync(file));
    }
    // Modern ICNS elements contain PNG payloads; write the documented container
    // directly, without relying on iconutil's host-specific image conversion.
    const chunks = [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024]].map(([type, size]) => {
      const png = pngs.get(size), header = Buffer.alloc(8);
      header.write(type, 0, 'ascii'); header.writeUInt32BE(png.length + 8, 4);
      return Buffer.concat([header, png]);
    });
    const icnsHeader = Buffer.alloc(8);
    icnsHeader.write('icns', 0, 'ascii'); icnsHeader.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4);
    fs.writeFileSync(path.join(output, 'icon.icns'), Buffer.concat([icnsHeader, ...chunks]));
    const sizes = [16, 32, 48, 64, 128, 256];
    const header = Buffer.alloc(6 + sizes.length * 16);
    header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
    let offset = header.length;
    sizes.forEach((size, index) => {
      const entry = 6 + index * 16, png = pngs.get(size);
      header[entry] = size === 256 ? 0 : size;
      header[entry + 1] = header[entry];
      header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
      header.writeUInt32LE(png.length, entry + 8); header.writeUInt32LE(offset, entry + 12);
      offset += png.length;
    });
    fs.writeFileSync(path.join(output, 'icon.ico'), Buffer.concat([header, ...sizes.map(size => pngs.get(size))]));
    console.log('Generated KaratDesk macOS ICNS and multi-resolution Windows ICO.');
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

if (require.main === module) buildIcons();
module.exports = { buildIcons };
