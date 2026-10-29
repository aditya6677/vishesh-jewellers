'use strict';
// Vendor-only CLI. Never included in the customer application build.
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { generateKeyPairSync, createPrivateKey, sign } = require('node:crypto');
function secret() {
  return new Promise((resolve, reject) => {
    let value = '';
    const tty = process.stdin.isTTY;
    if (tty) { process.stdout.write('Issuer key passphrase (hidden): '); process.stdin.setRawMode(true); }
    process.stdin.setEncoding('utf8'); process.stdin.resume();
    function finish(error) { process.stdin.off('data', input); process.stdin.off('end', end); if (tty) { process.stdin.setRawMode(false); process.stdout.write('\n'); } process.stdin.pause(); error ? reject(error) : resolve(value.replace(/\r?\n$/, '')); }
    function input(chunk) { for (const character of chunk) { if (tty && ['\r','\n'].includes(character)) return finish(); if (character === '\u0003') return finish(new Error('Cancelled.')); if (tty && ['\u007f','\b'].includes(character)) value = Array.from(value).slice(0,-1).join(''); else value += character; if (value.length > 128) return finish(new Error('Passphrase must be 12–128 characters.')); } }
    function end() { finish(); }
    process.stdin.on('data', input); process.stdin.once('end', end);
  });
}
async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { public: { type: 'string' }, private: { type: 'string' }, store: { type: 'string' }, plan: { type: 'string', default: 'Paid' }, expires: { type: 'string' }, limit: { type: 'string' } } });
  const command = positionals[0];
  if (!['keys','issue'].includes(command) || !path.isAbsolute(values.private || '')) throw new Error('Use keys --public ABSOLUTE_PATH --private ABSOLUTE_PATH, or issue --private ABSOLUTE_PATH --store STORE_ID [--plan NAME] [--expires ISO_DATE] [--limit COUNT].');
  const privateParent = fs.realpathSync(path.dirname(values.private)), projectRoot = path.resolve(__dirname, '..');
  if (privateParent === projectRoot || privateParent.startsWith(projectRoot + path.sep)) throw new Error('Keep the private signing key outside the project so it cannot enter a customer build.');
  if (command === 'keys' && (!path.isAbsolute(values.public || '') || values.public === values.private || fs.existsSync(values.public) || fs.existsSync(values.private))) throw new Error('Key output paths must be new, distinct absolute files.');
  const passphrase = await secret();
  if (passphrase.length < 12 || passphrase.trim().length < 12) throw new Error('Use a private-key passphrase of 12–128 characters.');
  if (command === 'keys' && process.stdin.isTTY) { process.stdout.write('Confirm the same passphrase. '); if (await secret() !== passphrase) throw new Error('Passphrases do not match. No keys were created.'); }
  if (command === 'keys') {
    const pair = generateKeyPairSync('ed25519', { publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase } });
    fs.writeFileSync(values.private, pair.privateKey, { flag: 'wx', mode: 0o600 });
    fs.writeFileSync(values.public, pair.publicKey, { flag: 'wx', mode: 0o644 });
    console.log('Issuer keys created. Bundle only the public key; keep the encrypted private key and passphrase off customer machines.');
  } else {
    const expiresAt = values.expires ? Date.parse(values.expires) : null;
    const invoiceLimit = values.limit ? Number(values.limit) : null;
    if (!/^[a-f0-9-]{36}$/.test(values.store || '') || !values.plan.trim() || values.plan.length > 80 || (expiresAt !== null && (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now())) || (invoiceLimit !== null && (!Number.isSafeInteger(invoiceLimit) || invoiceLimit < 1))) throw new Error('Enter a valid store activation ID, future expiry and positive invoice allowance.');
    const key = createPrivateKey({ key: fs.readFileSync(values.private), passphrase });
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('An Ed25519 issuer key is required.');
    const payload = Buffer.from(JSON.stringify({ version: 1, installationId: values.store, type: 'paid', plan: values.plan, expiresAt, invoiceLimit })).toString('base64url');
    console.log(payload + '.' + sign(null, Buffer.from(payload), key).toString('base64url'));
  }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
