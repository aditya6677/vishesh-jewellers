'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { createAccountRepository } = require('../lib/security/account-repository');
const { AccountService } = require('../lib/security/account-service');
const { hashPassword, verifyPassword } = require('../lib/security/passwords');
const { Role, Permission, hasPermission } = require('../lib/security/roles');

const PASSWORD = 'Test-only-password-2026';
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vj-auth-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const key = randomBytes(32).toString('base64'), file = path.join(dir, 'accounts.json');
  const repository = createAccountRepository(file, key);
  let time = 1_000_000;
  const service = new AccountService(repository, { now: () => time, idleMs: 1000, lifetimeMs: 5000 });
  const admin = service.setup({ username: 'Superadmin', name: 'Test Administrator', password: PASSWORD });
  const login = () => service.login({ username: 'superadmin', password: PASSWORD });
  return { file, key, service, repository, admin, login, advance: milliseconds => { time += milliseconds; } };
}

test('password hashing uses random salts, rejects weak passwords and compares securely', () => {
  for (const password of ['', '5512', ' '.repeat(20), 'x'.repeat(129)]) assert.throws(() => hashPassword(password), /12–128/);
  const one = hashPassword(PASSWORD), two = hashPassword(PASSWORD);
  assert.notEqual(one.salt, two.salt); assert.notEqual(one.hash, two.hash);
  assert.equal(verifyPassword(PASSWORD, one), true);
  assert.equal(verifyPassword('wrong password', one), false);
  assert.equal(verifyPassword(PASSWORD, { ...one, hash: 'bad' }), false);
});

test('first setup is one-time and accounts remain encrypted and separate from business data', t => {
  const f = fixture(t);
  assert.equal(f.admin.role, Role.SUPERADMIN); assert.equal('credential' in f.admin, false);
  assert.throws(() => f.service.setup({}), /already configured/);
  const raw = fs.readFileSync(f.file, 'utf8');
  assert.equal(JSON.parse(raw).algorithm, 'aes-256-gcm');
  assert.ok(!raw.includes(PASSWORD)); assert.ok(!raw.includes('superadmin'));
  assert.ok(f.repository.read().storeId);
  assert.equal(createAccountRepository(f.file, f.key).read().users[0].id, f.admin.id);
  assert.throws(() => createAccountRepository(f.file), /installation encryption key/);
  assert.throws(() => createAccountRepository(f.file, randomBytes(32).toString('base64')).read(), /could not be read or decrypted/);
  fs.writeFileSync(f.file, JSON.stringify({ format: 'vj-accounts-v1', storeId: 'tampered', users: [] }));
  assert.throws(() => f.repository.read(), /could not be read or decrypted/);
  assert.throws(() => f.service.setup({}), /could not be read or decrypted/);
});

test('sessions are hashed, logout revokes, and inactivity/absolute expiry are enforced', t => {
  const f = fixture(t), session = f.login();
  assert.equal(session.token.length, 64); assert.equal(f.service.sessions.has(session.token), false);
  assert.equal(f.service.current(session.token).id, f.admin.id);
  f.service.logout(session.token); assert.throws(() => f.service.current(session.token), /Sign in required/);
  const idle = f.login(); f.advance(1000); assert.throws(() => f.service.current(idle.token), /Sign in required/);
  const absolute = f.login();
  for (let i = 0; i < 5; i++) { f.advance(900); f.service.current(absolute.token); }
  f.advance(500); assert.throws(() => f.service.current(absolute.token), /Sign in required/);
});

test('failed logins are generic and rate-limited, with recovery after lockout', t => {
  const f = fixture(t);
  for (let i = 0; i < 5; i++) assert.throws(() => f.service.login({ username: 'superadmin', password: 'incorrect' }), /Incorrect user ID or password/);
  assert.throws(() => f.login(), error => error.statusCode === 429);
  assert.throws(() => f.service.login({ username: 'unknown', password: PASSWORD }), /Incorrect user ID or password/);
  f.advance(15 * 60_000); assert.equal(f.login().user.id, f.admin.id);
});

test('account access changes and password reset invalidate sessions without exposing credentials', t => {
  const f = fixture(t), admin = f.login();
  const staff = f.service.createUser(admin.token, { username: 'staff.one', name: 'Test Staff', role: Role.STAFF, password: PASSWORD });
  assert.equal(staff.mustChangePassword, true); assert.equal('credential' in staff, false);
  assert.throws(() => f.service.createUser(admin.token, { username: 'STAFF.ONE', name: 'Duplicate', role: Role.STAFF, password: PASSWORD }), /already exists/);
  let session = f.service.login({ username: 'staff.one', password: PASSWORD });
  assert.throws(() => f.service.current(session.token), /temporary password/);
  f.service.changePassword(session.token, PASSWORD, 'Changed-staff-password-2026');
  assert.throws(() => f.service.current(session.token), /Sign in required/);
  session = f.service.login({ username: 'staff.one', password: 'Changed-staff-password-2026' });
  assert.throws(() => f.service.createUser(session.token, {}), error => error.statusCode === 403);
  f.service.resetPassword(admin.token, staff.id, 'Temporary-reset-password-2026');
  assert.throws(() => f.service.current(session.token), /Sign in required/);
  f.service.setAccess(admin.token, staff.id, { active: false, role: Role.STAFF });
  assert.throws(() => f.service.login({ username: 'staff.one', password: 'Temporary-reset-password-2026' }), /Incorrect user ID or password/);
  assert.throws(() => f.service.setAccess(admin.token, f.admin.id, { active: false, role: Role.SUPERADMIN }), /at least one active/);
});

test('role permissions deny unknown roles and permissions by default', () => {
  assert.equal(hasPermission(Role.SUPERADMIN, Permission.MANAGE_USERS), true);
  assert.equal(hasPermission(Role.OWNER, Permission.MANAGE_USERS), true);
  assert.equal(hasPermission(Role.STAFF, Permission.MANAGE_USERS), false);
  assert.equal(hasPermission('unknown', Permission.MANAGE_USERS), false);
  assert.equal(hasPermission('__proto__', Permission.MANAGE_USERS), false);
  assert.equal(hasPermission('toString', Permission.MANAGE_USERS), false);
  assert.equal(hasPermission(Role.SUPERADMIN, 'unknown.permission'), false);
});

test('owner cannot create or alter privileged accounts, and persistence failures do not change access', t => {
  const f = fixture(t), root = f.login();
  const owner = f.service.createUser(root.token, { username: 'store.owner', name: 'Test Owner', role: Role.OWNER, password: PASSWORD });
  let session = f.service.login({ username: owner.username, password: PASSWORD });
  f.service.changePassword(session.token, PASSWORD, 'Owner-changed-password-2026');
  session = f.service.login({ username: owner.username, password: 'Owner-changed-password-2026' });
  assert.throws(() => f.service.createUser(session.token, { username: 'escalated', name: 'Denied', role: Role.SUPERADMIN, password: PASSWORD }), error => error.statusCode === 403);
  assert.throws(() => f.service.resetPassword(session.token, f.admin.id, PASSWORD), error => error.statusCode === 403);
  const before = fs.readFileSync(f.file, 'utf8'), originalWrite = f.repository.write;
  f.repository.write = () => { throw Error('Disk full'); };
  assert.throws(() => f.service.setAccess(root.token, owner.id, { active: false, role: Role.STAFF }), /Disk full/);
  assert.equal(fs.readFileSync(f.file, 'utf8'), before);
  assert.equal(f.service.current(session.token).role, Role.OWNER);
  f.repository.write = originalWrite;
});
