import { PERMISSION } from './permission-codes';
import { ROLE_PERMISSIONS } from './role-permissions';
import { assertPermissionCatalogComplete } from './roles-catalog.util';

describe('role permissions', () => {
  it('lets commercial advisors use templates in Chats without exposing the Templates module', () => {
    expect(ROLE_PERMISSIONS.asesor_comercial).toContain(
      PERMISSION.TEMPLATES_SEND_FROM_CHAT,
    );
    expect(ROLE_PERMISSIONS.asesor_comercial).not.toContain(
      PERMISSION.TEMPLATES_LIST,
    );
  });

  it('keeps every permission represented in the admin roles catalog', () => {
    expect(() => assertPermissionCatalogComplete()).not.toThrow();
  });
});
