import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { META_SETTING_KEYS } from '../meta-settings/meta-settings.keys';
import {
  getStoredMetaRows,
  normalizeSecretValue,
} from '../meta-settings/meta-settings.store';
import { getWhatsAppCredentialsForArea } from '../templates/whatsapp-meta.util';
import { PrismaService } from '../prisma/prisma.service';
import {
  adDisplayLabel,
  formatAdPlatformLabel,
  type MetaCtwaAdDetail,
  type MetaCtwaAdLead,
  type MetaCtwaAdListItem,
} from './meta-ads.types';

const GRAPH_BASE = 'https://graph.facebook.com/v23.0';
const GRAPH_BATCH_SIZE = 40;

@Injectable()
export class MetaAdsService {
  constructor(private readonly prisma: PrismaService) {}

  private resolveGraphToken(area: AuthUser['area']): string {
    const cache = getStoredMetaRows();
    const row = cache[area] || {};
    const global = cache.global || {};
    const pageToken = normalizeSecretValue(
      row[META_SETTING_KEYS.pageAccessToken] ||
        global[META_SETTING_KEYS.pageAccessToken] ||
        process.env.META_PAGE_ACCESS_TOKEN ||
        '',
    );
    if (pageToken) return pageToken;
    const wa = getWhatsAppCredentialsForArea(area);
    return normalizeSecretValue(wa.token || '');
  }

  private isGraphAdId(metaSourceId: string): boolean {
    const id = String(metaSourceId || '').trim();
    if (!id || id.startsWith('clid:')) return false;
    return /^\d{5,}$/.test(id);
  }

  /**
   * Rellena display_name vacío con GET Graph ?ids=…&fields=name (no pisa nombres manuales).
   */
  async syncDisplayNamesFromGraph(area: AuthUser['area']): Promise<{
    checked: number;
    updated: number;
    failed: number;
    skipped: number;
  }> {
    const token = this.resolveGraphToken(area);
    if (!token) {
      throw new BadRequestException(
        'Falta page access token o WhatsApp token para leer nombres de anuncios en Graph',
      );
    }

    const unnamed = await this.prisma.meta_ctwa_ads.findMany({
      where: {
        area,
        OR: [{ display_name: null }, { display_name: '' }],
      },
      select: { id: true, meta_source_id: true },
      orderBy: { id: 'asc' },
    });

    const candidates = unnamed.filter((row) =>
      this.isGraphAdId(row.meta_source_id),
    );
    const skipped = unnamed.length - candidates.length;

    let updated = 0;
    let failed = 0;

    for (let i = 0; i < candidates.length; i += GRAPH_BATCH_SIZE) {
      const chunk = candidates.slice(i, i + GRAPH_BATCH_SIZE);
      const ids = chunk.map((r) => r.meta_source_id);
      const url = new URL(`${GRAPH_BASE}/`);
      url.searchParams.set('ids', ids.join(','));
      url.searchParams.set('fields', 'name');
      url.searchParams.set('access_token', token);

      const res = await fetch(url);
      const json = (await res.json()) as Record<
        string,
        { name?: string; id?: string; error?: { message?: string } }
      > & { error?: { message?: string } };

      if (!res.ok || json.error) {
        throw new BadRequestException(
          json.error?.message ||
            'Error de Graph al sincronizar nombres de anuncios',
        );
      }

      for (const row of chunk) {
        const entry = json[row.meta_source_id];
        if (!entry || entry.error) {
          failed += 1;
          continue;
        }
        const name = String(entry.name ?? '')
          .trim()
          .slice(0, 200);
        if (!name) {
          failed += 1;
          continue;
        }
        await this.prisma.meta_ctwa_ads.update({
          where: { id: row.id },
          data: { display_name: name, updated_at: new Date() },
        });
        updated += 1;
      }
    }

    return {
      checked: candidates.length,
      updated,
      failed,
      skipped,
    };
  }

  async list(area: AuthUser['area']): Promise<MetaCtwaAdListItem[]> {
    const rows = await this.prisma.meta_ctwa_ads.findMany({
      where: { area },
      orderBy: [{ last_seen_at: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        meta_source_id: true,
        display_name: true,
        ad_platform: true,
        source_url: true,
        source_type: true,
        headline: true,
        body: true,
        lead_count: true,
        first_seen_at: true,
        last_seen_at: true,
      },
    });

    return rows.map((row) => ({
      ...row,
      display_label: adDisplayLabel(row),
      platform_label: formatAdPlatformLabel(row.ad_platform),
    }));
  }

  async getDetail(
    area: AuthUser['area'],
    adId: number,
  ): Promise<{ ad: MetaCtwaAdDetail; leads: MetaCtwaAdLead[] }> {
    const row = await this.prisma.meta_ctwa_ads.findFirst({
      where: { id: adId, area },
    });

    if (!row) {
      throw new NotFoundException('Anuncio no encontrado');
    }

    const leads = await this.prisma.meta_ctwa_ad_leads.findMany({
      where: { meta_ctwa_ad_id: adId, area },
      orderBy: { first_message_at: 'desc' },
      select: {
        phone: true,
        first_message_at: true,
        conversation_id: true,
        contact_id: true,
        contacts: {
          select: {
            id: true,
            name: true,
            last_name: true,
            email: true,
            lead_score: true,
            lead_status: { select: { id: true, slug: true, label: true } },
            contact_segments: { select: { segment_slug: true } },
          },
        },
        conversations: {
          select: {
            id: true,
            status: true,
            archived: true,
            last_message_at: true,
            assigned_user_id: true,
            assigned_user: {
              select: {
                id: true,
                email: true,
                first_name: true,
                last_name: true,
              },
            },
          },
        },
      },
    });

    const ad: MetaCtwaAdDetail = {
      id: row.id,
      meta_source_id: row.meta_source_id,
      display_name: row.display_name,
      ad_platform: row.ad_platform,
      source_url: row.source_url,
      source_type: row.source_type,
      headline: row.headline,
      body: row.body,
      media_type: row.media_type,
      image_url: row.image_url,
      ctwa_clid: row.ctwa_clid,
      lead_count: row.lead_count,
      first_seen_at: row.first_seen_at,
      last_seen_at: row.last_seen_at,
      referral_snapshot: row.referral_snapshot,
      display_label: adDisplayLabel(row),
      platform_label: formatAdPlatformLabel(row.ad_platform),
    };

    return {
      ad,
      leads: leads.map((lead) => ({
        phone: lead.phone,
        first_message_at: lead.first_message_at,
        contact_name: lead.contacts
          ? [lead.contacts.name, lead.contacts.last_name]
              .filter(Boolean)
              .join(' ')
          : null,
        contact_id: lead.contacts?.id ?? lead.contact_id ?? null,
        contact_email: lead.contacts?.email ?? null,
        lead_score: lead.contacts?.lead_score ?? null,
        lead_status: lead.contacts?.lead_status ?? null,
        segment_slugs:
          lead.contacts?.contact_segments.map((s) => s.segment_slug) ?? [],
        conversation_id: lead.conversation_id,
        conversation_status: lead.conversations?.status ?? null,
        conversation_archived: lead.conversations?.archived ?? false,
        last_message_at: lead.conversations?.last_message_at ?? null,
        assigned_user: lead.conversations?.assigned_user
          ? {
              id: lead.conversations.assigned_user.id,
              email: lead.conversations.assigned_user.email,
              name: [
                lead.conversations.assigned_user.first_name,
                lead.conversations.assigned_user.last_name,
              ]
                .filter(Boolean)
                .join(' '),
            }
          : null,
      })),
    };
  }

  async updateDisplayName(
    area: AuthUser['area'],
    adId: number,
    displayName: string | undefined,
  ): Promise<MetaCtwaAdDetail> {
    const existing = await this.prisma.meta_ctwa_ads.findFirst({
      where: { id: adId, area },
    });
    if (!existing) {
      throw new NotFoundException('Anuncio no encontrado');
    }

    const name =
      String(displayName ?? '')
        .trim()
        .slice(0, 200) || null;

    const row = await this.prisma.meta_ctwa_ads.update({
      where: { id: adId },
      data: { display_name: name, updated_at: new Date() },
    });

    return {
      id: row.id,
      meta_source_id: row.meta_source_id,
      display_name: row.display_name,
      ad_platform: row.ad_platform,
      source_url: row.source_url,
      source_type: row.source_type,
      headline: row.headline,
      body: row.body,
      media_type: row.media_type,
      image_url: row.image_url,
      ctwa_clid: row.ctwa_clid,
      lead_count: row.lead_count,
      first_seen_at: row.first_seen_at,
      last_seen_at: row.last_seen_at,
      referral_snapshot: row.referral_snapshot,
      display_label: adDisplayLabel(row),
      platform_label: formatAdPlatformLabel(row.ad_platform),
    };
  }
}
