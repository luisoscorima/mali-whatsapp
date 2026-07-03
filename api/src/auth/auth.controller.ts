import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { LoginDto } from './dto/login.dto';
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
  ): Promise<ApiResponse<{ accessToken: string; user: AuthUser }>> {
    if (!this.config.requireAuth) {
      const user = this.authService.getDevUser();
      return {
        ok: true,
        data: { accessToken: 'dev', user },
      };
    }

    const result = await this.authService.login(body.email, body.password);
    return { ok: true, data: result };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthUser): ApiResponse<AuthUser> {
    return { ok: true, data: user };
  }
}
