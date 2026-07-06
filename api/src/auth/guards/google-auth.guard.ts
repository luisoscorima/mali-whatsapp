import {
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
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
    info: unknown,
    context: ExecutionContext,
  ): TUser {
    const res = context.switchToHttp().getResponse<{
      headersSent: boolean;
      redirect: (url: string) => void;
    }>();
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
      if (!res.headersSent) {
        res.redirect(`${this.config.appBaseUrl}/login?error=${message}`);
      }
      throw new UnauthorizedException('Google OAuth');
    }
    return user;
  }
}
