'use strict';

const { randomBytes, scryptSync, timingSafeEqual } = require('node:crypto');
const PARAMETERS = Object.freeze({ N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128 || password.trim().length < 12) {
    throw Object.assign(new Error('Use a password of 12–128 characters, not just spaces.'), { statusCode: 400 });
  }
}

function hashPassword(password) {
  validatePassword(password);
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32, PARAMETERS);
  return { algorithm: 'scrypt-v1', salt: salt.toString('base64'), hash: hash.toString('base64') };
}

function verifyPassword(password, credential) {
  if (typeof password !== 'string' || password.length > 128) return false;
  if (credential?.algorithm !== 'scrypt-v1') return false;
  const salt = Buffer.from(credential.salt || '', 'base64');
  const expected = Buffer.from(credential.hash || '', 'base64');
  if (salt.length !== 16 || expected.length !== 32) return false;
  return timingSafeEqual(scryptSync(password, salt, 32, PARAMETERS), expected);
}

module.exports = { hashPassword, verifyPassword, validatePassword };
