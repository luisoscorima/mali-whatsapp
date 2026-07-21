import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { AppConfigService } from '../config/app-config.service';

@Injectable()
export class CrmServiceTokenGuard implements CanActivate {
  constructor(private readonly config: AppConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const token = this.config.crmServiceToken;
    if (!token) {
      throw new UnauthorizedException(
        'CRM_SERVICE_TOKEN no configurado en el servidor',
      );
    }

    const req = context.switchToHttp().getRequest<Request>();
    const header = String(req.headers['x-crm-service-token'] ?? '').trim();
    const auth = String(req.headers.authorization ?? '').trim();
    const bearer = auth.toLowerCase().startsWith('bearer ')
      ? auth.slice(7).trim()
      : '';

    if (header === token || bearer === token) {
      return true;
    }

    throw new UnauthorizedException('Token de servicio CRM inválido');
  }
}
