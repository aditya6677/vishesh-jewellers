'use strict';

const { randomBytes, randomUUID, createHash } = require('node:crypto');
const { hashPassword, verifyPassword } = require('./passwords');
const { Role, Permission, hasPermission } = require('./roles');

const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
const digest = token => createHash('sha256').update(token).digest('hex');
const publicUser = user => ({ id: user.id, username: user.username, name: user.name, role: user.role, active: user.active, mustChangePassword: user.mustChangePassword });
function username(value) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._-]{2,63}$/i.test(value.trim())) fail('User ID must be 3–64 letters, numbers, dots, underscores or hyphens.');
  return value.trim().toLowerCase();
}

class AccountService {
  constructor(repository, { now = Date.now, idleMs = 30 * 60_000, lifetimeMs = 8 * 60 * 60_000 } = {}) {
    this.repository = repository;
    this.now = now;
    this.idleMs = idleMs;
    this.lifetimeMs = lifetimeMs;
    this.sessions = new Map();
    this.attempts = new Map();
    this.dummyCredential = hashPassword(randomBytes(32).toString('base64'));
  }

  setup(input) {
    const data = this.repository.read();
    if (data.users.length) fail('Initial administrator is already configured.', 409);
    const user = this.newUser(input, Role.SUPERADMIN);
    this.repository.write({ ...data, storeId: randomUUID(), users: [user] });
    return publicUser(user);
  }
  status() { return { setupRequired: this.repository.read().users.length === 0 }; }
  listUsers(token) {
    const actor = this.current(token);
    if (!hasPermission(actor.role, Permission.MANAGE_USERS) || (this.repository.permissions && !this.repository.permissions(actor.role).includes('users.manage'))) fail('Access denied.', 403);
    return this.repository.read().users.map(publicUser);
  }
  permissions(token) {
    const actor = this.current(token);
    return this.repository.permissions ? this.repository.permissions(actor.role) : [];
  }
  roles(token) {
    const actor = this.current(token);
    if (actor.role !== Role.SUPERADMIN) fail('Only Superadmin can manage role permissions.', 403);
    return this.repository.roles();
  }
  audit(token, action) {
    const actor = this.current(token);
    if (typeof action !== 'string' || action.length > 500) fail('Invalid audit action.');
    this.repository.audit?.(JSON.stringify({ actorId: actor.id, action }));
  }
  auditList(token) {
    const actor = this.current(token);
    if (!['superadmin', 'owner'].includes(actor.role)) fail('Access denied.', 403);
    return this.repository.auditList();
  }
  setRolePermissions(token, role, permissions) {
    const actor = this.current(token);
    if (actor.role !== Role.SUPERADMIN || role === Role.SUPERADMIN) fail('Only Superadmin can change non-Superadmin role permissions.', 403);
    this.repository.setRolePermissions(role, permissions);
    for (const user of this.repository.read().users) if (user.role === role) this.revoke(user.id);
  }

  newUser(input, role) {
    const id = username(input?.username);
    const name = typeof input?.name === 'string' ? input.name.trim() : '';
    if (!name || name.length > 100) fail('Enter a display name up to 100 characters.');
    if (!Object.values(Role).includes(role)) fail('Choose a valid role.');
    return { id: randomUUID(), username: id, name, role, active: true, mustChangePassword: false, credential: hashPassword(input.password), createdAt: new Date(this.now()).toISOString() };
  }

  login(input) {
    let id;
    try { id = username(input?.username); } catch (_) { id = '<invalid>'; }
    const now = this.now();
    const attempt = this.repository.getAttempt ? this.repository.getAttempt(id) : this.attempts.get(id);
    if (attempt && now < attempt.blockedUntil) fail('Too many attempts. Try again in 15 minutes.', 429);
    const user = this.repository.read().users.find(user => user.username === id);
    const verified = verifyPassword(input?.password, user?.credential || this.dummyCredential);
    if (!user?.active || !verified) {
      if (this.attempts.size >= 1000 && !this.attempts.has(id)) this.attempts.delete(this.attempts.keys().next().value);
      const count = attempt && now - attempt.last < 15 * 60_000 ? attempt.count + 1 : 1;
      this.attempts.set(id, { count, last: now, blockedUntil: count >= 5 ? now + 15 * 60_000 : 0 });
      this.repository.saveAttempt?.(id, this.attempts.get(id));
      fail('Incorrect user ID or password.', 401);
    }
    this.attempts.delete(id);
    this.repository.saveAttempt?.(id, null);
    for (const [key, session] of this.sessions) if (now >= session.expires || now - session.last >= this.idleMs) this.sessions.delete(key);
    if (this.sessions.size >= 1000) fail('Session limit reached. Sign out of another session.', 429);
    const token = randomBytes(32).toString('hex');
    this.sessions.set(digest(token), { userId: user.id, last: now, expires: now + this.lifetimeMs });
    return { token, user: publicUser(user), expiresAt: new Date(now + this.lifetimeMs).toISOString() };
  }

  current(token, allowPasswordChange = false, touch = true) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) fail('Sign in required.', 401);
    const key = digest(token), session = this.sessions.get(key), now = this.now();
    if (!session || now >= session.expires || now - session.last >= this.idleMs) { this.sessions.delete(key); fail('Sign in required.', 401); }
    const user = this.repository.read().users.find(user => user.id === session.userId);
    if (!user?.active) { this.sessions.delete(key); fail('Sign in required.', 401); }
    if (user.mustChangePassword && !allowPasswordChange) fail('Change your temporary password first.', 403);
    if (touch) session.last = now;
    return publicUser(user);
  }

  logout(token) { if (typeof token === 'string') this.sessions.delete(digest(token)); }
  revoke(userId) { for (const [key, session] of this.sessions) if (session.userId === userId) this.sessions.delete(key); }

  manager(token, targetRole) {
    const actor = this.current(token);
    if (!hasPermission(actor.role, Permission.MANAGE_USERS) || (this.repository.permissions && !this.repository.permissions(actor.role).includes('users.manage'))) fail('Access denied.', 403);
    if (actor.role !== Role.SUPERADMIN && ![Role.ADMIN, Role.STAFF].includes(targetRole)) fail('Only Superadmin can manage owner or Superadmin accounts.', 403);
    return actor;
  }

  createUser(token, input) {
    this.manager(token, input?.role);
    const data = this.repository.read(), user = this.newUser(input, input.role);
    if (data.users.some(item => item.username === user.username)) fail('User ID already exists.', 409);
    user.mustChangePassword = true;
    this.repository.write({ ...data, users: [...data.users, user] });
    return publicUser(user);
  }

  resetPassword(token, userId, password) {
    const data = this.repository.read(), user = data.users.find(item => item.id === userId);
    if (!user) fail('User not found.', 404);
    this.manager(token, user.role);
    user.credential = hashPassword(password); user.mustChangePassword = true;
    this.repository.write(data); this.revoke(user.id);
    return publicUser(user);
  }
  editUser(token, userId, input) {
    const data = this.repository.read(), user = data.users.find(item => item.id === userId);
    if (!user) fail('User not found.', 404);
    this.manager(token, user.role);
    const id = username(input?.username), name = typeof input?.name === 'string' ? input.name.trim() : '';
    if (!name || name.length > 100) fail('Enter a display name up to 100 characters.');
    if (data.users.some(item => item.id !== user.id && item.username === id)) fail('User ID already exists.', 409);
    user.username = id; user.name = name;
    this.repository.write(data); this.revoke(user.id);
    return publicUser(user);
  }

  changePassword(token, currentPassword, nextPassword) {
    const identity = this.current(token, true);
    const data = this.repository.read(), user = data.users.find(item => item.id === identity.id);
    if (!verifyPassword(currentPassword, user.credential)) fail('Current password is incorrect.', 401);
    if (verifyPassword(nextPassword, user.credential)) fail('Choose a different new password.');
    user.credential = hashPassword(nextPassword); user.mustChangePassword = false;
    this.repository.write(data); this.revoke(user.id);
  }

  setAccess(token, userId, { active, role }) {
    const data = this.repository.read(), user = data.users.find(item => item.id === userId);
    if (!user) fail('User not found.', 404);
    this.manager(token, user.role); this.manager(token, role);
    if (typeof active !== 'boolean' || !Object.values(Role).includes(role)) fail('Choose valid access settings.');
    if (user.role === Role.SUPERADMIN && (!active || role !== Role.SUPERADMIN) && !data.users.some(item => item.id !== user.id && item.active && item.role === Role.SUPERADMIN)) fail('Keep at least one active Superadmin.');
    user.active = active; user.role = role;
    this.repository.write(data); this.revoke(user.id);
    return publicUser(user);
  }
}
module.exports = { AccountService };
