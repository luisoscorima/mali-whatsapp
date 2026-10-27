import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { AuditEvent } from '../audit/audit-events';
import { AuditLogService } from '../audit/audit-log.service';
import {
  AREA_LABELS,
  setBusinessAreaCatalog,
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
  setWhatsAppLineCatalog,
} from './meta-settings.store';

export type AreaLineInfo = {
  area: BusinessArea;
  label: string;
  phone_number_id: string;
  display_phone_number: string | null;
};

@Injectable()
export class MetaSettingsService implements OnModuleInit, OnModuleDestroy {
  private refreshTimer?: ReturnType<typeof setInterval>;
  private refreshInFlight?: Promise<void>;
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.refresh();
    // Other API replicas/workers also observe changes without a restart.
    this.refreshTimer = setInterval(() => {
      void this.refresh().catch(() => {
        console.warn(
          'No se pudo actualizar el catálogo Meta; se conserva la última configuración cargada.',
        );
      });
    }, 15000);
    this.refreshTimer.unref();
    // No bloquear el arranque: rellena display_phone_number faltantes en background.
    void this.syncMissingDisplayPhoneNumbersOnBoot();
  }

  onModuleDestroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  /** Solo áreas con token+PID y sin display en BD (números ya existentes). */
  private async syncMissingDisplayPhoneNumbersOnBoot(): Promise<void> {
    const missing = BUSINESS_AREAS.filter((area) => {
      const { token, phoneNumberId } = getWhatsAppCredentialsForArea(area);
      return !!token && !!phoneNumberId && !getStoredDisplayPhoneNumber(area);
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
    // Serialize snapshots so an older read cannot overwrite a newer mutation.
    const previous = this.refreshInFlight;
    const next = (async () => {
      if (previous) await previous.catch(() => undefined);
      await this.loadSnapshot();
    })();
    this.refreshInFlight = next;
    try {
      await next;
    } finally {
      if (this.refreshInFlight === next) this.refreshInFlight = undefined;
    }
  }

  private async loadSnapshot(): Promise<void> {
    const [areas, aliases, rows, lines] = await Promise.all([
      this.prisma.business_areas.findMany({ orderBy: [{ sort_order: 'asc' }, { id: 'asc' }] }),
      this.prisma.business_area_aliases.findMany({ orderBy: { alias: 'asc' } }),
      this.prisma.app_settings.findMany({
        where: { key: { startsWith: 'meta.' } },
        select: { area: true, key: true, value: true },
      }),
      this.prisma.whatsapp_lines.findMany({
        orderBy: [{ business_area_id: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          active: true,
          phone_number_id: true,
          display_phone_number: true,
          legacy_area: true,
          program_id: true,
          program_key: true,
          is_default: true,
          business_area: { select: { slug: true, active: true } },
          waba: {
            select: {
              meta_waba_id: true,
              active: true,
              default_credential: {
                select: {
                  secret_source: true,
                  active: true,
                  secret_ref: true,
                  encrypted_token: true,
                },
              },
            },
          },
          credential_override: {
            select: {
              secret_source: true,
              active: true,
              secret_ref: true,
              encrypted_token: true,
            },
          },
        },
      }),
    ]);
    setBusinessAreaCatalog(areas, aliases);
    setMetaSettingsCache(rows);
    // Líneas nuevas (sync) a menudo no tienen token propio: reutilizar uno de la misma WABA.
    const wabaCredentialFallback = new Map<
      string,
      {
        secret_source: string | null;
        active: boolean;
        secret_ref: string | null;
        encrypted_token: string | null;
      }
    >();
    for (const line of lines) {
      const wabaId = line.waba.meta_waba_id;
      if (wabaCredentialFallback.has(wabaId)) continue;
      const own =
        line.credential_override?.active === true
          ? line.credential_override
          : line.waba.default_credential?.active === true
            ? line.waba.default_credential
            : null;
      if (own) wabaCredentialFallback.set(wabaId, own);
    }
    setWhatsAppLineCatalog(
      lines.map((line) => {
        const credential =
          line.credential_override ||
          line.waba.default_credential ||
          wabaCredentialFallback.get(line.waba.meta_waba_id) ||
          null;
        return {
          id: line.id,
          active:
            line.active &&
            line.business_area.active &&
            line.waba.active &&
            Boolean(credential?.active),
          phoneNumberId: line.phone_number_id,
          displayPhoneNumber: line.display_phone_number,
          legacyArea: line.legacy_area,
          canonicalArea: line.business_area.slug,
          programId: line.program_id,
          programKey: line.program_key,
          isDefault: line.is_default,
          wabaId: line.waba.meta_waba_id,
          credentialSource: credential?.secret_source ?? null,
          credentialRef: credential?.secret_ref ?? null,
          encryptedToken: credential?.encrypted_token ?? null,
        };
      }),
    );
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
              message:
                'No se pudo sincronizar display_phone_number desde Graph',
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
        this.upsertSetting(area, META_SETTING_KEYS.displayPhoneNumber, display),
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
      return !!token && !!phoneNumberId && !getStoredDisplayPhoneNumber(area);
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
