import {
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AppConfigService } from '../../config/app-config.service';

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  constructor(private readonly config: AppConfigService) {
    super();
  }

  canActivate(context: ExecutionContext) {
    if (!this.config.googleAuthEnabled) {
      throw new ServiceUnavailableException('Google OAuth no configurado');
    }
    return super.canActivate(context);
  }

  handleRequest<TUser>(
    err: Error | null,
    user: TUser | false,
    _info: unknown,
    context: ExecutionContext,
  ): TUser {
    const res = context.switchToHttp().getResponse<{ redirect: (url: string) => void }>();
    if (err || !user) {
      const infoMessage =
        typeof info === 'object' &&
        info !== null &&
        'message' in info &&
        typeof (info as { message: unknown }).message === 'string'
          ? (info as { message: string }).message
          : '';
      const message = encodeURIComponent(
        err?.message || infoMessage || 'No se pudo iniciar sesión con Google',
      );
      res.redirect(`${this.config.appBaseUrl}/login?error=${message}`);
      return null as TUser;
    }
    return user;
  }
}
