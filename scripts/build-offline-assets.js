'use strict';

// Copy pinned upstream browser distributions (and their licenses), unchanged.
// Packaging already includes public/**/*, including these offline resources.
const fs = require('node:fs');
const path = require('node:path');
const target = path.join(__dirname, '../public/vendor');
const fonts = require('../lib/ui/offline-fonts');
fs.mkdirSync(target, { recursive: true });
for (const [name, file] of [['html2canvas', 'html2canvas.min.js'], ['jspdf', 'jspdf.umd.min.js']]) {
  const distribution = require.resolve(name + '/dist/' + file);
  fs.copyFileSync(distribution, path.join(target, file));
  fs.copyFileSync(path.join(path.dirname(distribution), '../LICENSE'), path.join(target, name + '.LICENSE'));
}
fs.mkdirSync(path.join(target, 'fonts'), { recursive: true });
for (const font of fonts) {
  fs.copyFileSync(require.resolve('@fontsource/' + font.packageName + '/files/' + font.file), path.join(target, 'fonts', font.file));
}
for (const name of new Set(fonts.map(font => font.packageName))) {
  const root = path.dirname(require.resolve('@fontsource/' + name + '/package.json'));
  fs.copyFileSync(path.join(root, 'LICENSE'), path.join(target, 'fonts', name + '.LICENSE'));
}
fs.writeFileSync(path.join(target, 'fonts.css'), fonts.map(font => `@font-face{font-family:'${font.family}';font-style:${font.style};font-weight:${font.weight};font-display:swap;src:url('/vendor/fonts/${font.file}') format('woff2');}`).join('\n') + '\n');
