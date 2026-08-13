import { Global, Injectable, OnModuleInit } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { AuditEvent } from '../audit/audit-events';
import { AuditLogService } from '../audit/audit-log.service';
import { BUSINESS_AREAS } from '../config/areas';
import { PrismaService } from '../prisma/prisma.service';
import { META_SETTING_KEYS } from './meta-settings.keys';
import { setMetaSettingsCache, getStoredMetaRows } from './meta-settings.store';

@Injectable()
export class MetaSettingsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const rows = await this.prisma.app_settings.findMany({
      where: { key: { startsWith: 'meta.' } },
      select: { area: true, key: true, value: true },
    });
    setMetaSettingsCache(rows);
  }

  private async upsertSetting(
    area: string,
    key: string,
    rawValue: unknown,
  ): Promise<void> {
    const value = String(rawValue ?? '').trim();
    if (!value) {
      await this.prisma.app_settings.deleteMany({ where: { area, key } });
      return;
    }
    await this.prisma.app_settings.upsert({
      where: { area_key: { area, key } },
      create: { area, key, value, updated_at: new Date() },
      update: { value, updated_at: new Date() },
    });
  }

  async save(
    input: {
      global?: { verify_token?: string; app_secret?: string };
      areas?: Partial<
        Record<
          (typeof BUSINESS_AREAS)[number],
          {
            whatsapp_token?: string;
            phone_number_id?: string;
            waba_id?: string;
            page_access_token?: string;
            page_id?: string;
          }
        >
      >;
    },
    actor?: AuthUser,
  ): Promise<void> {
    const global = input.global ?? {};
    await this.upsertSetting(
      'global',
      META_SETTING_KEYS.verifyToken,
      global.verify_token,
    );
    await this.upsertSetting(
      'global',
      META_SETTING_KEYS.appSecret,
      global.app_secret,
    );

    for (const area of BUSINESS_AREAS) {
      const row = input.areas?.[area] ?? {};
      await this.upsertSetting(
        area,
        META_SETTING_KEYS.whatsappToken,
        row.whatsapp_token,
      );
      await this.upsertSetting(
        area,
        META_SETTING_KEYS.phoneNumberId,
        row.phone_number_id,
      );
      await this.upsertSetting(area, META_SETTING_KEYS.wabaId, row.waba_id);
      await this.upsertSetting(
        area,
        META_SETTING_KEYS.pageAccessToken,
        row.page_access_token,
      );
      await this.upsertSetting(area, META_SETTING_KEYS.pageId, row.page_id);
    }

    await this.refresh();

    if (actor) {
      await this.auditLog.write({
        event_type: AuditEvent.ADMIN_META_UPDATED,
        message: 'Credenciales Meta actualizadas',
        actor: {
          userId: actor.id,
          email: actor.email,
          area: actor.area,
        },
        meta: { areas: BUSINESS_AREAS.length },
      });
    }
  }

  getAdminView(): {
    global: { verify_token: string; app_secret: string };
    areas: Record<
      (typeof BUSINESS_AREAS)[number],
      {
        whatsapp_token: string;
        phone_number_id: string;
        waba_id: string;
        page_access_token: string;
        page_id: string;
      }
    >;
  } {
    const rows = getStoredMetaRows();
    const global = rows.global;
    const areas = {} as Record<
      (typeof BUSINESS_AREAS)[number],
      {
        whatsapp_token: string;
        phone_number_id: string;
        waba_id: string;
        page_access_token: string;
        page_id: string;
      }
    >;
    for (const area of BUSINESS_AREAS) {
      const row = rows[area];
      areas[area] = {
        whatsapp_token: row[META_SETTING_KEYS.whatsappToken] ?? '',
        phone_number_id: row[META_SETTING_KEYS.phoneNumberId] ?? '',
        waba_id: row[META_SETTING_KEYS.wabaId] ?? '',
        page_access_token: row[META_SETTING_KEYS.pageAccessToken] ?? '',
        page_id: row[META_SETTING_KEYS.pageId] ?? '',
      };
    }
    return {
      global: {
        verify_token: global[META_SETTING_KEYS.verifyToken] ?? '',
        app_secret: global[META_SETTING_KEYS.appSecret] ?? '',
      },
      areas,
    };
  }
}
