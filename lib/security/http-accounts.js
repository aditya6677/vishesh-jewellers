'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { AsyncAccounts } = require('./async-accounts');
const { send, sendJson } = require('../http/response');
const { readJson } = require('../http/request');
const { BusinessPermission } = require('./business-permissions');
const failure = (message, statusCode) => Object.assign(new Error(message), { statusCode });
const tokenOf = req => /(?:^|;\s*)vj_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
function header(res, name, value) { if (res.header) res.header(name, value); else res.setHeader(name, value); }
function localRequest(req, mutate = false) {
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || '')) throw failure('Account access requires localhost.', 403);
  if (req.headers.origin && req.headers.origin !== 'http://' + req.headers.host) throw failure('Use this app to submit account requests.', 403);
  if (mutate && (!String(req.headers['content-type'] || '').startsWith('application/json') || req.headers['sec-fetch-site'] === 'cross-site')) throw failure('A same-origin JSON request is required.', 403);
}
function requiredPermissions(method, pathname) {
  const write = method !== 'GET';
  if (pathname === '/api/version') return [];
  if (pathname === '/api/branding') return [write ? 'settings.branding' : 'invoices.view|settings.view|dashboard.view|stocks.view|records.view|payments.view|purchases.view'];
  if (pathname === '/api/live-rates') return ['invoices.view|dashboard.view'];
  if (pathname === '/api/dashboard') return ['dashboard.view'];
  if (pathname.startsWith('/api/reports/')) return [pathname.includes('dashboard') ? 'dashboard.export' : 'records.export'];
  if (pathname === '/api/export.xlsx') return ['settings.export'];
  if (pathname.startsWith('/api/database-backup/')) return [pathname.endsWith('/activate') || pathname.endsWith('/prepare') || pathname.endsWith('/import') ? 'settings.restore' : 'settings.backup'];
  if (pathname.startsWith('/api/backup') || pathname === '/api/data-location') return [write ? 'settings.backup' : 'settings.view'];
  if (pathname.startsWith('/api/stocks')) return [write ? 'stocks.' + (method === 'DELETE' ? 'delete' : method === 'PUT' || pathname.endsWith('/batches') ? 'edit' : 'create') : 'stocks.view|invoices.view'];
  if (pathname.startsWith('/api/records')) return [write ? 'records.settle' : 'records.view|invoices.view'];
  if (pathname.startsWith('/api/invoices')) return [method === 'DELETE' ? 'invoices.delete' : pathname.endsWith('/void') ? 'invoices.void' : method === 'PUT' ? 'invoices.edit' : 'invoices.create'];
  for (const kind of ['payments', 'purchases']) if (pathname.startsWith('/api/' + kind)) return [kind + '.' + (!write ? 'view' : method === 'DELETE' ? 'delete' : method === 'PUT' ? 'edit' : 'create')];
  if (pathname.startsWith('/api/storage/')) {
    const key = decodeURIComponent(pathname.slice('/api/storage/'.length));
    if (write) return key === 'business-info' ? ['settings.branding'] : ['DENIED'];
    const permission = { 'stock-list': 'stocks.view|invoices.view', 'invoice-records': 'records.view|invoices.view', 'invoice-counter': 'invoices.view', 'items-master': 'invoices.view|stocks.view', 'business-info': 'invoices.view|settings.view', 'purchase-records': 'purchases.view', 'payment-records': 'payments.view', 'old-gold-records': 'dashboard.view' }[key];
    return [permission || 'DENIED'];
  }
  return ['DENIED'];
}
function installAccounts(router, { config, database, branding, license }) {
  if (!database) throw new Error('Username/password accounts require the encrypted database.');
  let accounts = new AsyncAccounts(config.databaseFile, database.databaseKey, config.storeId);
  const marker = config.databaseFile + '.accounts-enabled';
  const ready = accounts.ready.then(async () => {
    const status = await accounts.call('status');
    if (fs.existsSync(marker) && status.setupRequired) throw new Error('Account data is missing from this database. Restore an account-enabled backup; setup cannot reset existing ownership.');
    if (!status.setupRequired && !fs.existsSync(marker)) fs.writeFileSync(marker, '1', { flag: 'wx', mode: 0o600 });
    if (!status.setupRequired && license) license.beginTrial();
  });
  const html = () => fs.readFileSync(path.join(__dirname, 'account-page.html'), 'utf8');
  const add = router.add.bind(router);
  const attempts = []; // Global limiter supplements per-user login lockout in AccountService.
  add('GET', '/login', ({ res }) => send(res, 200, html(), 'text/html; charset=utf-8'));
  add('GET', '/accounts', async ({ req, res }) => { await ready; localRequest(req); try { await accounts.call('current', tokenOf(req), true); } catch { return send(res, 200, html(), 'text/html; charset=utf-8'); } send(res, 200, html(), 'text/html; charset=utf-8'); });
  add('GET', '/api/auth/status', async ({ req, res }) => {
    await ready; localRequest(req);
    const status = await accounts.call('status');
    let user = null, permissions = [];
    try { user = await accounts.call('current', tokenOf(req), true, false); if (!user.mustChangePassword) permissions = await accounts.call('permissions', tokenOf(req)); } catch { /* Logged out. */ }
    sendJson(res, 200, { ...status, user, permissions, branding: branding?.read(), license: license?.status(), availablePermissions: Object.values(BusinessPermission) });
  });
  add('GET', '/api/license', async ({ req, res }) => { await ready; localRequest(req); await accounts.call('current', tokenOf(req)); sendJson(res, 200, license ? license.status() : { state: 'disabled', message: 'Licensing is not enabled for this installation.' }); });
  add('POST', '/api/license/activate', async ({ req, res }) => {
    try { await ready; localRequest(req, true); const user = await accounts.call('current', tokenOf(req)); if (!['superadmin','owner'].includes(user.role)) throw failure('Only Superadmin or Owner can activate a paid plan.',403); if (!license) throw failure('Licensing is not enabled.',409); const input = await readJson(req,16384); sendJson(res,200,license.activate(input?.token)); }
    catch(error) { sendJson(res,error.statusCode || 400,{error:error.message}); }
  });
  for (const action of ['setup', 'login', 'logout', 'password', 'users', 'reset', 'access', 'roles', 'edit']) add('POST', '/api/auth/' + action, async ({ req, res }) => {
    try {
      await ready; localRequest(req, true);
      const input = await readJson(req, 16384), token = tokenOf(req);
      if (['login', 'setup'].includes(action)) {
        const now = Date.now(); while (attempts[0] < now - 60000) attempts.shift();
        if (attempts.length >= 20) throw failure('Too many account attempts. Wait one minute.', 429);
        attempts.push(now);
      }
      let result;
      if (action === 'setup') {
        if (input.password !== input.confirmPassword) throw failure('Passwords do not match.', 400);
        result = await accounts.call('setup', input);
        fs.writeFileSync(marker, '1', { flag: 'wx', mode: 0o600 });
        if (license) license.beginTrial();
      } else if (action === 'login') {
        result = await accounts.call('login', input);
        header(res, 'set-cookie', 'vj_session=' + result.token + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800');
        result = { user: result.user };
      } else if (action === 'logout') { await accounts.call('logout', token); header(res, 'set-cookie', 'vj_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); }
      else if (action === 'password') { await accounts.call('changePassword', token, input.currentPassword, input.password); header(res, 'set-cookie', 'vj_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); }
      else if (action === 'users') result = await accounts.call('createUser', token, input);
      else if (action === 'reset') result = await accounts.call('resetPassword', token, input.userId, input.password);
      else if (action === 'access') result = await accounts.call('setAccess', token, input.userId, input);
      else if (action === 'edit') result = await accounts.call('editUser', token, input.userId, input);
      else result = await accounts.call('setRolePermissions', token, input.role, input.permissions);
      sendJson(res, 200, { ok: true, result });
    } catch (error) { sendJson(res, error.statusCode || 400, { error: error.message }); }
  });
  for (const action of ['users', 'roles', 'audit']) add('GET', '/api/auth/' + action, async ({ req, res }) => { await ready; localRequest(req); sendJson(res, 200, await accounts.call(action === 'users' ? 'listUsers' : action === 'audit' ? 'auditList' : 'roles', tokenOf(req))); });
  router.add = (method, pattern, handler) => add(method, pattern, async context => {
    await ready;
    if (!pattern.startsWith('/api/') && !['/', '/index.html'].includes(pattern)) return handler(context);
    localRequest(context.req, method !== 'GET');
    let user;
    try { user = await accounts.call('current', tokenOf(context.req), false, pattern !== '/api/version'); }
    catch (error) { if (pattern === '/' || pattern === '/index.html') return send(context.res, 200, html(), 'text/html; charset=utf-8'); throw error; }
    const permissions = pattern === '/api/version' ? [] : await accounts.call('permissions', tokenOf(context.req));
    if (pattern.startsWith('/api/')) for (const required of requiredPermissions(method, context.url.pathname)) if (!required.split('|').some(value => permissions.includes(value))) throw failure('You do not have permission for this operation.', 403);
    if (method !== 'GET' && ['/api/branding', '/api/storage/business-info'].includes(context.url.pathname) && user.role !== 'superadmin') throw failure('Only Superadmin can change store branding.', 403);
    if (method === 'PUT' && /^\/api\/invoices\/[^/]+$/.test(context.url.pathname) && database.invoiceRepository.raw(decodeURIComponent(context.url.pathname.split('/').at(-1))).status === 'pending' && !permissions.includes('invoices.deliver')) throw failure('Order delivery permission is required.', 403);
    if (context.url.pathname === '/api/records' && context.url.searchParams.get('report') === '1' && !permissions.includes('records.export')) throw failure('Record export permission is required.', 403);
    if (license && method !== 'GET' && context.url.pathname !== '/api/invoices' && !['/api/database-backup/portable','/api/database-backup/verify','/api/database-backup/import','/api/database-backup/location','/api/backup/create'].includes(context.url.pathname)) license.assertWrite();
    context.req.accountSession = { user, permissions };
    const result = await handler(context);
    const code = context.res.statusCode || context.res.raw?.statusCode || 200;
    if (method !== 'GET' && code < 400 && !context.url.pathname.endsWith('/activate')) await accounts.call('audit', tokenOf(context.req), method + ' ' + context.url.pathname);
    return result;
  });
  const activate = database.activateRecovery.bind(database);
  database.activateRecovery = async (...args) => {
    license?.assertWrite();
    await accounts.close();
    try { return await activate(...args); }
    finally { accounts = new AsyncAccounts(config.databaseFile, database.databaseKey, config.storeId); await accounts.ready; }
  };
  return { ready, close: () => accounts.close() };
}
module.exports = { installAccounts, requiredPermissions };
