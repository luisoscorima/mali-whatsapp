import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
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
    });
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: GoogleProfile,
    done: VerifyCallback,
  ) {
    try {
      const user = await this.authService.validateGoogleProfile(profile);
      done(null, user);
    } catch (error) {
      done(error as Error, undefined);
    }
  }
}
