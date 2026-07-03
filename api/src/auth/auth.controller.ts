import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppConfigService } from '../config/app-config.service';
import { readClientIp } from '../audit/audit-log.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthService } from './auth.service';
import type { ApiResponse, AuthUser } from './auth.types';

@Controller()
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: AppConfigService,
  ) {}

  @Post('auth/login')
  async login(
    @Body() body: LoginDto,
    @Req() req: Request,
  ): Promise<ApiResponse<{ accessToken: string; user: AuthUser }>> {
    if (!this.config.requireAuth) {
      const user = this.authService.getDevUser();
      return {
        ok: true,
        data: { accessToken: 'dev', user },
      };
    }

    const result = await this.authService.login(
      body.email,
      body.password,
      readClientIp(req),
    );
    return { ok: true, data: result };
  }

  @Get('auth/config')
  authConfig(): ApiResponse<{ googleEnabled: boolean }> {
    return {
      ok: true,
      data: { googleEnabled: this.config.googleAuthEnabled },
    };
  }

  @Get('auth/google')
  @UseGuards(GoogleAuthGuard)
  googleAuth() {
    return;
  }

  @Get('auth/google/callback')
  @UseGuards(GoogleAuthGuard)
  async googleCallback(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const row = req.user as {
      id: number;
      email: string;
      area: string;
      is_master: boolean;
      is_provisioned: boolean;
      must_change_password: boolean;
      can_edit_ai_prompt: boolean;
      can_view_audit_logs: boolean;
      can_view_integration: boolean;
      can_edit_business_hours: boolean;
      can_view_reports: boolean;
    } | null;
    if (!row) {
      return;
    }

    const { accessToken, user } = await this.authService.loginWithGoogle(
      row,
      readClientIp(req),
    );
    const isProduction =
      String(process.env.NODE_ENV || '').toLowerCase() === 'production';

    res.cookie(this.config.authCookieName, accessToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      domain: this.config.cookieDomain || undefined,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });

    const target = user.mustChangePassword
      ? `${this.config.appBaseUrl}/account/change-password`
      : `${this.config.appBaseUrl}/`;
    res.redirect(target);
  }

  @Post('auth/logout')
  logout(@Res({ passthrough: true }) res: Response): ApiResponse<{ ok: true }> {
    res.clearCookie(this.config.authCookieName, {
      httpOnly: true,
      path: '/',
      domain: this.config.cookieDomain || undefined,
    });
    return { ok: true, data: { ok: true } };
  }

  @Post('auth/change-password')
  @UseGuards(JwtAuthGuard)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() body: ChangePasswordDto,
    @Req() req: Request,
  ): Promise<ApiResponse<{ accessToken: string; user: AuthUser }>> {
    const data = await this.authService.changePassword(
      user,
      body,
      readClientIp(req),
    );
    return { ok: true, data };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthUser): ApiResponse<AuthUser> {
    return { ok: true, data: user };
  }
}
