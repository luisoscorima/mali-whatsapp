import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import type { AuthUser } from '../auth/auth.types';
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
  is_master: boolean;
  must_change_password: boolean;
  created_at: Date;
  can_edit_ai_prompt: boolean;
  can_view_audit_logs: boolean;
  can_view_integration: boolean;
  can_edit_business_hours: boolean;
  can_view_reports: boolean;
}): AdminUserListItem {
  return {
    id: row.id,
    email: row.email,
    area: row.area,
    is_master: row.is_master,
    must_change_password: row.must_change_password,
    created_at: row.created_at.toISOString(),
    can_edit_ai_prompt: row.can_edit_ai_prompt,
    can_view_audit_logs: row.can_view_audit_logs,
    can_view_integration: row.can_view_integration,
    can_edit_business_hours: row.can_edit_business_hours,
    can_view_reports: row.can_view_reports,
  };
}

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
      select: {
        id: true,
        email: true,
        area: true,
        is_master: true,
        must_change_password: true,
        created_at: true,
        can_edit_ai_prompt: true,
        can_view_audit_logs: true,
        can_view_integration: true,
        can_edit_business_hours: true,
        can_view_reports: true,
      },
    });
    return rows.map(mapUserRow);
  }

  async getById(id: number): Promise<AdminUserDetail> {
    const row = await this.prisma.users.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        area: true,
        is_master: true,
        must_change_password: true,
        created_at: true,
        can_edit_ai_prompt: true,
        can_view_audit_logs: true,
        can_view_integration: true,
        can_edit_business_hours: true,
        can_view_reports: true,
      },
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

    const hash = await bcrypt.hash(dto.password, 10);
    try {
      const created = await this.prisma.users.create({
        data: {
          email,
          password_hash: hash,
          area,
          is_master: Boolean(dto.is_master),
          is_provisioned: true,
          must_change_password: dto.must_change_password !== false,
          can_edit_ai_prompt: Boolean(dto.can_edit_ai_prompt),
          can_view_audit_logs: Boolean(dto.can_view_audit_logs),
          can_view_integration: Boolean(dto.can_view_integration),
          can_edit_business_hours: Boolean(dto.can_edit_business_hours),
          can_view_reports: Boolean(dto.can_view_reports),
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
          is_master: Boolean(dto.is_master),
          must_change_password: dto.must_change_password !== false,
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

    if (dto.password) {
      await this.prisma.users.update({
        where: { id },
        data: {
          area,
          is_master: Boolean(dto.is_master),
          is_provisioned: true,
          must_change_password: false,
          password_hash: await bcrypt.hash(dto.password, 10),
          can_edit_ai_prompt: Boolean(dto.can_edit_ai_prompt),
          can_view_audit_logs: Boolean(dto.can_view_audit_logs),
          can_view_integration: Boolean(dto.can_view_integration),
          can_edit_business_hours: Boolean(dto.can_edit_business_hours),
          can_view_reports: Boolean(dto.can_view_reports),
        },
      });
    } else {
      await this.prisma.users.update({
        where: { id },
        data: {
          area,
          is_master: Boolean(dto.is_master),
          is_provisioned: true,
          must_change_password: Boolean(dto.must_change_password),
          can_edit_ai_prompt: Boolean(dto.can_edit_ai_prompt),
          can_view_audit_logs: Boolean(dto.can_view_audit_logs),
          can_view_integration: Boolean(dto.can_view_integration),
          can_edit_business_hours: Boolean(dto.can_edit_business_hours),
          can_view_reports: Boolean(dto.can_view_reports),
        },
      });
    }

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
        is_master: Boolean(dto.is_master),
        password_changed: Boolean(dto.password),
        must_change_password: dto.password
          ? false
          : Boolean(dto.must_change_password),
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
