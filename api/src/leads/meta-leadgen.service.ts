import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { normalizeArea } from '../config/areas';
import { META_SETTING_KEYS } from '../meta-settings/meta-settings.keys';
import {
  getStoredMetaRows,
  normalizeSecretValue,
} from '../meta-settings/meta-settings.store';
import { PrismaService } from '../prisma/prisma.service';
import { LeadsService } from './leads.service';

const GRAPH_BASE = 'https://graph.facebook.com/v23.0';

type LeadgenField = { name?: string; values?: string[] };

type GraphLead = {
  id?: string;
  created_time?: string;
  ad_id?: string;
  adgroup_id?: string;
  form_id?: string;
  field_data?: LeadgenField[];
};

@Injectable()
export class MetaLeadgenService {
  private readonly logger = new Logger(MetaLeadgenService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly leads: LeadsService,
  ) {}

  private async getPageCredentials(area: string): Promise<{
    token: string;
    pageId: string;
  }> {
    const cache = getStoredMetaRows();
    const areaNorm = normalizeArea(area);
    const row = cache[areaNorm] || {};
    const global = cache.global || {};
    const token = normalizeSecretValue(
      row[META_SETTING_KEYS.pageAccessToken] ||
        global[META_SETTING_KEYS.pageAccessToken] ||
        process.env.META_PAGE_ACCESS_TOKEN ||
        '',
    );
    const pageId = String(
      row[META_SETTING_KEYS.pageId] ||
        global[META_SETTING_KEYS.pageId] ||
        process.env.META_PAGE_ID ||
        '',
    ).trim();
    if (!token) {
      throw new BadRequestException(
        'Falta meta.page_access_token para Lead Ads en esta área',
      );
    }
    return { token, pageId };
  }

  private mapFieldData(fieldData: LeadgenField[] | undefined): {
    phone?: string;
    email?: string;
    dni?: string;
    name?: string;
    last_name?: string;
    raw: Record<string, string>;
  } {
    const raw: Record<string, string> = {};
    for (const f of fieldData ?? []) {
      const key = String(f.name ?? '')
        .trim()
        .toLowerCase();
      const value = String(f.values?.[0] ?? '').trim();
      if (key && value) raw[key] = value;
    }

    const pick = (...keys: string[]) => {
      for (const k of keys) {
        if (raw[k]) return raw[k];
      }
      return undefined;
    };

    return {
      phone: pick(
        'phone_number',
        'phone',
        'celular',
        'mobile',
        'teléfono',
        'telefono',
      ),
      email: pick('email', 'correo', 'e-mail'),
      dni: pick('dni', 'document_number', 'documento', 'national_id'),
      name: pick('full_name', 'nombre', 'first_name', 'nombres'),
      last_name: pick('last_name', 'apellidos', 'apellido'),
      raw,
    };
  }

  async fetchLeadFromGraph(
    leadgenId: string,
    token: string,
  ): Promise<GraphLead> {
    const url = new URL(`${GRAPH_BASE}/${encodeURIComponent(leadgenId)}`);
    url.searchParams.set(
      'fields',
      'created_time,id,ad_id,adgroup_id,form_id,field_data',
    );
    url.searchParams.set('access_token', token);
    const res = await fetch(url);
    const json = (await res.json()) as GraphLead & {
      error?: { message?: string };
    };
    if (!res.ok) {
      throw new BadRequestException(
        json.error?.message || `Graph error al leer lead ${leadgenId}`,
      );
    }
    return json;
  }

  async ingestLeadgenId(params: {
    area: string;
    leadgenId: string;
    formId?: string;
    pageId?: string;
    adId?: string;
    adgroupId?: string;
  }): Promise<{ contact_id: number | null; leadgen_id: string; created: boolean }> {
    const area = normalizeArea(params.area);
    const leadgenId = String(params.leadgenId).trim();
    if (!leadgenId) throw new BadRequestException('leadgen_id requerido');

    const existing = await this.prisma.meta_leadgen_leads.findUnique({
      where: { leadgen_id: leadgenId },
    });
    if (existing) {
      return {
        contact_id: existing.contact_id,
        leadgen_id: leadgenId,
        created: false,
      };
    }

    const { token } = await this.getPageCredentials(area);
    const graph = await this.fetchLeadFromGraph(leadgenId, token);
    const mapped = this.mapFieldData(graph.field_data);
    const formId = String(params.formId || graph.form_id || '').trim() || 'unknown';

    await this.prisma.meta_lead_forms.upsert({
      where: { area_form_id: { area, form_id: formId } },
      create: {
        area,
        form_id: formId,
        page_id: params.pageId || null,
        lead_count: 0,
        updated_at: new Date(),
      },
      update: {
        page_id: params.pageId || undefined,
        updated_at: new Date(),
      },
    });

    const origin = await this.leads.upsertOrigin({
      area,
      channel: 'meta_lead_form',
      external_id: leadgenId,
      source_key: formId,
      source_label: formId,
      payload: {
        field_data: graph.field_data,
        mapped: mapped.raw,
        ad_id: params.adId || graph.ad_id,
        form_id: formId,
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

    const createdTime = graph.created_time
      ? new Date(graph.created_time)
      : new Date();

    await this.prisma.meta_leadgen_leads.create({
      data: {
        area,
        leadgen_id: leadgenId,
        form_id: formId,
        page_id: params.pageId || null,
        ad_id: params.adId || graph.ad_id || null,
        adgroup_id: params.adgroupId || graph.adgroup_id || null,
        field_data: (graph.field_data ?? null) as Prisma.InputJsonValue,
        raw: graph as Prisma.InputJsonValue,
        contact_id: origin.contact_id,
        contact_origin_id: origin.origin_id,
        created_time: createdTime,
        updated_at: new Date(),
      },
    });

    await this.prisma.meta_lead_forms.update({
      where: { area_form_id: { area, form_id: formId } },
      data: {
        lead_count: { increment: 1 },
        last_sync_at: new Date(),
        updated_at: new Date(),
      },
    });

    return {
      contact_id: origin.contact_id,
      leadgen_id: leadgenId,
      created: true,
    };
  }

  async processPageLeadgenWebhook(
    body: Record<string, unknown>,
  ): Promise<number> {
    if (body.object !== 'page') return 0;
    const entries = Array.isArray(body.entry) ? body.entry : [];
    let ingested = 0;
    for (const entry of entries) {
      const pageId = String((entry as { id?: string })?.id ?? '').trim();
      const changes = Array.isArray((entry as { changes?: unknown[] })?.changes)
        ? ((entry as { changes: Array<{ field?: string; value?: Record<string, unknown> }> }).changes)
        : [];
      for (const change of changes) {
        if (change.field !== 'leadgen') continue;
        const value = change.value || {};
        const leadgenId = String(value.leadgen_id ?? '').trim();
        if (!leadgenId) continue;
        const formId = String(value.form_id ?? '').trim();
        // Resolve area by page_id setting match, fallback ti
        const area = await this.resolveAreaForPage(pageId);
        try {
          await this.ingestLeadgenId({
            area,
            leadgenId,
            formId,
            pageId,
            adId: value.ad_id ? String(value.ad_id) : undefined,
            adgroupId: value.adgroup_id
              ? String(value.adgroup_id)
              : undefined,
          });
          ingested += 1;
        } catch (err) {
          this.logger.warn(
            `leadgen ingest failed ${leadgenId}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    }
    return ingested;
  }

  private async resolveAreaForPage(pageId: string): Promise<string> {
    if (!pageId) return 'ti';
    const rows = await this.prisma.app_settings.findMany({
      where: { key: META_SETTING_KEYS.pageId, value: pageId },
      select: { area: true },
    });
    if (rows.length === 1) return rows[0].area;
    if (rows.length > 1) return rows[0].area;
    return 'ti';
  }

  async backfillForm(area: string, formId: string): Promise<{ imported: number }> {
    const areaNorm = normalizeArea(area);
    const { token } = await this.getPageCredentials(areaNorm);
    let imported = 0;
    let after: string | undefined;
    do {
      const url = new URL(
        `${GRAPH_BASE}/${encodeURIComponent(formId)}/leads`,
      );
      url.searchParams.set(
        'fields',
        'created_time,id,ad_id,adgroup_id,form_id,field_data',
      );
      url.searchParams.set('access_token', token);
      url.searchParams.set('limit', '50');
      if (after) url.searchParams.set('after', after);
      const res = await fetch(url);
      const json = (await res.json()) as {
        data?: GraphLead[];
        paging?: { cursors?: { after?: string }; next?: string };
        error?: { message?: string };
      };
      if (!res.ok) {
        throw new BadRequestException(
          json.error?.message || `Error bulk leads form ${formId}`,
        );
      }
      for (const lead of json.data ?? []) {
        const id = String(lead.id ?? '').trim();
        if (!id) continue;
        try {
          const result = await this.ingestLeadgenId({
            area: areaNorm,
            leadgenId: id,
            formId: String(lead.form_id || formId),
            adId: lead.ad_id,
            adgroupId: lead.adgroup_id,
          });
          if (result.created) imported += 1;
        } catch (err) {
          this.logger.warn(
            `backfill skip ${id}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
      after = json.paging?.next ? json.paging?.cursors?.after : undefined;
    } while (after);

    return { imported };
  }

  async listForms(area: string) {
    return this.prisma.meta_lead_forms.findMany({
      where: { area: normalizeArea(area) },
      orderBy: { updated_at: 'desc' },
    });
  }

  async listFormLeads(area: string, formId?: string, limit = 50) {
    return this.prisma.meta_leadgen_leads.findMany({
      where: {
        area: normalizeArea(area),
        ...(formId ? { form_id: formId } : {}),
      },
      orderBy: { created_time: 'desc' },
      take: Math.min(limit, 200),
      include: {
        contacts: {
          select: {
            id: true,
            name: true,
            last_name: true,
            phone: true,
            email: true,
            dni: true,
            lead_status: true,
          },
        },
      },
    });
  }

  async getLead(area: string, id: number) {
    const row = await this.prisma.meta_leadgen_leads.findFirst({
      where: { id, area: normalizeArea(area) },
      include: {
        contacts: { include: { lead_status: true } },
        contact_origins: true,
      },
    });
    if (!row) throw new NotFoundException('Lead no encontrado');
    return row;
  }
}
