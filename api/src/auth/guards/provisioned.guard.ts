import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { AuthUser } from '../auth.types';

@Injectable()
export class ProvisionedGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    const user = request.user;
    if (!user) {
      return true;
    }
    if (user.isMaster || user.isProvisioned) {
      return true;
    }
    throw new ForbiddenException(
      'Tu cuenta aún no tiene acceso asignado. Contacta al administrador.',
    );
  }
}
