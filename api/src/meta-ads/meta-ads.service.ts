import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import {
  adDisplayLabel,
  formatAdPlatformLabel,
  type MetaCtwaAdDetail,
  type MetaCtwaAdLead,
  type MetaCtwaAdListItem,
} from './meta-ads.types';

@Injectable()
export class MetaAdsService {
  constructor(private readonly prisma: PrismaService) {}

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
              select: { id: true, email: true, first_name: true, last_name: true },
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
          ? [lead.contacts.name, lead.contacts.last_name].filter(Boolean).join(' ')
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
