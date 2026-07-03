import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AppConfigService } from '../config/app-config.service';
import {
  isValidMaliEmail,
  normalizeArea,
  normalizeEmail,
} from '../config/areas';
import { PrismaService } from '../prisma/prisma.service';
import { UserAreasService } from '../users/user-areas.service';
import type { AuthUser, JwtPayload } from './auth.types';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly userAreas: UserAreasService,
    private readonly config: AppConfigService,
  ) {}

  getDevUser(): AuthUser {
    return this.userAreas.getDevUser();
  }

  async login(
    emailInput: unknown,
    passwordInput: unknown,
  ): Promise<{ accessToken: string; user: AuthUser }> {
    this.config.assertJwtSecret();

    const email = normalizeEmail(emailInput);
    const password = String(passwordInput ?? '');

    if (!email || !password) {
      throw new UnauthorizedException('Correo y contraseña son obligatorios');
    }
    if (!isValidMaliEmail(email)) {
      throw new UnauthorizedException('Usa un correo @mali.pe');
    }

    const user = await this.prisma.users.findUnique({ where: { email } });
    if (!user) {
      throw new UnauthorizedException('Credenciales incorrectas');
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      throw new UnauthorizedException('Credenciales incorrectas');
    }

    const authUser = await this.buildAuthUser(user, user.area);
    const accessToken = await this.signToken(authUser);
    return { accessToken, user: authUser };
  }

  async validateJwtPayload(payload: JwtPayload): Promise<AuthUser> {
    const user = await this.prisma.users.findUnique({
      where: { id: payload.sub },
    });
    if (!user) {
      throw new UnauthorizedException('Usuario no encontrado');
    }

    return this.buildAuthUser(user, payload.area);
  }

  private async signToken(user: AuthUser): Promise<string> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      area: user.area,
    };
    return this.jwtService.signAsync(payload);
  }

  private async buildAuthUser(
    row: {
      id: number;
      email: string;
      area: string;
      is_master: boolean;
      must_change_password: boolean;
      can_edit_ai_prompt: boolean;
      can_view_audit_logs: boolean;
      can_view_integration: boolean;
      can_edit_business_hours: boolean;
      can_view_reports: boolean;
    },
    sessionArea: unknown,
  ): Promise<AuthUser> {
    const primaryArea = normalizeArea(row.area);
    const isMaster = Boolean(row.is_master);
    const allowedAreas = await this.userAreas.fetchAllowedAreasForUser({
      userId: row.id,
      primaryArea,
      isMaster,
    });
    const area = this.userAreas.resolveActiveArea(
      sessionArea,
      primaryArea,
      allowedAreas,
    );

    return {
      id: row.id,
      email: row.email,
      area,
      allowedAreas,
      isMaster,
      mustChangePassword: Boolean(row.must_change_password),
      canEditAiPrompt: Boolean(row.can_edit_ai_prompt),
      canViewAuditLogs: Boolean(row.can_view_audit_logs),
      canViewIntegration: Boolean(row.can_view_integration),
      canEditBusinessHours: Boolean(row.can_edit_business_hours),
      canViewReports: Boolean(row.can_view_reports),
    };
  }
}
