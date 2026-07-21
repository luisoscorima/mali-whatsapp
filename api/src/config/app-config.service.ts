import { Injectable } from '@nestjs/common';
import { BUSINESS_AREAS } from './areas';

@Injectable()
export class AppConfigService {
  readonly requireAuth =
    String(process.env.REQUIRE_AUTH ?? 'false')
      .trim()
      .toLowerCase() === 'true';

  readonly devArea = String(process.env.DEV_AREA || 'ti').trim().toLowerCase();

  readonly jwtSecret =
    String(process.env.JWT_SECRET || '').trim() ||
    (this.requireAuth ? '' : 'dev-jwt-secret-not-for-production');

  readonly jwtExpiresIn = String(process.env.JWT_EXPIRES_IN || '7d').trim();

  readonly allowedDomain = String(
    process.env.ALLOWED_DOMAIN || 'mali.pe',
  ).trim();

  readonly googleClientId = String(process.env.GOOGLE_CLIENT_ID || '').trim();

  readonly googleClientSecret = String(
    process.env.GOOGLE_CLIENT_SECRET || '',
  ).trim();

  readonly googleCallbackUrl = String(
    process.env.GOOGLE_CALLBACK_URL || '',
  ).trim();

  readonly cookieDomain = String(process.env.COOKIE_DOMAIN || '').trim();

  readonly appBaseUrl = String(
    process.env.APP_BASE_URL || 'http://localhost:3000',
  )
    .trim()
    .replace(/\/$/, '');

  readonly authCookieName = 'mali_wa_token';

  readonly bootstrapAdminEmail = String(
    process.env.BOOTSTRAP_ADMIN_EMAIL || 'loscorima@mali.pe',
  )
    .trim()
    .toLowerCase();

  /** Shared secret for MALI ONE → CRM sync / audience APIs. */
  readonly crmServiceToken = String(
    process.env.CRM_SERVICE_TOKEN || '',
  ).trim();

  get googleAuthEnabled(): boolean {
    return Boolean(
      this.googleClientId &&
        this.googleClientSecret &&
        this.googleCallbackUrl,
    );
  }

  readonly businessAreas = [...BUSINESS_AREAS];

  assertJwtSecret(): void {
    if (!this.jwtSecret) {
      throw new Error('JWT_SECRET is required when REQUIRE_AUTH=true');
    }
  }

  /** Opciones compartidas al crear y borrar la cookie de sesión (Safari exige paridad). */
  authCookieOptions(): {
    httpOnly: true;
    secure: boolean;
    sameSite: 'lax';
    path: string;
    domain?: string;
  } {
    const isProduction =
      String(process.env.NODE_ENV || '').toLowerCase() === 'production';
    return {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      ...(this.cookieDomain ? { domain: this.cookieDomain } : {}),
    };
  }
}
