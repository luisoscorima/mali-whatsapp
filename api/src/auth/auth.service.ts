import { Injectable, UnauthorizedException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import * as bcrypt from 'bcryptjs';
import { AuditEvent } from '../audit/audit-events';
import { auditActor } from '../audit/audit-actor.util';
import { AuditLogService } from '../audit/audit-log.service';
import { AppConfigService } from '../config/app-config.service';
import {
  isValidBusinessArea,
  isValidMaliEmail,
  normalizeArea,
  normalizeEmail,
} from '../config/areas';
import { PrismaService } from '../prisma/prisma.service';
import { UserAreasService } from '../users/user-areas.service';
import type { AuthUser, JwtPayload } from './auth.types';
import {
  bootstrapAdminUserData,
  isBootstrapAdminEmail,
  newGoogleUserData,
  parseGoogleProfileNames,
} from './user-access.util';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly userAreas: UserAreasService,
    private readonly config: AppConfigService,
    private readonly auditLog: AuditLogService,
  ) {}

  getDevUser(): AuthUser {
    return this.userAreas.getDevUser();
  }

  async resolveSession(
    req: Request,
  ): Promise<{ authenticated: boolean; user?: AuthUser }> {
    if (!this.config.requireAuth) {
      return { authenticated: true, user: this.getDevUser() };
    }

    const cookieToken = req.cookies?.[this.config.authCookieName];
    const authHeader = req.headers.authorization;
    const bearer =
      typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : '';
    const token =
      (typeof cookieToken === 'string' ? cookieToken.trim() : '') || bearer;
    if (!token) {
      return { authenticated: false };
    }

    try {
      const payload = this.jwtService.verify<JwtPayload>(token);
      const user = await this.validateJwtPayload(payload);
      return { authenticated: true, user };
    } catch {
      return { authenticated: false };
    }
  }

  async login(
    emailInput: unknown,
    passwordInput: unknown,
    clientIp?: string | null,
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
      await this.auditLog.write({
        level: 'warn',
        event_type: AuditEvent.AUTH_LOGIN_FAILED,
        message: `Intento de login fallido: ${email}`,
        actor: { email, area: null },
        clientIp,
      });
      throw new UnauthorizedException('Credenciales incorrectas');
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      await this.auditLog.write({
        level: 'warn',
        event_type: AuditEvent.AUTH_LOGIN_FAILED,
        message: `Intento de login fallido: ${email}`,
        actor: { userId: user.id, email: user.email, area: user.area },
        clientIp,
      });
      throw new UnauthorizedException('Credenciales incorrectas');
    }

    const authUser = await this.buildAuthUser(user, user.area);
    const accessToken = await this.signToken(authUser);
    await this.auditLog.write({
      event_type: AuditEvent.AUTH_LOGIN,
      message: `Login: ${authUser.email}`,
      actor: auditActor(authUser),
      clientIp,
    });
    return { accessToken, user: authUser };
  }

  async validateGoogleProfile(profile: {
    id: string;
    emails?: { value: string }[];
    displayName?: string;
    name?: { givenName?: string; familyName?: string };
    photos?: { value: string }[];
    _json?: { hd?: string; given_name?: string; family_name?: string; name?: string };
  }): Promise<{
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
    can_assign_conversations: boolean;
    picture?: string;
  }> {
    this.config.assertJwtSecret();

    const email = normalizeEmail(profile.emails?.[0]?.value);
    const hd = profile._json?.hd;
    const allowedDomain = this.config.allowedDomain;

    if (!email || !email.endsWith(`@${allowedDomain}`)) {
      throw new ForbiddenException(`Solo cuentas @${allowedDomain}`);
    }
    // hd puede omitirse en algunos tokens; si viene, debe coincidir con Workspace
    if (hd && hd !== allowedDomain) {
      throw new ForbiddenException(`Solo cuentas @${allowedDomain}`);
    }

    const isBootstrap = isBootstrapAdminEmail(
      this.config.bootstrapAdminEmail,
      email,
    );
    const profileNames = parseGoogleProfileNames(profile);
    const existing = await this.prisma.users.findUnique({ where: { email } });

    if (existing) {
      const nameData = {
        first_name: profileNames.first_name,
        last_name: profileNames.last_name,
      };
      if (isBootstrap) {
        const updated = await this.prisma.users.update({
          where: { email },
          data: { ...bootstrapAdminUserData(), ...nameData },
        });
        return {
          ...updated,
          picture: profile.photos?.[0]?.value,
        };
      }
      const updated = await this.prisma.users.update({
        where: { email },
        data: nameData,
      });
      return { ...updated, picture: profile.photos?.[0]?.value };
    }

    const passwordHash = await bcrypt.hash(
      `google-oauth-${profile.id}-${Date.now()}`,
      10,
    );

    const created = await this.prisma.users.create({
      data: {
        email,
        ...newGoogleUserData(passwordHash),
        ...profileNames,
        ...(isBootstrap ? bootstrapAdminUserData() : {}),
      },
    });
    return { ...created, picture: profile.photos?.[0]?.value };
  }

  async loginWithGoogle(
    row: {
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
      can_assign_conversations?: boolean;
      picture?: string;
    },
    clientIp?: string | null,
  ): Promise<{ accessToken: string; user: AuthUser }> {
    const authUser = await this.buildAuthUser(row, row.area, row.picture);
    const accessToken = await this.signToken(authUser);
    await this.auditLog.write({
      event_type: AuditEvent.AUTH_LOGIN,
      message: `Login Google: ${authUser.email}`,
      actor: auditActor(authUser),
      clientIp,
    });
    return { accessToken, user: authUser };
  }

  signAccessToken(user: AuthUser): string {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      area: user.area,
      ...(user.picture ? { picture: user.picture } : {}),
    };
    return this.jwtService.sign(payload);
  }

  async validateJwtPayload(payload: JwtPayload): Promise<AuthUser> {
    const user = await this.prisma.users.findUnique({
      where: { id: payload.sub },
    });
    if (!user) {
      throw new UnauthorizedException('Usuario no encontrado');
    }

    return this.buildAuthUser(user, payload.area, payload.picture);
  }

  async switchArea(
    user: AuthUser,
    areaInput: string,
    clientIp?: string | null,
  ): Promise<{ accessToken: string; user: AuthUser }> {
    const area = normalizeArea(areaInput);
    if (!isValidBusinessArea(area)) {
      throw new BadRequestException('Área no válida');
    }
    if (!this.userAreas.canAccessArea(user, area)) {
      throw new ForbiddenException('No tienes acceso a esa área');
    }

    if (user.isMaster) {
      await this.prisma.users.update({
        where: { id: user.id },
        data: { area },
      });
    }

    const authUser = await this.buildAuthUser(
      await this.prisma.users.findUniqueOrThrow({ where: { id: user.id } }),
      area,
      user.picture,
    );
    const accessToken = await this.signToken(authUser);

    await this.auditLog.write({
      event_type: AuditEvent.ADMIN_SWITCH_AREA,
      message: `Cambió el área de trabajo a ${area}`,
      actor: auditActor(user),
      clientIp,
      meta: { new_area: area },
    });

    return { accessToken, user: authUser };
  }

  async changePassword(
    user: AuthUser,
    input: {
      current_password: string;
      new_password: string;
      confirm_password: string;
    },
    clientIp?: string | null,
  ): Promise<{ accessToken: string; user: AuthUser }> {
    if (!user.mustChangePassword) {
      throw new BadRequestException(
        'No es necesario cambiar la contraseña en este momento',
      );
    }

    const currentPassword = String(input.current_password || '');
    const newPassword = String(input.new_password || '');
    const confirm = String(input.confirm_password || '');

    if (!currentPassword || !newPassword || !confirm) {
      throw new BadRequestException('Completa todos los campos');
    }
    if (newPassword.length < 6) {
      throw new BadRequestException(
        'La nueva contraseña debe tener al menos 6 caracteres',
      );
    }
    if (newPassword !== confirm) {
      throw new BadRequestException(
        'La nueva contraseña y la confirmación no coinciden',
      );
    }
    if (newPassword === currentPassword) {
      throw new BadRequestException(
        'La nueva contraseña debe ser distinta a la actual',
      );
    }

    const row = await this.prisma.users.findUnique({ where: { id: user.id } });
    if (!row) {
      throw new UnauthorizedException('Usuario no encontrado');
    }

    const ok = await bcrypt.compare(currentPassword, row.password_hash);
    if (!ok) {
      throw new BadRequestException('La contraseña actual no es correcta');
    }

    const hash = await bcrypt.hash(newPassword, 10);
    const updated = await this.prisma.users.update({
      where: { id: user.id },
      data: { password_hash: hash, must_change_password: false },
    });

    await this.auditLog.write({
      event_type: AuditEvent.AUTH_PASSWORD_CHANGE,
      message: `Contraseña cambiada: ${updated.email}`,
      actor: {
        userId: updated.id,
        email: updated.email,
        area: user.area,
      },
      clientIp,
    });

    const authUser = await this.buildAuthUser(updated, user.area);
    const accessToken = await this.signToken(authUser);
    return { accessToken, user: authUser };
  }

  private async signToken(user: AuthUser): Promise<string> {
    return this.signAccessToken(user);
  }

  private async buildAuthUser(
    row: {
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
      can_assign_conversations?: boolean;
    },
    sessionArea: unknown,
    picture?: string,
  ): Promise<AuthUser> {
    const primaryArea = normalizeArea(row.area);
    const isBootstrapAdmin = isBootstrapAdminEmail(
      this.config.bootstrapAdminEmail,
      row.email,
    );
    let isMaster = Boolean(row.is_master);
    let isProvisioned = Boolean(row.is_provisioned);

    if (isBootstrapAdmin) {
      isMaster = true;
      isProvisioned = true;
    }

    const allowedAreas = isProvisioned
      ? await this.userAreas.fetchAllowedAreasForUser({
          userId: row.id,
          primaryArea,
          isMaster,
        })
      : [];
    const area = isProvisioned
      ? this.userAreas.resolveActiveArea(
          sessionArea,
          primaryArea,
          allowedAreas,
        )
      : primaryArea;

    return {
      id: row.id,
      email: row.email,
      area,
      allowedAreas,
      isMaster,
      isProvisioned,
      isBootstrapAdmin,
      mustChangePassword: Boolean(row.must_change_password),
      canEditAiPrompt:
        isBootstrapAdmin || isMaster || Boolean(row.can_edit_ai_prompt),
      canViewAuditLogs:
        isBootstrapAdmin || isMaster || Boolean(row.can_view_audit_logs),
      canViewIntegration:
        isBootstrapAdmin || isMaster || Boolean(row.can_view_integration),
      canEditBusinessHours:
        isBootstrapAdmin || isMaster || Boolean(row.can_edit_business_hours),
      canViewReports:
        isBootstrapAdmin || isMaster || Boolean(row.can_view_reports),
      canAssignConversations:
        isBootstrapAdmin || isMaster || Boolean(row.can_assign_conversations),
      ...(picture ? { picture } : {}),
    };
  }
}
