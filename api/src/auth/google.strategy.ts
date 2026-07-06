import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-google-oauth20';
import { AppConfigService } from '../config/app-config.service';
import { AuthService } from './auth.service';

type GoogleProfile = {
  id: string;
  emails?: { value: string }[];
  displayName?: string;
  photos?: { value: string }[];
  _json?: { hd?: string };
};

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(
    config: AppConfigService,
    private readonly authService: AuthService,
  ) {
    super({
      clientID: config.googleClientId || 'not-configured',
      clientSecret: config.googleClientSecret || 'not-configured',
      callbackURL:
        config.googleCallbackUrl || 'http://127.0.0.1/api/auth/google/callback',
      scope: ['email', 'profile'],
      // Workspace: restringe selector de cuenta a @mali.pe
      ...(config.allowedDomain ? { hd: config.allowedDomain } : {}),
    });
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: GoogleProfile,
  ) {
    return this.authService.validateGoogleProfile(profile);
  }
}
