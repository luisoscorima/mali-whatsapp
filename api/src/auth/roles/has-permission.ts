import { ForbiddenException } from '@nestjs/common';
import type { AuthUser } from '../auth.types';
import type { PermissionCode } from './permission-codes';

export function hasPermission(
  user: Pick<AuthUser, 'permissions' | 'isMaster' | 'isBootstrapAdmin'>,
  code: PermissionCode,
): boolean {
  if (user.isBootstrapAdmin || user.isMaster) return true;
  return user.permissions.includes(code);
}

export function assertPermission(
  user: Pick<AuthUser, 'permissions' | 'isMaster' | 'isBootstrapAdmin'>,
  code: PermissionCode,
  message?: string,
): void {
  if (!hasPermission(user, code)) {
    throw new ForbiddenException(
      message || 'No tienes permiso para esta acción',
    );
  }
}
