'use strict';

const { HttpStatus } = require('../domain/constants');

function readJson(req, maxBytes = 1_000_000, tooLargeMessage = 'Request body is too large.') {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on('data', chunk => {
      if (failed) return;
      size += chunk.length;
      if (size > maxBytes) {
        failed = true;
        chunks.length = 0;
        const error = new Error(tooLargeMessage);
        error.statusCode = HttpStatus.TOO_LARGE;
        reject(error);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (failed) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (error) { reject(error); }
    });
    req.on('error', reject);
    req.on('aborted', () => reject(new Error('Request was aborted.')));
  });
}

module.exports = { readJson };
