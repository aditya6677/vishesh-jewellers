'use strict';

const Role = Object.freeze({ SUPERADMIN: 'superadmin', OWNER: 'owner', ADMIN: 'admin', STAFF: 'staff' });
const Permission = Object.freeze({ MANAGE_USERS: 'users.manage', MANAGE_ROLES: 'roles.manage' });
const accountPermissions = Object.freeze({
  [Role.SUPERADMIN]: Object.freeze(Object.values(Permission)),
  [Role.OWNER]: Object.freeze([Permission.MANAGE_USERS]),
  [Role.ADMIN]: Object.freeze([]),
  [Role.STAFF]: Object.freeze([])
});
function hasPermission(role, permission) {
  return Object.hasOwn(accountPermissions, role) && accountPermissions[role].includes(permission);
}
module.exports = { Role, Permission, hasPermission };
