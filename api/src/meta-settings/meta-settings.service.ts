import { Injectable, OnModuleInit } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { AuditEvent } from '../audit/audit-events';
import { AuditLogService } from '../audit/audit-log.service';
import {
  AREA_LABELS,
  BUSINESS_AREAS,
  isValidBusinessArea,
  normalizeArea,
  type BusinessArea,
} from '../config/areas';
import { PrismaService } from '../prisma/prisma.service';
import {
  fetchDisplayPhoneNumber,
  getWhatsAppCredentialsForArea,
} from '../templates/whatsapp-meta.util';
import { META_SETTING_KEYS } from './meta-settings.keys';
import {
  getStoredDisplayPhoneNumber,
  getStoredMetaRows,
  setMetaSettingsCache,
} from './meta-settings.store';

export type AreaLineInfo = {
  area: BusinessArea;
  label: string;
  phone_number_id: string;
  display_phone_number: string | null;
};

@Injectable()
export class MetaSettingsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.refresh();
    // No bloquear el arranque: rellena display_phone_number faltantes en background.
    void this.syncMissingDisplayPhoneNumbersOnBoot();
  }

  /** Solo áreas con token+PID y sin display en BD (números ya existentes). */
  private async syncMissingDisplayPhoneNumbersOnBoot(): Promise<void> {
    const missing = BUSINESS_AREAS.filter((area) => {
      const { token, phoneNumberId } = getWhatsAppCredentialsForArea(area);
      return (
        !!token &&
        !!phoneNumberId &&
        !getStoredDisplayPhoneNumber(area)
      );
    });
    if (!missing.length) return;

    try {
      await this.syncDisplayPhoneNumbersFromGraph(missing);
      console.info(
        JSON.stringify({
          level: 'info',
          message: 'display_phone_number sincronizado al arranque',
          areas: missing,
        }),
      );
    } catch (err) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          message: 'Falló sync de display_phone_number al arranque',
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
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

  /**
   * Consulta Graph una vez por área con credenciales y guarda
   * meta.display_phone_number en BD. Fallos de Meta no abortan el save.
   */
  async syncDisplayPhoneNumbersFromGraph(
    areas: readonly BusinessArea[] = BUSINESS_AREAS,
  ): Promise<void> {
    const updates: { area: BusinessArea; display: string }[] = [];

    await Promise.all(
      areas.map(async (area) => {
        const { token, phoneNumberId } = getWhatsAppCredentialsForArea(area);
        if (!phoneNumberId) {
          updates.push({ area, display: '' });
          return;
        }
        if (!token) return;

        try {
          const display = await fetchDisplayPhoneNumber(phoneNumberId, token);
          if (display) {
            updates.push({ area, display });
          }
        } catch (err) {
          console.warn(
            JSON.stringify({
              level: 'warn',
              message: 'No se pudo sincronizar display_phone_number desde Graph',
              area,
              phone_number_id: phoneNumberId,
              error: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      }),
    );

    if (!updates.length) return;

    await Promise.all(
      updates.map(({ area, display }) =>
        this.upsertSetting(
          area,
          META_SETTING_KEYS.displayPhoneNumber,
          display,
        ),
      ),
    );
    await this.refresh();
  }

  /** Líneas WA de las áreas indicadas; si falta display en BD, rellena desde Graph una vez. */
  async listAreaLines(areas: BusinessArea[]): Promise<AreaLineInfo[]> {
    const unique = [
      ...new Set(
        areas
          .map((a) => normalizeArea(a))
          .filter((a): a is BusinessArea => isValidBusinessArea(a)),
      ),
    ];

    const missing = unique.filter((area) => {
      const { token, phoneNumberId } = getWhatsAppCredentialsForArea(area);
      return (
        !!token &&
        !!phoneNumberId &&
        !getStoredDisplayPhoneNumber(area)
      );
    });

    if (missing.length) {
      await this.syncDisplayPhoneNumbersFromGraph(missing);
    }

    return unique.map((area) => {
      const { phoneNumberId } = getWhatsAppCredentialsForArea(area);
      const display = getStoredDisplayPhoneNumber(area);
      return {
        area,
        label: AREA_LABELS[area],
        phone_number_id: phoneNumberId || '',
        display_phone_number: display || null,
      };
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
      const prevPid = String(
        getStoredMetaRows()[area]?.[META_SETTING_KEYS.phoneNumberId] || '',
      ).trim();
      const nextPid = String(row.phone_number_id ?? '').trim();
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
      if (prevPid !== nextPid) {
        await this.upsertSetting(
          area,
          META_SETTING_KEYS.displayPhoneNumber,
          '',
        );
      }
    }

    await this.refresh();
    await this.syncDisplayPhoneNumbersFromGraph();

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
