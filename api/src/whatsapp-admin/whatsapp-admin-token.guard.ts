import { timingSafeEqual } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AppConfigService } from '../config/app-config.service';

function sameSecret(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

@Injectable()
export class WhatsAppAdminTokenGuard implements CanActivate {
  constructor(private readonly config: AppConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.whatsappAdminServiceToken;
    if (!expected) {
      throw new UnauthorizedException(
        'WHATSAPP_ADMIN_SERVICE_TOKEN no configurado en el servidor',
      );
    }

    const request = context.switchToHttp().getRequest<Request>();
    const header = String(
      request.headers['x-whatsapp-admin-service-token'] || '',
    ).trim();
    const authorization = String(request.headers.authorization || '').trim();
    const bearer = authorization.toLowerCase().startsWith('bearer ')
      ? authorization.slice(7).trim()
      : '';
    if (
      (header && sameSecret(header, expected)) ||
      (bearer && sameSecret(bearer, expected))
    ) {
      return true;
    }
    throw new UnauthorizedException('Token de administración WhatsApp inválido');
  }
}

