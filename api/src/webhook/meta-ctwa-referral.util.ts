import type { Prisma } from '@prisma/client';
import type { BusinessArea } from '../config/areas';
import { PrismaService } from '../prisma/prisma.service';

function extractMessageReferral(msg: Record<string, unknown>): Record<string, unknown> | null {
  if (!msg || typeof msg !== 'object') return null;
  if (msg.referral && typeof msg.referral === 'object') {
    return msg.referral as Record<string, unknown>;
  }
  const context = msg.context as { referral?: Record<string, unknown> } | undefined;
  if (context?.referral && typeof context.referral === 'object') {
    return context.referral;
  }
  return null;
}

function inferAdPlatform(sourceUrl: unknown): string {
  const u = String(sourceUrl || '').toLowerCase();
  if (u.includes('instagram') || u.includes('ig.me')) return 'instagram';
  if (u.includes('facebook') || u.includes('fb.me') || u.includes('fb.com')) {
    return 'facebook';
  }
  return 'other';
}

function referralAdKey(referral: Record<string, unknown>): string | null {
  const sourceId = String(referral.source_id || '').trim();
  if (sourceId) return sourceId;
  const clid = String(referral.ctwa_clid || '').trim();
  if (clid) return `clid:${clid.slice(0, 120)}`;
  return null;
}

export async function processInboundReferral(
  prisma: PrismaService,
  input: {
    area: BusinessArea;
    conversationId: number;
    contactId: number | null;
    phone: string;
    msg: Record<string, unknown>;
  },
): Promise<void> {
  const referral = extractMessageReferral(input.msg);
  if (!referral) return;

  const metaSourceId = referralAdKey(referral);
  if (!metaSourceId) return;

  const ad = await prisma.meta_ctwa_ads.upsert({
    where: {
      area_meta_source_id: {
        area: input.area,
        meta_source_id: metaSourceId,
      },
    },
    create: {
      area: input.area,
      meta_source_id: metaSourceId,
      ad_platform: inferAdPlatform(referral.source_url),
      source_url: referral.source_url ? String(referral.source_url) : null,
      source_type: referral.source_type ? String(referral.source_type) : null,
      headline: referral.headline ? String(referral.headline) : null,
      body: referral.body ? String(referral.body) : null,
      media_type: referral.media_type ? String(referral.media_type) : null,
      image_url: referral.image_url ? String(referral.image_url) : null,
      ctwa_clid: referral.ctwa_clid ? String(referral.ctwa_clid) : null,
      referral_snapshot: referral as Prisma.InputJsonValue,
      first_seen_at: new Date(),
      last_seen_at: new Date(),
      updated_at: new Date(),
    },
    update: {
      ad_platform: inferAdPlatform(referral.source_url),
      source_url: referral.source_url ? String(referral.source_url) : undefined,
      source_type: referral.source_type ? String(referral.source_type) : undefined,
      headline: referral.headline ? String(referral.headline) : undefined,
      body: referral.body ? String(referral.body) : undefined,
      media_type: referral.media_type ? String(referral.media_type) : undefined,
      image_url: referral.image_url ? String(referral.image_url) : undefined,
      ctwa_clid: referral.ctwa_clid ? String(referral.ctwa_clid) : undefined,
      referral_snapshot: referral as Prisma.InputJsonValue,
      last_seen_at: new Date(),
      updated_at: new Date(),
    },
    select: { id: true, ad_platform: true, meta_source_id: true },
  });

  const lead = await prisma.meta_ctwa_ad_leads.createMany({
    data: [
      {
        area: input.area,
        meta_ctwa_ad_id: ad.id,
        conversation_id: input.conversationId,
        contact_id: input.contactId,
        phone: input.phone,
        first_message_at: new Date(),
      },
    ],
    skipDuplicates: true,
  });

  if (lead.count > 0) {
    await prisma.meta_ctwa_ads.update({
      where: { id: ad.id },
      data: { lead_count: { increment: 1 }, updated_at: new Date() },
    });
  }

  await prisma.conversations.update({
    where: { id: input.conversationId },
    data: {
      meta_ctwa_ad_id: ad.id,
      attribution: {
        referral,
        ad_platform: ad.ad_platform,
        meta_source_id: ad.meta_source_id,
        applied_at: new Date().toISOString(),
      } as Prisma.InputJsonValue,
      updated_at: new Date(),
    },
  });
}
