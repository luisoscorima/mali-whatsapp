import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { BUSINESS_AREAS, normalizeArea } from '../config/areas';
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

  /** Fallback si el webhook no trae advertiser_id (CA y EP comparten la misma cuenta). */
  private defaultAdvertiserId(): string {
    return String(process.env.TIKTOK_ADVERTISER_ID || '').trim();
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
      const changes = Array.isArray(row.changes) ? row.changes : [];
      const changedFields: Record<string, unknown> = {};
      for (const change of changes) {
        const item = this.asRecord(change);
        const field = String(item?.field ?? '').trim();
        if (!field || item?.value == null) continue;

        // Official TikTok Lead webhook shape: changes[].value is normally a
        // scalar, but some integrations wrap it in { value } or send an
        // object containing the field values.
        const value = this.asRecord(item.value);
        if (value && Object.prototype.hasOwnProperty.call(value, 'value')) {
          changedFields[field] = value.value;
        } else if (value) {
          Object.assign(changedFields, value);
        } else {
          changedFields[field] = item.value;
        }
      }
      const leadData =
        this.asRecord(row.lead_data) ||
        this.asRecord(row.field_data) ||
        this.asRecord(row.answers) ||
        (Object.keys(changedFields).length > 0 ? changedFields : undefined);
      const meta = this.asRecord(row.meta_data) || {};
      out.push({
        lead_id: leadId,
        advertiser_id: String(
          row.advertiser_id ??
            row.advertiserId ??
            row.adv_id ??
            meta.advertiser_id ??
            meta.adv_id ??
            '',
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

  /**
   * Área: ruta bloqueada → nombre del form (CA / EP) → ruta libre → educacion.
   * No se usa advertiser_id: CA y EP viven en la misma cuenta publicitaria.
   */
  private async resolveArea(params: {
    formId?: string;
    formName?: string | null;
  }): Promise<string> {
    const formId = String(params.formId || '').trim();
    let route: { area: string; area_locked: boolean } | null = null;
    if (formId) {
      route = await this.prisma.tiktok_lead_form_routes.findUnique({
        where: { form_id: formId },
        select: { area: true, area_locked: true },
      });
      if (route?.area_locked) return normalizeArea(route.area);
    }

    if (params.formName) return inferAreaFromFormName(params.formName);
    if (route) return normalizeArea(route.area);
    return 'educacion';
  }

  /** Título del Instant Form vía page/get (lista LEAD_GEN y busca page_id). */
  private async fetchFormTitle(params: {
    advertiserId: string;
    formId: string;
  }): Promise<string | null> {
    const token = this.peekAccessToken();
    if (!token || !params.advertiserId || !params.formId) return null;

    try {
      const url = new URL(`${TT_API_BASE}/page/get/`);
      url.searchParams.set('advertiser_id', params.advertiserId);
      url.searchParams.set('business_type', 'LEAD_GEN');
      url.searchParams.set('page', '1');
      url.searchParams.set('page_size', '100');

      const res = await fetch(url, {
        headers: { 'Access-Token': token },
      });
      const json = (await res.json()) as {
        code?: number;
        data?: { list?: Array<{ page_id?: string | number; title?: string }> };
      };
      if (!res.ok || json.code !== 0) return null;

      const hit = (json.data?.list || []).find(
        (p) => String(p.page_id || '').trim() === params.formId,
      );
      const title = String(hit?.title || '').trim();
      return title || null;
    } catch (err) {
      this.logger.warn(
        `TikTok page/get falló form=${params.formId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
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
        advertiserId = this.defaultAdvertiserId();
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
    const existingRoute = formId
      ? await this.prisma.tiktok_lead_form_routes.findUnique({
          where: { form_id: formId },
          select: { form_name: true, area_locked: true },
        })
      : null;

    let formName = existingRoute?.form_name || null;

    if (!formName && advertiserId) {
      formName = await this.fetchFormTitle({
        advertiserId,
        formId,
      });
    }

    const area = await this.resolveArea({
      formId,
      formName,
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
        form_name: formName || undefined,
        ...(existingRoute?.area_locked ? {} : { area }),
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

  async listFormRoutes() {
    return this.prisma.tiktok_lead_form_routes.findMany({
      orderBy: [{ area: 'asc' }, { form_name: 'asc' }, { form_id: 'asc' }],
    });
  }

  async updateFormRoute(formId: string, body: { area: string }) {
    const formIdNorm = String(formId ?? '').trim();
    if (!formIdNorm) throw new BadRequestException('form_id requerido');
    const area = normalizeArea(body.area);
    if (!(BUSINESS_AREAS as readonly string[]).includes(area)) {
      throw new BadRequestException(`area inválida: ${body.area}`);
    }

    const existing = await this.prisma.tiktok_lead_form_routes.findUnique({
      where: { form_id: formIdNorm },
    });
    if (!existing) {
      throw new NotFoundException('Ruta de formulario no encontrada');
    }

    return this.prisma.tiktok_lead_form_routes.update({
      where: { form_id: formIdNorm },
      data: {
        area,
        area_locked: true,
        updated_at: new Date(),
      },
    });
  }

  async syncFormsFromTikTok(): Promise<{
    synced: number;
    created: number;
    updated: number;
    deleted: number;
  }> {
    const token = this.peekAccessToken();
    const advertiserId = this.defaultAdvertiserId();
    if (!token) {
      throw new BadRequestException(
        'Falta TIKTOK_ACCESS_TOKEN para sincronizar forms',
      );
    }
    if (!advertiserId) {
      throw new BadRequestException(
        'Falta TIKTOK_ADVERTISER_ID para sincronizar forms',
      );
    }

    let synced = 0;
    let created = 0;
    let updated = 0;
    const activeIds = new Set<string>();
    let page = 1;
    let totalPage = 1;

    do {
      const url = new URL(`${TT_API_BASE}/page/get/`);
      url.searchParams.set('advertiser_id', advertiserId);
      url.searchParams.set('business_type', 'LEAD_GEN');
      url.searchParams.set('page', String(page));
      url.searchParams.set('page_size', '100');

      const res = await fetch(url, {
        headers: { 'Access-Token': token },
      });
      const json = (await res.json()) as {
        code?: number;
        message?: string;
        data?: {
          list?: Array<{
            page_id?: string | number;
            title?: string;
            status?: string;
          }>;
          page_info?: { page?: number; total_page?: number };
        };
      };
      if (!res.ok || json.code !== 0) {
        throw new BadRequestException(
          json.message ||
            `TikTok page/get error code=${json.code ?? res.status}`,
        );
      }

      for (const form of json.data?.list || []) {
        const formId = String(form.page_id ?? '').trim();
        if (!formId) continue;
        activeIds.add(formId);
        const formName = String(form.title ?? '').trim() || null;
        const inferred = inferAreaFromFormName(formName);
        const existing = await this.prisma.tiktok_lead_form_routes.findUnique({
          where: { form_id: formId },
        });

        if (!existing) {
          await this.prisma.tiktok_lead_form_routes.create({
            data: {
              form_id: formId,
              area: inferred,
              form_name: formName,
              advertiser_id: advertiserId,
              area_locked: false,
              last_synced_at: new Date(),
              updated_at: new Date(),
            },
          });
          created += 1;
        } else {
          await this.prisma.tiktok_lead_form_routes.update({
            where: { form_id: formId },
            data: {
              form_name: formName ?? existing.form_name,
              advertiser_id: advertiserId,
              area: existing.area_locked ? existing.area : inferred,
              last_synced_at: new Date(),
              updated_at: new Date(),
            },
          });
          updated += 1;
        }
        synced += 1;
      }

      totalPage = Number(json.data?.page_info?.total_page || 1) || 1;
      page += 1;
    } while (page <= totalPage);

    let deleted = 0;
    if (activeIds.size > 0) {
      const prune = await this.prisma.tiktok_lead_form_routes.deleteMany({
        where: { form_id: { notIn: [...activeIds] } },
      });
      deleted = prune.count;
    }

    return { synced, created, updated, deleted };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private parseCsvRows(text: string): Record<string, string>[] {
    const lines = text
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .filter((l) => l.trim());
    if (lines.length < 2) return [];

    const splitLine = (line: string): string[] => {
      const out: string[] = [];
      let cur = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuotes && line[i + 1] === '"') {
            cur += '"';
            i += 1;
          } else {
            inQuotes = !inQuotes;
          }
          continue;
        }
        if (ch === ',' && !inQuotes) {
          out.push(cur);
          cur = '';
          continue;
        }
        cur += ch;
      }
      out.push(cur);
      return out;
    };

    const headers = splitLine(lines[0]).map((h) => h.trim());
    const rows: Record<string, string>[] = [];
    for (let i = 1; i < lines.length; i += 1) {
      const cols = splitLine(lines[i]);
      const row: Record<string, string> = {};
      headers.forEach((h, idx) => {
        if (!h) return;
        row[h] = String(cols[idx] ?? '').trim();
      });
      rows.push(row);
    }
    return rows;
  }

  private rowToLeadNotice(
    row: Record<string, unknown>,
    defaults: { formId: string; advertiserId: string },
  ): LeadNotice | null {
    const pick = (...keys: string[]) => {
      for (const k of keys) {
        const direct = row[k];
        if (direct != null && String(direct).trim()) return String(direct).trim();
        const found = Object.entries(row).find(
          ([rk]) => rk.toLowerCase() === k.toLowerCase(),
        );
        if (found?.[1] != null && String(found[1]).trim()) {
          return String(found[1]).trim();
        }
      }
      return '';
    };

    const leadId = pick('lead_id', 'Lead ID', 'leadId', 'id');
    if (!leadId) return null;

    const metaKeys = new Set(
      [
        'lead_id',
        'Lead ID',
        'leadId',
        'id',
        'page_id',
        'form_id',
        'advertiser_id',
        'ad_id',
        'adgroup_id',
        'campaign_id',
        'create_time',
        'created_time',
        'Created Time',
      ].map((k) => k.toLowerCase()),
    );
    const inline: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      if (!k || metaKeys.has(k.toLowerCase())) continue;
      if (v == null || String(v).trim() === '') continue;
      inline[k] = v;
    }

    return {
      lead_id: leadId,
      form_id:
        pick('page_id', 'form_id', 'Page ID') || defaults.formId || undefined,
      advertiser_id:
        pick('advertiser_id') || defaults.advertiserId || undefined,
      ad_id: pick('ad_id', 'Ad ID') || undefined,
      created_time: pick('create_time', 'created_time', 'Created Time') || undefined,
      inline_fields: Object.keys(inline).length ? inline : undefined,
      raw: row,
    };
  }

  async backfillForm(formId: string): Promise<{ imported: number }> {
    const formIdNorm = String(formId ?? '').trim();
    if (!formIdNorm) throw new BadRequestException('form_id requerido');

    const token = this.peekAccessToken();
    if (!token) {
      throw new BadRequestException(
        'Falta TIKTOK_ACCESS_TOKEN para backfill',
      );
    }

    const route = await this.prisma.tiktok_lead_form_routes.findUnique({
      where: { form_id: formIdNorm },
    });
    const advertiserId =
      String(route?.advertiser_id || '').trim() || this.defaultAdvertiserId();
    if (!advertiserId) {
      throw new BadRequestException(
        'Falta advertiser_id (ruta o TIKTOK_ADVERTISER_ID)',
      );
    }

    const createRes = await fetch(`${TT_API_BASE}/page/lead/task/`, {
      method: 'POST',
      headers: {
        'Access-Token': token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        advertiser_id: advertiserId,
        page_id: formIdNorm,
      }),
    });
    const createJson = (await createRes.json()) as {
      code?: number;
      message?: string;
      data?: { task_id?: string | number; status?: string };
    };
    if (!createRes.ok || createJson.code !== 0) {
      throw new BadRequestException(
        createJson.message ||
          `TikTok lead/task create error code=${createJson.code ?? createRes.status}`,
      );
    }
    const taskId = String(createJson.data?.task_id ?? '').trim();
    if (!taskId) {
      throw new BadRequestException('TikTok no devolvió task_id');
    }

    let status = String(createJson.data?.status || '').toUpperCase();
    for (let attempt = 0; attempt < 45 && status !== 'SUCCEED'; attempt += 1) {
      if (status === 'FAILED' || status === 'CANCEL') {
        throw new BadRequestException(
          `TikTok lead/task falló status=${status}`,
        );
      }
      await this.sleep(2000);
      const pollRes = await fetch(`${TT_API_BASE}/page/lead/task/`, {
        method: 'POST',
        headers: {
          'Access-Token': token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          advertiser_id: advertiserId,
          task_id: taskId,
        }),
      });
      const pollJson = (await pollRes.json()) as {
        code?: number;
        message?: string;
        data?: { status?: string };
      };
      if (!pollRes.ok || pollJson.code !== 0) {
        throw new BadRequestException(
          pollJson.message ||
            `TikTok lead/task poll error code=${pollJson.code ?? pollRes.status}`,
        );
      }
      status = String(pollJson.data?.status || '').toUpperCase();
    }
    if (status !== 'SUCCEED') {
      throw new BadRequestException(
        `TikTok lead/task timeout status=${status || 'unknown'}`,
      );
    }

    const dlUrl = new URL(`${TT_API_BASE}/page/lead/task/download/`);
    dlUrl.searchParams.set('advertiser_id', advertiserId);
    dlUrl.searchParams.set('task_id', taskId);
    const dlRes = await fetch(dlUrl, {
      headers: { 'Access-Token': token },
    });
    const contentType = String(dlRes.headers.get('content-type') || '');
    const rawText = await dlRes.text();
    if (!dlRes.ok) {
      throw new BadRequestException(
        `TikTok lead/task/download HTTP ${dlRes.status}`,
      );
    }

    let notices: LeadNotice[] = [];
    if (contentType.includes('json') || rawText.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(rawText) as {
          code?: number;
          message?: string;
          data?: unknown;
        };
        if (parsed.code != null && parsed.code !== 0) {
          throw new BadRequestException(
            parsed.message || `download error code=${parsed.code}`,
          );
        }
        const data = parsed.data;
        const list = Array.isArray(data)
          ? data
          : Array.isArray((data as { list?: unknown })?.list)
            ? ((data as { list: unknown[] }).list)
            : Array.isArray((data as { leads?: unknown })?.leads)
              ? ((data as { leads: unknown[] }).leads)
              : [];
        for (const item of list) {
          const row = (item && typeof item === 'object'
            ? item
            : {}) as Record<string, unknown>;
          const leadData =
            (row.lead_data as Record<string, unknown>) ||
            (row.field_data as Record<string, unknown>) ||
            row;
          const meta = (row.meta_data as Record<string, unknown>) || {};
          const notice = this.rowToLeadNotice(
            {
              ...leadData,
              lead_id: row.lead_id ?? meta.lead_id,
              page_id: row.page_id ?? meta.page_id ?? formIdNorm,
              advertiser_id: row.advertiser_id ?? advertiserId,
              ad_id: row.ad_id ?? meta.ad_id,
              create_time: row.create_time ?? meta.create_time,
            },
            { formId: formIdNorm, advertiserId },
          );
          if (notice) notices.push(notice);
        }
      } catch (err) {
        if (err instanceof BadRequestException) throw err;
        notices = this.parseCsvRows(rawText)
          .map((row) =>
            this.rowToLeadNotice(row, {
              formId: formIdNorm,
              advertiserId,
            }),
          )
          .filter((n): n is LeadNotice => Boolean(n));
      }
    } else {
      notices = this.parseCsvRows(rawText)
        .map((row) =>
          this.rowToLeadNotice(row, {
            formId: formIdNorm,
            advertiserId,
          }),
        )
        .filter((n): n is LeadNotice => Boolean(n));
    }

    let imported = 0;
    for (const notice of notices) {
      try {
        const result = await this.ingestLead(notice);
        if (result.created) imported += 1;
      } catch (err) {
        this.logger.warn(
          `TikTok backfill skip ${notice.lead_id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    return { imported };
  }

  async listFormLeads(
    area: string,
    opts: {
      formId?: string;
      formName?: string;
      q?: string;
      limit?: number;
      offset?: number;
    } = {},
  ) {
    const areaNorm = normalizeArea(area);
    const take = Math.min(Math.max(opts.limit ?? 25, 1), 200);
    const skip = Math.max(opts.offset ?? 0, 0);
    const formId = String(opts.formId ?? '').trim();
    const formNameQ = String(opts.formName ?? '').trim();
    const q = String(opts.q ?? '').trim();

    let formIdsFromName: string[] | undefined;
    if (formNameQ) {
      const routes = await this.prisma.tiktok_lead_form_routes.findMany({
        where: {
          form_name: { contains: formNameQ, mode: 'insensitive' },
        },
        select: { form_id: true },
      });
      formIdsFromName = routes.map((r) => r.form_id);
      if (formIdsFromName.length === 0) {
        return { items: [], total: 0 };
      }
    }

    const where: Prisma.tiktok_leadsWhereInput = {
      area: areaNorm,
    };
    if (formId && formIdsFromName) {
      where.form_id = formIdsFromName.includes(formId)
        ? formId
        : { in: [] };
    } else if (formId) {
      where.form_id = formId;
    } else if (formIdsFromName) {
      where.form_id = { in: formIdsFromName };
    }
    if (q) {
      where.OR = [
        { lead_id: { contains: q } },
        { form_id: { contains: q } },
        { contacts: { name: { contains: q, mode: 'insensitive' } } },
        { contacts: { phone: { contains: q } } },
        { contacts: { email: { contains: q, mode: 'insensitive' } } },
      ];
    }

    const [total, rows, routes] = await Promise.all([
      this.prisma.tiktok_leads.count({ where }),
      this.prisma.tiktok_leads.findMany({
        where,
        orderBy: [{ created_time: 'desc' }, { id: 'desc' }],
        take,
        skip,
        include: {
          contacts: {
            select: {
              id: true,
              name: true,
              phone: true,
              email: true,
              lead_status: { select: { label: true } },
            },
          },
        },
      }),
      this.prisma.tiktok_lead_form_routes.findMany({
        select: { form_id: true, form_name: true },
      }),
    ]);

    const nameByForm = new Map(
      routes.map((r) => [r.form_id, r.form_name] as const),
    );

    const items = rows.map((row) => ({
      id: row.id,
      lead_id: row.lead_id,
      form_id: row.form_id,
      form_name: nameByForm.get(row.form_id) || null,
      created_time: row.created_time,
      chat_conversation_id: null as number | null,
      came_with_inbound: false,
      contacts: row.contacts,
    }));

    return { items, total };
  }

  async processWebhook(body: unknown): Promise<number> {
    const notices = this.extractLeadNotices(body);
    if (notices.length === 0) {
      const keys =
        body && typeof body === 'object' && !Array.isArray(body)
          ? Object.keys(body as object).join(',')
          : typeof body;
      this.logger.warn(
        `Webhook TikTok: sin lead_id reconocible en el body (keys/type=${keys || 'empty'})`,
      );
      // This endpoint is dedicated to LEAD notifications. Acknowledge only
      // payloads that we can identify; otherwise TikTok would consider a
      // malformed or newly changed payload delivered successfully.
      throw new BadRequestException(
        'Webhook TikTok: payload sin lead_id reconocible',
      );
    }

    let ingested = 0;
    for (const notice of notices) {
      try {
        const result = await this.ingestLead(notice);
        if (result.created) {
          ingested += 1;
          this.logger.log(
            `TikTok lead ingestado ${result.lead_id} contact=${result.contact_id}`,
          );
        } else {
          this.logger.log(
            `TikTok lead ya existía ${result.lead_id} contact=${result.contact_id}`,
          );
        }
      } catch (err) {
        this.logger.warn(
          `TikTok ingest failed ${notice.lead_id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        // Do not acknowledge a notification that was not persisted. TikTok
        // can retry non-2xx deliveries; returning 200 here permanently loses
        // the lead when lead/get or the database has a transient failure.
        throw err;
      }
    }
    return ingested;
  }
}
