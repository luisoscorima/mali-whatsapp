import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { normalizeArea } from '../config/areas';
import { PrismaService } from '../prisma/prisma.service';
import { inferAreaFromFormName } from './lead-form-area.util';
import { LeadsService } from './leads.service';

const TT_API_BASE = 'https://business-api.tiktok.com/open_api/v1.3';

type MappedFields = {
  phone?: string;
  email?: string;
  dni?: string;
  name?: string;
  last_name?: string;
  raw: Record<string, string>;
};

type LeadNotice = {
  lead_id: string;
  advertiser_id?: string;
  form_id?: string;
  ad_id?: string;
  /** Campos ya presentes en el webhook (Custom CRM). */
  inline_fields?: Record<string, unknown>;
  created_time?: string;
  raw: Record<string, unknown>;
};

@Injectable()
export class TikTokLeadgenService {
  private readonly logger = new Logger(TikTokLeadgenService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly leads: LeadsService,
  ) {}

  assertWebhookAuth(req: Request): void {
    const expected = String(process.env.TIKTOK_WEBHOOK_SECRET || '').trim();
    const requireSecret =
      String(process.env.REQUIRE_TIKTOK_WEBHOOK_SECRET || '')
        .trim()
        .toLowerCase() === 'true';

    if (!expected) {
      if (requireSecret) {
        throw new UnauthorizedException('TIKTOK_WEBHOOK_SECRET no configurado');
      }
      return;
    }

    const auth = String(req.headers.authorization || '');
    const bearer = auth.replace(/^Bearer\s+/i, '').trim();
    const headerToken = String(
      req.headers['x-tiktok-token'] ||
        req.headers['x-webhook-token'] ||
        '',
    ).trim();
    const queryToken = String(
      (req.query as { token?: string })?.token || '',
    ).trim();

    if (
      bearer !== expected &&
      headerToken !== expected &&
      queryToken !== expected
    ) {
      throw new UnauthorizedException('Token de webhook TikTok inválido');
    }
  }

  private peekAccessToken(): string {
    return String(process.env.TIKTOK_ACCESS_TOKEN || '').trim();
  }

  private advertiserAreaMap(): Record<string, string> {
    const map: Record<string, string> = {};
    const put = (id: string | undefined, area: string) => {
      const v = String(id || '').trim();
      if (v) map[v] = area;
    };
    put(process.env.TIKTOK_ADVERTISER_ID, 'educacion');
    put(process.env.TIKTOK_ADVERTISER_ID_CA, 'educacion_ca');
    put(process.env.TIKTOK_ADVERTISER_ID_EP, 'educacion_ep');
    put(process.env.TIKTOK_ADVERTISER_ID_EDUCACION, 'educacion');
    return map;
  }

  mapFieldData(input: Record<string, unknown> | undefined): MappedFields {
    const raw: Record<string, string> = {};
    for (const [k, v] of Object.entries(input || {})) {
      const key = String(k || '')
        .trim()
        .toLowerCase();
      const value = Array.isArray(v)
        ? String(v[0] ?? '').trim()
        : String(v ?? '').trim();
      if (key && value) raw[key] = value;
    }

    const norm = (s: string) =>
      s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

    const pick = (...keys: string[]) => {
      for (const k of keys) {
        if (raw[k]) return raw[k];
      }
      return undefined;
    };

    const pickMatch = (pred: (normKey: string) => boolean) => {
      for (const [k, v] of Object.entries(raw)) {
        if (pred(norm(k))) return v;
      }
      return undefined;
    };

    const phoneRaw =
      pick(
        'phone_number',
        'phone',
        'celular',
        'mobile',
        'teléfono',
        'telefono',
        'número_de_teléfono',
        'numero_de_telefono',
      ) ||
      pickMatch(
        (k) =>
          k.includes('telefono') ||
          k.includes('phone') ||
          k.includes('celular') ||
          k.includes('whatsapp'),
      );

    const email =
      pick(
        'email',
        'correo',
        'e-mail',
        'correo_electrónico',
        'correo_electronico',
      ) || pickMatch((k) => k.includes('correo') || k.includes('email'));

    const fullName =
      pick(
        'full_name',
        'nombre',
        'first_name',
        'nombres',
        'name',
        'nombre_y_apellidos',
        'nombre_y_apellido',
      ) ||
      pickMatch(
        (k) =>
          k.includes('nombre') ||
          k.includes('full_name') ||
          k === 'name',
      );

    return {
      phone: phoneRaw?.replace(/^p:/i, '').trim() || phoneRaw,
      email,
      dni:
        pick('dni', 'document_number', 'documento', 'national_id') ||
        pickMatch((k) => k.includes('dni') || k.includes('documento')),
      name: fullName,
      last_name: pick('last_name', 'apellidos', 'apellido'),
      raw,
    };
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  }

  private pickLeadId(row: Record<string, unknown>): string {
    return String(
      row.lead_id ?? row.leadId ?? row.id ?? '',
    ).trim();
  }

  /** Extrae notificaciones de lead de formas comunes de payload TikTok / Custom CRM. */
  extractLeadNotices(body: unknown): LeadNotice[] {
    const root = this.asRecord(body);
    if (!root) return [];

    const out: LeadNotice[] = [];
    const push = (row: Record<string, unknown>, wrapRaw?: unknown) => {
      const leadId = this.pickLeadId(row);
      if (!leadId) return;
      const leadData =
        this.asRecord(row.lead_data) ||
        this.asRecord(row.field_data) ||
        this.asRecord(row.answers) ||
        undefined;
      const meta = this.asRecord(row.meta_data) || {};
      out.push({
        lead_id: leadId,
        advertiser_id: String(
          row.advertiser_id ?? meta.advertiser_id ?? '',
        ).trim() || undefined,
        form_id:
          String(
            row.page_id ??
              row.form_id ??
              meta.page_id ??
              meta.form_id ??
              '',
          ).trim() || undefined,
        ad_id:
          String(row.ad_id ?? meta.ad_id ?? '').trim() || undefined,
        created_time: String(
          row.create_time ??
            row.created_time ??
            row.submit_time ??
            meta.create_time ??
            '',
        ).trim() || undefined,
        inline_fields: leadData || undefined,
        raw: (this.asRecord(wrapRaw) || row) as Record<string, unknown>,
      });
    };

    if (this.pickLeadId(root)) {
      push(root, root);
    }

    const data = this.asRecord(root.data);
    if (data && this.pickLeadId(data)) push(data, root);

    for (const key of ['leads', 'items', 'entry'] as const) {
      const list = root[key];
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        const row = this.asRecord(item);
        if (!row) continue;
        if (this.pickLeadId(row)) {
          push(row, item);
          continue;
        }
        const changes = Array.isArray(row.changes) ? row.changes : [];
        for (const change of changes) {
          const ch = this.asRecord(change);
          const value = this.asRecord(ch?.value);
          if (value) push(value, change);
        }
      }
    }

    // content serializado (algunos webhooks TikTok)
    if (typeof root.content === 'string' && root.content.trim()) {
      try {
        const parsed = JSON.parse(root.content) as unknown;
        out.push(...this.extractLeadNotices(parsed));
      } catch {
        /* ignore */
      }
    }

    // dedupe por lead_id
    const seen = new Set<string>();
    return out.filter((n) => {
      if (seen.has(n.lead_id)) return false;
      seen.add(n.lead_id);
      return true;
    });
  }

  private async resolveArea(params: {
    formId?: string;
    formName?: string | null;
    advertiserId?: string;
  }): Promise<string> {
    const formId = String(params.formId || '').trim();
    if (formId) {
      const route = await this.prisma.tiktok_lead_form_routes.findUnique({
        where: { form_id: formId },
      });
      if (route) return normalizeArea(route.area);
    }

    const byAdvertiser = this.advertiserAreaMap();
    const adv = String(params.advertiserId || '').trim();
    if (adv && byAdvertiser[adv]) return byAdvertiser[adv];

    if (params.formName) return inferAreaFromFormName(params.formName);
    return 'educacion';
  }

  async fetchLeadFromApi(params: {
    leadId: string;
    advertiserId: string;
    formId?: string;
  }): Promise<{
    lead_data: Record<string, unknown>;
    meta_data: Record<string, unknown>;
    raw: Record<string, unknown>;
  }> {
    const token = this.peekAccessToken();
    if (!token) {
      throw new BadRequestException(
        'Falta TIKTOK_ACCESS_TOKEN para leer el lead en Marketing API',
      );
    }

    const url = new URL(`${TT_API_BASE}/lead/get/`);
    url.searchParams.set('advertiser_id', params.advertiserId);
    url.searchParams.set('lead_id', params.leadId);
    url.searchParams.set('lead_source', 'INSTANT_FORM');
    if (params.formId) url.searchParams.set('page_id', params.formId);

    const res = await fetch(url, {
      headers: { 'Access-Token': token },
    });
    const json = (await res.json()) as {
      code?: number;
      message?: string;
      data?: {
        lead_data?: Record<string, unknown>;
        meta_data?: Record<string, unknown>;
      };
    };
    if (!res.ok || json.code !== 0) {
      throw new BadRequestException(
        json.message ||
          `TikTok lead/get error lead_id=${params.leadId} code=${json.code ?? res.status}`,
      );
    }

    return {
      lead_data: json.data?.lead_data || {},
      meta_data: json.data?.meta_data || {},
      raw: json as Record<string, unknown>,
    };
  }

  async ingestLead(notice: LeadNotice): Promise<{
    lead_id: string;
    contact_id: number | null;
    created: boolean;
  }> {
    const leadId = String(notice.lead_id || '').trim();
    if (!leadId) throw new BadRequestException('lead_id requerido');

    const existing = await this.prisma.tiktok_leads.findUnique({
      where: { lead_id: leadId },
    });
    if (existing) {
      return {
        lead_id: leadId,
        contact_id: existing.contact_id,
        created: false,
      };
    }

    let leadData = notice.inline_fields || {};
    let meta: Record<string, unknown> = {};
    let rawApi: Record<string, unknown> | null = null;
    let formId = String(notice.form_id || '').trim();
    let advertiserId = String(notice.advertiser_id || '').trim();
    let adId = String(notice.ad_id || '').trim();
    let createdTimeStr = notice.created_time;

    const hasInlineIdentity = Boolean(
      this.mapFieldData(leadData).phone ||
        this.mapFieldData(leadData).email ||
        this.mapFieldData(leadData).dni,
    );

    if (!hasInlineIdentity) {
      if (!advertiserId) {
        advertiserId = String(
          process.env.TIKTOK_ADVERTISER_ID ||
            process.env.TIKTOK_ADVERTISER_ID_EDUCACION ||
            '',
        ).trim();
      }
      if (!advertiserId) {
        throw new BadRequestException(
          `Lead ${leadId}: falta advertiser_id y no hay campos inline`,
        );
      }
      const fetched = await this.fetchLeadFromApi({
        leadId,
        advertiserId,
        formId: formId || undefined,
      });
      leadData = fetched.lead_data;
      meta = fetched.meta_data;
      rawApi = fetched.raw;
      formId =
        formId ||
        String(meta.page_id || meta.form_id || '').trim() ||
        'unknown';
      adId = adId || String(meta.ad_id || '').trim();
      createdTimeStr =
        createdTimeStr || String(meta.create_time || '').trim();
    }

    if (!formId) formId = 'unknown';

    const mapped = this.mapFieldData(leadData);
    const formName =
      (
        await this.prisma.tiktok_lead_form_routes.findUnique({
          where: { form_id: formId },
          select: { form_name: true },
        })
      )?.form_name || null;

    const area = await this.resolveArea({
      formId,
      formName,
      advertiserId: advertiserId || undefined,
    });

    await this.prisma.tiktok_lead_form_routes.upsert({
      where: { form_id: formId },
      create: {
        form_id: formId,
        area,
        form_name: formName,
        advertiser_id: advertiserId || null,
        updated_at: new Date(),
      },
      update: {
        advertiser_id: advertiserId || undefined,
        updated_at: new Date(),
      },
    });

    const origin = await this.leads.upsertOrigin({
      area,
      channel: 'tiktok',
      external_id: leadId,
      source_key: formId,
      source_label: formName || formId,
      payload: {
        mapped: mapped.raw,
        field_data: leadData,
        ad_id: adId || null,
        form_id: formId,
        form_name: formName,
        advertiser_id: advertiserId || null,
      },
      contact: {
        phone: mapped.phone,
        email: mapped.email,
        dni: mapped.dni,
        name: mapped.name,
        last_name: mapped.last_name,
        opt_in: true,
        opt_in_email: Boolean(mapped.email),
      },
    });

    const createdTime = createdTimeStr
      ? new Date(
          /^\d+$/.test(createdTimeStr)
            ? Number(createdTimeStr) * (createdTimeStr.length <= 10 ? 1000 : 1)
            : createdTimeStr,
        )
      : new Date();

    await this.prisma.tiktok_leads.create({
      data: {
        area,
        lead_id: leadId,
        form_id: formId,
        advertiser_id: advertiserId || null,
        ad_id: adId || null,
        field_data: leadData as Prisma.InputJsonValue,
        raw: (rawApi || notice.raw) as Prisma.InputJsonValue,
        contact_id: origin.contact_id,
        contact_origin_id: origin.origin_id,
        created_time: Number.isNaN(createdTime.getTime())
          ? new Date()
          : createdTime,
        updated_at: new Date(),
      },
    });

    return {
      lead_id: leadId,
      contact_id: origin.contact_id,
      created: true,
    };
  }

  async processWebhook(body: unknown): Promise<number> {
    const notices = this.extractLeadNotices(body);
    if (notices.length === 0) {
      this.logger.warn('Webhook TikTok: sin lead_id reconocible en el body');
      return 0;
    }

    let ingested = 0;
    for (const notice of notices) {
      try {
        const result = await this.ingestLead(notice);
        if (result.created) ingested += 1;
      } catch (err) {
        this.logger.warn(
          `TikTok ingest failed ${notice.lead_id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    return ingested;
  }
}
