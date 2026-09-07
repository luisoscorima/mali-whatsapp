import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import type { AuthUser } from '../auth/auth.types';
import {
  isRoleSlug,
  legacyFlagsFromPermissions,
  permissionsForRole,
  type RoleSlug,
} from '../auth/roles';
import { AuditEvent } from '../audit/audit-events';
import { AuditLogService } from '../audit/audit-log.service';
import {
  isValidBusinessArea,
  isValidMaliEmail,
  normalizeArea,
  normalizeEmail,
  type BusinessArea,
} from '../config/areas';
import { PrismaService } from '../prisma/prisma.service';
import { UserAreasService } from '../users/user-areas.service';
import type {
  AdminOnlineUsersResult,
  AdminUserDetail,
  AdminUserListItem,
} from './admin.types';
import type { CreateAdminUserDto, UpdateAdminUserDto } from './dto/admin.dto';

/** Misma ventana que login_logs / middleware last_seen (legacy). */
const ONLINE_USER_IDLE_MINUTES = 5;

function mapUserRow(row: {
  id: number;
  email: string;
  area: string;
  role_slug: string | null;
  is_master: boolean;
  must_change_password: boolean;
  created_at: Date;
  can_edit_ai_prompt: boolean;
  can_view_audit_logs: boolean;
  can_view_integration: boolean;
  can_edit_business_hours: boolean;
  can_view_reports: boolean;
  can_assign_conversations: boolean;
  can_manage_attributes: boolean;
  can_manage_segments: boolean;
  can_view_conversation_stats: boolean;
  can_view_campaign_stats: boolean;
  can_manage_leads: boolean;
}): AdminUserListItem {
  return {
    id: row.id,
    email: row.email,
    area: row.area,
    role_slug: row.role_slug,
    is_master: row.is_master,
    must_change_password: row.must_change_password,
    created_at: row.created_at.toISOString(),
    can_edit_ai_prompt: row.can_edit_ai_prompt,
    can_view_audit_logs: row.can_view_audit_logs,
    can_view_integration: row.can_view_integration,
    can_edit_business_hours: row.can_edit_business_hours,
    can_view_reports: row.can_view_reports,
    can_assign_conversations: row.can_assign_conversations,
    can_manage_attributes: row.can_manage_attributes,
    can_manage_segments: row.can_manage_segments,
    can_view_conversation_stats: row.can_view_conversation_stats,
    can_view_campaign_stats: row.can_view_campaign_stats,
    can_manage_leads: row.can_manage_leads,
  };
}

function resolveRoleAndFlags(input: {
  is_master?: boolean;
  role_slug?: string | null;
  can_edit_ai_prompt?: boolean;
  can_view_audit_logs?: boolean;
  can_view_integration?: boolean;
  can_edit_business_hours?: boolean;
  can_view_reports?: boolean;
  can_assign_conversations?: boolean;
  can_manage_attributes?: boolean;
  can_manage_segments?: boolean;
  can_view_conversation_stats?: boolean;
  can_view_campaign_stats?: boolean;
  can_manage_leads?: boolean;
}): {
  role_slug: string | null;
  is_master: boolean;
  flags: ReturnType<typeof legacyFlagsFromPermissions>;
} {
  const isMaster = Boolean(input.is_master);
  if (isMaster) {
    return {
      role_slug: 'master',
      is_master: true,
      flags: legacyFlagsFromPermissions(permissionsForRole('master')),
    };
  }
  if (isRoleSlug(input.role_slug)) {
    const role = input.role_slug as RoleSlug;
    return {
      role_slug: role,
      is_master: role === 'master',
      flags: legacyFlagsFromPermissions(permissionsForRole(role)),
    };
  }
  return {
    role_slug: null,
    is_master: false,
    flags: {
      can_edit_ai_prompt: Boolean(input.can_edit_ai_prompt),
      can_view_audit_logs: Boolean(input.can_view_audit_logs),
      can_view_integration: Boolean(input.can_view_integration),
      can_edit_business_hours: Boolean(input.can_edit_business_hours),
      can_view_reports: Boolean(input.can_view_reports),
      can_assign_conversations: Boolean(input.can_assign_conversations),
      can_manage_attributes: Boolean(input.can_manage_attributes),
      can_manage_segments: Boolean(input.can_manage_segments),
      can_view_conversation_stats: Boolean(input.can_view_conversation_stats),
      can_view_campaign_stats: Boolean(input.can_view_campaign_stats),
      can_manage_leads: Boolean(input.can_manage_leads),
    },
  };
}

const USER_SELECT = {
  id: true,
  email: true,
  area: true,
  role_slug: true,
  is_master: true,
  must_change_password: true,
  created_at: true,
  can_edit_ai_prompt: true,
  can_view_audit_logs: true,
  can_view_integration: true,
  can_edit_business_hours: true,
  can_view_reports: true,
  can_assign_conversations: true,
  can_manage_attributes: true,
  can_manage_segments: true,
  can_view_conversation_stats: true,
  can_view_campaign_stats: true,
  can_manage_leads: true,
} as const;

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userAreas: UserAreasService,
    private readonly auditLog: AuditLogService,
  ) {}

  async listOnlineUsers(): Promise<AdminOnlineUsersResult> {
    const rows = await this.prisma.$queryRaw<{ email: string }[]>`
      SELECT email
      FROM login_logs
      WHERE logged_out_at IS NULL
        AND COALESCE(last_seen_at, logged_at) >= NOW() - (${ONLINE_USER_IDLE_MINUTES}::int * INTERVAL '1 minute')
      GROUP BY email
      ORDER BY email ASC
    `;
    return {
      users: rows,
      idle_minutes: ONLINE_USER_IDLE_MINUTES,
    };
  }

  async list(): Promise<AdminUserListItem[]> {
    const rows = await this.prisma.users.findMany({
      orderBy: { email: 'asc' },
      select: USER_SELECT,
    });
    return rows.map(mapUserRow);
  }

  async getById(id: number): Promise<AdminUserDetail> {
    const row = await this.prisma.users.findUnique({
      where: { id },
      select: USER_SELECT,
    });
    if (!row) throw new NotFoundException('Usuario no encontrado');
    const extraAreas = await this.userAreas.fetchExtraAreasForUser(id);
    return { ...mapUserRow(row), extra_areas: extraAreas };
  }

  async create(
    dto: CreateAdminUserDto,
    actor?: AuthUser,
  ): Promise<AdminUserDetail> {
    const email = normalizeEmail(dto.email);
    if (!isValidMaliEmail(email)) {
      throw new BadRequestException('Correo invalido (debe ser @mali.pe)');
    }
    const area = normalizeArea(dto.area);
    if (!isValidBusinessArea(area)) {
      throw new BadRequestException('Area invalida');
    }

    const resolved = resolveRoleAndFlags(dto);
    const hash = await bcrypt.hash(
      dto.password?.trim()
        ? dto.password
        : `google-provisioned-${email}-${Date.now()}`,
      10,
    );
    try {
      const created = await this.prisma.users.create({
        data: {
          email,
          password_hash: hash,
          area,
          role_slug: resolved.role_slug,
          is_master: resolved.is_master,
          is_provisioned: true,
          must_change_password: false,
          ...resolved.flags,
        },
        select: { id: true },
      });
      await this.userAreas.replaceExtraAreasForUser(
        created.id,
        area,
        (dto.extra_areas ?? []).map((item) => normalizeArea(item)),
      );
      await this.auditLog.write({
        event_type: AuditEvent.ADMIN_USER_CREATED,
        message: `Usuario creado: ${email}`,
        actor: actor
          ? { userId: actor.id, email: actor.email, area: actor.area }
          : undefined,
        meta: {
          user_id: created.id,
          email,
          area,
          role_slug: resolved.role_slug,
          is_master: resolved.is_master,
        },
      });
      return this.getById(created.id);
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as { code?: string }).code === 'P2002'
      ) {
        throw new ConflictException('Ese correo ya existe');
      }
      throw error;
    }
  }

  async update(
    actor: AuthUser,
    id: number,
    dto: UpdateAdminUserDto,
  ): Promise<AdminUserDetail> {
    const existing = await this.prisma.users.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Usuario no encontrado');

    const area = normalizeArea(dto.area);
    if (!isValidBusinessArea(area)) {
      throw new BadRequestException('Area invalida');
    }
    if (dto.password && dto.password.length < 6) {
      throw new BadRequestException(
        'La contraseña debe tener al menos 6 caracteres',
      );
    }

    const resolved = resolveRoleAndFlags(dto);

    await this.prisma.users.update({
      where: { id },
      data: {
        area,
        role_slug: resolved.role_slug,
        is_master: resolved.is_master,
        is_provisioned: true,
        must_change_password: false,
        ...(dto.password
          ? { password_hash: await bcrypt.hash(dto.password, 10) }
          : {}),
        ...resolved.flags,
      },
    });

    await this.userAreas.replaceExtraAreasForUser(
      id,
      area as BusinessArea,
      (dto.extra_areas ?? []).map((item) => normalizeArea(item)),
    );

    await this.auditLog.write({
      event_type: AuditEvent.ADMIN_USER_UPDATED,
      message: `Usuario actualizado: ${existing.email}`,
      actor: { userId: actor.id, email: actor.email, area: actor.area },
      meta: {
        user_id: id,
        email: existing.email,
        area,
        role_slug: resolved.role_slug,
        is_master: resolved.is_master,
      },
    });

    return this.getById(id);
  }

  async remove(actor: AuthUser, id: number): Promise<void> {
    if (actor.id === id) {
      throw new ForbiddenException('No puedes eliminar tu propio usuario');
    }
    const existing = await this.prisma.users.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Usuario no encontrado');
    await this.prisma.users.delete({ where: { id } });
    await this.auditLog.write({
      event_type: AuditEvent.ADMIN_USER_DELETED,
      message: `Usuario eliminado: ${existing.email}`,
      actor: { userId: actor.id, email: actor.email, area: actor.area },
      meta: { user_id: id, email: existing.email },
    });
  }
}
