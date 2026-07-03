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
        contacts: { select: { name: true } },
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
        contact_name: lead.contacts?.name ?? null,
        conversation_id: lead.conversation_id,
      })),
    };
  }
}
