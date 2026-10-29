'use strict';
const Menu = Object.freeze({ DASHBOARD: 'dashboard', INVOICES: 'invoices', RECORDS: 'records', STOCKS: 'stocks', PURCHASES: 'purchases', PAYMENTS: 'payments', SETTINGS: 'settings', USERS: 'users' });
const actions = Object.freeze({ dashboard: ['view', 'export'], invoices: ['view', 'create', 'edit', 'void', 'delete', 'deliver'], records: ['view', 'settle', 'export'], stocks: ['view', 'create', 'edit', 'delete'], purchases: ['view', 'create', 'edit', 'delete'], payments: ['view', 'create', 'edit', 'delete'], settings: ['view', 'backup', 'restore', 'export', 'branding'], users: ['view', 'manage', 'roles'] });
const BusinessPermission = Object.freeze(Object.fromEntries(Object.entries(actions).flatMap(([menu, list]) => list.map(action => [(menu + '_' + action).toUpperCase(), menu + '.' + action]))));
const all = Object.freeze(Object.values(BusinessPermission));
const defaults = Object.freeze({
  superadmin: all,
  owner: Object.freeze(all.filter(value => value !== 'users.roles')),
  admin: Object.freeze(all.filter(value => !['users.manage', 'users.roles', 'settings.restore'].includes(value))),
  staff: Object.freeze(['invoices.view', 'invoices.create', 'records.view', 'stocks.view'])
});
function validatePermissions(values) {
  if (!Array.isArray(values) || values.length > all.length || new Set(values).size !== values.length || values.some(value => !all.includes(value))) throw new Error('Choose valid, unique permissions.');
  return [...values];
}
module.exports = { Menu, BusinessPermission, defaultBusinessPermissions: defaults, validatePermissions };
