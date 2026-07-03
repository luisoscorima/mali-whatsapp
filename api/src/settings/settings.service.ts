import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { AuditEvent } from '../audit/audit-events';
import { auditActor } from '../audit/audit-actor.util';
import { AuditLogService } from '../audit/audit-log.service';
import { isValidBusinessArea, normalizeArea } from '../config/areas';
import { PrismaService } from '../prisma/prisma.service';
import {
  defaultAiConfig,
  defaultAiConfigSeed,
  parseAiConfigValue,
} from './ai-config.util';
import {
  defaultBusinessHoursSeed,
  parseBusinessHoursConfig,
  validateBusinessHoursInput,
} from './business-hours.util';
import {
  firstSettingsModulePath,
  userCanAccessSettingsModule,
  visibleSettingsModules,
} from './settings-modules.util';
import type {
  AiSettingsView,
  BusinessHoursSettingsView,
  IntegrationSettings,
  SettingsModuleItem,
} from './settings.types';
import type { EnableAiDto, UpdateAiConfigDto, UpdateBusinessHoursDto } from './dto/settings.dto';

function readPublicAppUrl(): string {
  return String(process.env.APP_BASE_URL || 'http://localhost:4000')
    .trim()
    .replace(/\/$/, '');
}

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  assertModuleAccess(user: AuthUser, moduleId: string): void {
    if (!userCanAccessSettingsModule(user, moduleId)) {
      throw new ForbiddenException('No tienes acceso a este módulo de ajustes');
    }
  }

  getModules(user: AuthUser): {
    modules: SettingsModuleItem[];
    first_path: string | null;
  } {
    const modules = visibleSettingsModules(user).map((m) => ({
      id: m.id,
      path: m.path,
      title: m.title,
      preview: m.preview,
    }));
    return {
      modules,
      first_path: firstSettingsModulePath(user),
    };
  }

  getIntegration(user: AuthUser): IntegrationSettings {
    this.assertModuleAccess(user, 'integracion');
    const base = readPublicAppUrl();
    return {
      app_base_url: base,
      webhook_url: `${base}/webhook`,
      health_url: `${base}/health`,
      dashboard_api_url: `${base}/api/dashboard`,
    };
  }

  private resolveArea(user: AuthUser, areaParam?: string): string {
    const area = normalizeArea(areaParam || user.area);
    if (!isValidBusinessArea(area)) {
      throw new BadRequestException('Area invalida');
    }
    if (!user.isMaster && normalizeArea(user.area) !== area) {
      throw new ForbiddenException('No autorizado para otra área');
    }
    return area;
  }

  private async readSettingValue(area: string, key: string): Promise<string | null> {
    const row = await this.prisma.app_settings.findUnique({
      where: { area_key: { area, key } },
      select: { value: true },
    });
    return row?.value ?? null;
  }

  private async upsertSettingValue(
    area: string,
    key: string,
    value: string,
  ): Promise<void> {
    await this.prisma.app_settings.upsert({
      where: { area_key: { area, key } },
      create: { area, key, value },
      update: { value, updated_at: new Date() },
    });
  }

  async getAi(user: AuthUser, areaParam?: string): Promise<AiSettingsView> {
    this.assertModuleAccess(user, 'ia');
    const area = this.resolveArea(user, areaParam);
    const raw = await this.readSettingValue(area, 'ai_config');
    const cfg = parseAiConfigValue(raw) || defaultAiConfig();
    return {
      area,
      enabled: cfg.enabled,
      prompt: cfg.prompt,
      transfer_keyword: cfg.transfer_keyword,
      can_toggle_enabled: user.isMaster,
    };
  }

  async updateAi(
    user: AuthUser,
    dto: UpdateAiConfigDto,
    areaParam?: string,
  ): Promise<void> {
    this.assertModuleAccess(user, 'ia');
    const area = this.resolveArea(user, areaParam);
    const isMaster = user.isMaster;
    const canEditPrompt =
      user.canEditAiPrompt && normalizeArea(user.area) === area;

    if (!isMaster && !canEditPrompt) {
      throw new ForbiddenException('No autorizado');
    }

    let value: string;
    if (isMaster) {
      const body = {
        enabled: Boolean(dto.enabled),
        prompt: String(dto.prompt ?? ''),
        transfer_keyword: String(dto.transfer_keyword ?? '[TRANSFERIR]'),
      };
      if (!body.prompt.trim()) {
        throw new BadRequestException('El prompt no puede estar vacio');
      }
      value = JSON.stringify(body);
    } else {
      const raw = await this.readSettingValue(area, 'ai_config');
      const cfg = parseAiConfigValue(raw) || defaultAiConfig();
      cfg.prompt = String(dto.prompt ?? cfg.prompt ?? '');
      cfg.transfer_keyword = String(
        dto.transfer_keyword ?? cfg.transfer_keyword ?? '[TRANSFERIR]',
      );
      if (!cfg.prompt.trim()) {
        throw new BadRequestException('El prompt no puede estar vacio');
      }
      value = JSON.stringify(cfg);
    }

    await this.upsertSettingValue(area, 'ai_config', value);
    await this.auditLog.write({
      event_type: AuditEvent.SETTINGS_AI_CONFIG,
      message: `Ajustes de IA guardados (área ${area})`,
      actor: auditActor(user),
      meta: {
        scope: isMaster ? 'full_master' : 'prompt_only',
        json_keys: isMaster
          ? ['enabled', 'prompt', 'transfer_keyword']
          : ['prompt', 'transfer_keyword'],
      },
    });
  }

  async enableAi(
    user: AuthUser,
    dto: EnableAiDto,
    areaParam?: string,
  ): Promise<void> {
    this.assertModuleAccess(user, 'ia');
    if (!user.isMaster) {
      throw new ForbiddenException('Solo administrador master');
    }
    const area = this.resolveArea(user, areaParam);
    const enabled = Boolean(dto.enabled);

    await this.prisma.$transaction(async (tx) => {
      const raw = await tx.app_settings.findUnique({
        where: { area_key: { area, key: 'ai_config' } },
        select: { value: true },
      });
      let cfg = parseAiConfigValue(raw?.value);
      if (!cfg) {
        cfg = defaultAiConfigSeed();
      }
      cfg.enabled = enabled;
      const value = JSON.stringify(cfg);
      await tx.app_settings.upsert({
        where: { area_key: { area, key: 'ai_config' } },
        create: { area, key: 'ai_config', value },
        update: { value, updated_at: new Date() },
      });
      const newStatus = enabled ? 'bot' : 'human';
      await tx.conversations.updateMany({
        where: { area },
        data: { status: newStatus, updated_at: new Date() },
      });
    });
    await this.auditLog.write({
      event_type: AuditEvent.SETTINGS_AI_ENABLE,
      message: `IA del área ${area} ${enabled ? 'activada' : 'desactivada'} (conversaciones actualizadas)`,
      actor: auditActor(user),
      meta: {
        area,
        enabled,
        conversations_status: enabled ? 'bot' : 'human',
      },
    });
  }

  async getBusinessHours(
    user: AuthUser,
    areaParam?: string,
  ): Promise<BusinessHoursSettingsView> {
    this.assertModuleAccess(user, 'fuera-de-horario');
    const area = this.resolveArea(user, areaParam);
    const defaults = defaultBusinessHoursSeed();
    const raw = await this.readSettingValue(area, 'business_hours');
    const cfg = parseBusinessHoursConfig(raw);
    if (!cfg) {
      return { area, ...defaults };
    }
    return {
      area,
      enabled: cfg.enabled,
      timezone: cfg.timezone || defaults.timezone,
      days: cfg.days.length ? cfg.days : defaults.days,
      from: cfg.from || defaults.from,
      to: cfg.to || defaults.to,
      outside_hours_message: cfg.outside_hours_message || '',
    };
  }

  async updateBusinessHours(
    user: AuthUser,
    dto: UpdateBusinessHoursDto,
    areaParam?: string,
  ): Promise<void> {
    this.assertModuleAccess(user, 'fuera-de-horario');
    const area = this.resolveArea(user, areaParam);
    const isMaster = user.isMaster;
    const canEdit =
      user.canEditBusinessHours && normalizeArea(user.area) === area;

    if (!isMaster && !canEdit) {
      throw new ForbiddenException('No autorizado');
    }

    const validated = validateBusinessHoursInput(dto);
    if ('error' in validated) {
      throw new BadRequestException(validated.error);
    }

    await this.upsertSettingValue(
      area,
      'business_hours',
      JSON.stringify(validated.config),
    );
    await this.auditLog.write({
      event_type: AuditEvent.SETTINGS_BUSINESS_HOURS,
      message: `Horario fuera de atención guardado (área ${area})`,
      actor: auditActor(user),
      meta: {
        area,
        enabled: validated.config.enabled,
        days_count: validated.config.days.length,
      },
    });
  }
}
