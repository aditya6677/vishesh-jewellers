'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

function verifyRoot(root) {
  for (const file of ['server.js', 'source/index.html', 'public/frontend/.vite/manifest.json', 'public/vendor/fonts.css', 'public/vendor/jspdf.umd.min.js']) {
    if (!fs.existsSync(path.join(root, file))) throw new Error('Packaged runtime layout is incomplete: ' + file + '. Verify shared ASAR/unpacked layout before distributing.');
  }
  const fastify = createRequire(path.join(root, 'server.js')).resolve('fastify');
  if (!fastify.startsWith(path.join(root, 'node_modules') + path.sep)) throw new Error('Packaged backend dependency resolved outside its runtime.');
}

module.exports = async function verifyPackagedLayout(context) {
  const resources = context.electronPlatformName === 'darwin'
    ? path.join(context.appOutDir, context.packager.appInfo.productFilename + '.app', 'Contents/Resources')
    : path.join(context.appOutDir, 'resources');
  // If architecture archives ever diverge, universal's alternate-archive layout
  // is incompatible with our fixed child-server root. Fail instead of shipping it.
  verifyRoot(path.join(resources, 'app.asar.unpacked'));
};
module.exports.verifyRoot = verifyRoot;
