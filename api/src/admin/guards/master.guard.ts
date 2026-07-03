import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { AuthUser } from '../../auth/auth.types';

@Injectable()
export class MasterGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    if (!request.user?.isMaster) {
      throw new ForbiddenException('Solo administrador master');
    }
    return true;
  }
}
