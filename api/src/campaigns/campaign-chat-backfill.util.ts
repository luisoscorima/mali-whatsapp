import type { Prisma } from '@prisma/client';
import { normalizePhone } from '../contacts/contacts-validation.utils';
import type { PrismaService } from '../prisma/prisma.service';
import { persistCampaignChatMessage } from './campaign-chat-message.util';
import { parseCampaignPayload } from './campaign-payload.util';
import {
  applyCampaignImageFallback,
  buildCampaignMessagePreview,
  buildSendContextFromCampaign,
  type CampaignMessagePreview,
} from './campaign-message-preview.util';
import {
  buildParamsForContact,
  fetchContactAttributesMap,
  type StaticTemplateParams,
} from './contact-template-params.util';

const BATCH_SIZE = 200;
const LOGS_BACKFILL_FLAG = 'migration.campaign_chat_from_logs_v1';
const PREVIEW_BACKFILL_FLAG = 'migration.campaign_chat_preview_backfill_v1';
const MEDIA_BACKFILL_FLAG = 'migration.campaign_chat_preview_media_v1';
const TIMESTAMPS_REPAIR_FLAG = 'migration.campaign_chat_timestamps_repair_v1';

type BackfillStats = {
  scanned: number;
  updated: number;
  skipped: number;
  errors: number;
};

async function isBackfillDone(
  prisma: PrismaService,
  flag: string,
): Promise<boolean> {
  const row = await prisma.app_settings.findUnique({
    where: { area_key: { area: 'global', key: flag } },
    select: { key: true },
  });
  return row != null;
}

async function markBackfillDone(
  prisma: PrismaService,
  flag: string,
  stats: unknown,
): Promise<void> {
  const value = JSON.stringify(stats);
  await prisma.app_settings.upsert({
    where: { area_key: { area: 'global', key: flag } },
    create: {
      area: 'global',
      key: flag,
      value,
    },
    update: {
      value,
      updated_at: new Date(),
    },
  });
}

function resolveContactId(row: {
  log_contact_id: number | null;
  conv_contact_id: number | null;
}): number | null {
  if (Number.isInteger(row.log_contact_id) && row.log_contact_id! > 0) {
    return row.log_contact_id;
  }
  if (Number.isInteger(row.conv_contact_id) && row.conv_contact_id! > 0) {
    return row.conv_contact_id;
  }
  return null;
}

type CampaignBackfillRow = {
  id: number;
  area: string;
  template_name: string;
  message_text: string;
  image_url: string | null;
  campaign_payload: unknown;
};

type TemplateBackfillRow = {
  id: number;
  name: string;
  language: string;
  category: string | null;
  components_json: unknown;
};

async function fetchTemplateRow(
  prisma: PrismaService,
  area: string,
  templateName: string,
  cache: Map<string, TemplateBackfillRow | null>,
) {
  const key = `${area}::${templateName}`;
  if (cache.has(key)) return cache.get(key)!;

  const row = await prisma.whatsapp_templates.findFirst({
    where: { area, name: templateName },
    orderBy: [{ synced_at: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      name: true,
      language: true,
      category: true,
      components_json: true,
    },
  });
  cache.set(key, row);
  return row;
}

async function fetchCampaignRow(
  prisma: PrismaService,
  campaignId: number,
  cache: Map<number, CampaignBackfillRow | null>,
) {
  if (!Number.isInteger(campaignId) || campaignId <= 0) return null;
  if (cache.has(campaignId)) return cache.get(campaignId)!;

  const row = await prisma.campaigns.findUnique({
    where: { id: campaignId },
    select: {
      id: true,
      area: true,
      template_name: true,
      message_text: true,
      image_url: true,
      campaign_payload: true,
    },
  });
  cache.set(campaignId, row);
  return row;
}

function rebuildPreviewForContact(
  sendCtx: NonNullable<ReturnType<typeof buildSendContextFromCampaign>>,
  contact: { name?: string | null; phone?: string | null },
  attrs?: Record<string, string>,
  imageUrl?: string | null,
) {
  const staticParams = sendCtx.staticParams as StaticTemplateParams;
  const resolvedParams = sendCtx.paramMapping
    ? buildParamsForContact(
        staticParams,
        sendCtx.paramMapping as Parameters<typeof buildParamsForContact>[1],
        contact,
        attrs,
      )
    : staticParams;

  let preview = buildCampaignMessagePreview(
    sendCtx.def,
    sendCtx.templateSnapshot.components_json,
    resolvedParams,
  );
  preview = applyCampaignImageFallback(preview, imageUrl);

  if (!preview.bodyText && !preview.headerText) {
    return null;
  }
  return preview;
}

/**
 * Crea mensajes de chat a partir de campaign_logs enviados que aún no tienen hilo.
 */
export async function backfillCampaignChatFromLogs(
  prisma: PrismaService,
): Promise<BackfillStats | { skipped: true; reason: string }> {
  if (await isBackfillDone(prisma, LOGS_BACKFILL_FLAG)) {
    return { skipped: true, reason: 'already_done' };
  }

  const stats: BackfillStats = { scanned: 0, updated: 0, skipped: 0, errors: 0 };
  const campaignCache = new Map<number, CampaignBackfillRow | null>();
  const templateCache = new Map<string, TemplateBackfillRow | null>();
  let lastId = 0;

  for (;;) {
    const batch = await prisma.$queryRaw<
      {
        id: number;
        campaign_id: number;
        contact_id: number | null;
        phone: string;
        whatsapp_message_id: string;
        created_at: Date;
      }[]
    >`
      SELECT cl.id, cl.campaign_id, cl.contact_id, cl.phone, cl.whatsapp_message_id, cl.created_at
      FROM campaign_logs cl
      WHERE cl.status = 'sent'
        AND cl.whatsapp_message_id IS NOT NULL
        AND TRIM(cl.whatsapp_message_id) <> ''
        AND NOT EXISTS (
          SELECT 1 FROM chat_messages cm
          WHERE cm.wa_message_id = cl.whatsapp_message_id
        )
        AND cl.id > ${lastId}
      ORDER BY cl.id ASC
      LIMIT ${BATCH_SIZE}
    `;

    if (batch.length === 0) break;

    const contactIds = [
      ...new Set(
        batch
          .map((row) => row.contact_id)
          .filter((id): id is number => typeof id === 'number' && id > 0),
      ),
    ];
    const contactsById = contactIds.length
      ? new Map(
          (
            await prisma.contacts.findMany({
              where: { id: { in: contactIds } },
              select: { id: true, name: true, phone: true },
            })
          ).map((c) => [c.id, c]),
        )
      : new Map<number, { id: number; name: string | null; phone: string }>();
    const attrsMap = await fetchContactAttributesMap(prisma, contactIds);

    for (const row of batch) {
      stats.scanned += 1;
      lastId = row.id;

      try {
        const campaignRow = await fetchCampaignRow(
          prisma,
          row.campaign_id,
          campaignCache,
        );
        if (!campaignRow) {
          stats.skipped += 1;
          continue;
        }

        const templateRow = await fetchTemplateRow(
          prisma,
          campaignRow.area,
          campaignRow.template_name,
          templateCache,
        );
        const sendCtx = buildSendContextFromCampaign(campaignRow, templateRow);
        if (!sendCtx) {
          stats.skipped += 1;
          continue;
        }

        const contact =
          (row.contact_id ? contactsById.get(row.contact_id) : null) ?? {
            name: '',
            phone: row.phone,
          };
        const attrs = row.contact_id ? attrsMap.get(row.contact_id) : undefined;
        const preview = rebuildPreviewForContact(
          sendCtx,
          contact,
          attrs,
          campaignRow.image_url,
        );
        if (!preview) {
          stats.skipped += 1;
          continue;
        }

        await persistCampaignChatMessage(prisma, {
          area: campaignRow.area,
          campaignId: row.campaign_id,
          templateName: campaignRow.template_name,
          contactId: row.contact_id,
          phone: row.phone,
          waMessageId: row.whatsapp_message_id,
          preview,
          sentAt: row.created_at,
        });
        stats.updated += 1;
      } catch {
        stats.errors += 1;
      }
    }
  }

  await markBackfillDone(prisma, LOGS_BACKFILL_FLAG, stats);
  return stats;
}

/**
 * Reconstruye raw_payload.preview en mensajes de campaña antiguos.
 */
export async function backfillCampaignChatPreviews(
  prisma: PrismaService,
): Promise<BackfillStats | { skipped: true; reason: string }> {
  if (await isBackfillDone(prisma, PREVIEW_BACKFILL_FLAG)) {
    return { skipped: true, reason: 'already_done' };
  }

  const stats: BackfillStats = { scanned: 0, updated: 0, skipped: 0, errors: 0 };
  const campaignCache = new Map<number, CampaignBackfillRow | null>();
  const templateCache = new Map<string, TemplateBackfillRow | null>();
  let lastId = 0;

  for (;;) {
    const batch = await prisma.$queryRaw<
      {
        id: number;
        wa_message_id: string | null;
        raw_payload: unknown;
        area: string;
        conv_phone: string;
        conv_contact_id: number | null;
        log_contact_id: number | null;
      }[]
    >`
      SELECT
        cm.id,
        cm.wa_message_id,
        cm.raw_payload,
        conv.area,
        conv.phone AS conv_phone,
        conv.contact_id AS conv_contact_id,
        cl.contact_id AS log_contact_id
      FROM chat_messages cm
      JOIN conversations conv ON conv.id = cm.conversation_id
      LEFT JOIN campaign_logs cl ON cl.whatsapp_message_id = cm.wa_message_id
      WHERE cm.message_type = 'campaign'
        AND (cm.raw_payload IS NULL OR cm.raw_payload->'preview' IS NULL)
        AND cm.id > ${lastId}
      ORDER BY cm.id ASC
      LIMIT ${BATCH_SIZE}
    `;

    if (batch.length === 0) break;

    const contactIds = new Set<number>();
    const phonesByArea = new Map<string, Set<string>>();

    for (const row of batch) {
      const contactId = resolveContactId(row);
      if (contactId) contactIds.add(contactId);
      const phone = normalizePhone(row.conv_phone);
      if (row.area && phone) {
        if (!phonesByArea.has(row.area)) phonesByArea.set(row.area, new Set());
        phonesByArea.get(row.area)!.add(phone);
      }
    }

    const contactsById = contactIds.size
      ? new Map(
          (
            await prisma.contacts.findMany({
              where: { id: { in: [...contactIds] } },
              select: { id: true, name: true, phone: true },
            })
          ).map((c) => [c.id, c]),
        )
      : new Map<number, { id: number; name: string | null; phone: string }>();

    const contactsByAreaPhone = new Map<
      string,
      Map<string, { id: number | null; name: string | null; phone: string }>
    >();
    for (const [area, phones] of phonesByArea.entries()) {
      const phoneList = [...phones];
      if (!phoneList.length) continue;
      const rows = await prisma.$queryRaw<
        { id: number; name: string | null; phone: string }[]
      >`
        SELECT DISTINCT ON (phone) id, name, phone
        FROM contacts
        WHERE area = ${area} AND phone = ANY(${phoneList}::varchar[])
        ORDER BY phone, updated_at DESC NULLS LAST
      `;
      const map = new Map<
        string,
        { id: number | null; name: string | null; phone: string }
      >();
      for (const c of rows) {
        map.set(normalizePhone(c.phone), c);
      }
      contactsByAreaPhone.set(area, map);
    }

    const attrsMap = await fetchContactAttributesMap(prisma, [...contactIds]);

    for (const row of batch) {
      stats.scanned += 1;
      lastId = row.id;

      try {
        const raw =
          row.raw_payload && typeof row.raw_payload === 'object'
            ? (row.raw_payload as Record<string, unknown>)
            : parseCampaignPayload(row.raw_payload) || {};

        const campaignId = parseInt(String(raw.campaign_id || ''), 10);
        const templateName = String(raw.template_name || '').trim();
        let campaignRow = await fetchCampaignRow(
          prisma,
          campaignId,
          campaignCache,
        );

        const area = campaignRow?.area || row.area;
        const tplName = campaignRow?.template_name || templateName;
        if (!area || !tplName) {
          stats.skipped += 1;
          continue;
        }

        if (!campaignRow) {
          campaignRow = {
            id: campaignId,
            area,
            template_name: tplName,
            message_text: '',
            image_url: null,
            campaign_payload: null,
          };
        }

        const templateRow = await fetchTemplateRow(
          prisma,
          area,
          tplName,
          templateCache,
        );
        const sendCtx = buildSendContextFromCampaign(campaignRow, templateRow);
        if (!sendCtx) {
          stats.skipped += 1;
          continue;
        }

        let contact: { id?: number | null; name?: string | null; phone?: string | null } | null =
          null;
        const contactId = resolveContactId(row);
        if (contactId) {
          contact = contactsById.get(contactId) || null;
        }
        if (!contact) {
          const phone = normalizePhone(row.conv_phone);
          const phoneMap = contactsByAreaPhone.get(area);
          contact = phoneMap?.get(phone) || {
            id: contactId,
            name: '',
            phone: row.conv_phone,
          };
        }

        const attrs = contact.id ? attrsMap.get(contact.id) : undefined;
        const preview = rebuildPreviewForContact(
          sendCtx,
          contact,
          attrs,
          campaignRow.image_url,
        );
        if (!preview) {
          stats.skipped += 1;
          continue;
        }

        const nextPayload = {
          ...raw,
          campaign_id: campaignId || raw.campaign_id || null,
          template_name: tplName,
          source: raw.source || 'campaign_send',
          preview,
        };

        await prisma.chat_messages.update({
          where: { id: row.id },
          data: {
            body_text: String(preview.bodyText || '').slice(0, 8000),
            raw_payload: nextPayload as Prisma.InputJsonValue,
          },
        });
        stats.updated += 1;
      } catch {
        stats.errors += 1;
      }
    }
  }

  await markBackfillDone(prisma, PREVIEW_BACKFILL_FLAG, stats);
  return stats;
}

/**
 * Completa headerMediaUrl en previews ya backfilled que usan cabecera imagen.
 */
export async function backfillCampaignChatPreviewMedia(
  prisma: PrismaService,
): Promise<{ updated: number } | { skipped: true; reason: string }> {
  if (await isBackfillDone(prisma, MEDIA_BACKFILL_FLAG)) {
    return { skipped: true, reason: 'already_done' };
  }

  const rows = await prisma.$queryRaw<
    { id: number; raw_payload: unknown; image_url: string | null }[]
  >`
    SELECT cm.id, cm.raw_payload, c.image_url
    FROM chat_messages cm
    JOIN campaigns c ON c.id = (cm.raw_payload->>'campaign_id')::int
    WHERE cm.message_type = 'campaign'
      AND cm.raw_payload->'preview' IS NOT NULL
      AND cm.raw_payload->'preview'->>'headerMediaType' = 'image'
      AND (
        cm.raw_payload->'preview'->>'headerMediaUrl' IS NULL
        OR TRIM(cm.raw_payload->'preview'->>'headerMediaUrl') = ''
      )
      AND c.image_url IS NOT NULL
      AND TRIM(c.image_url) <> ''
  `;

  let updated = 0;
  for (const row of rows) {
    const raw =
      row.raw_payload && typeof row.raw_payload === 'object'
        ? (row.raw_payload as Record<string, unknown>)
        : parseCampaignPayload(row.raw_payload) || {};
    const prev = raw.preview as CampaignMessagePreview | undefined;
    const preview = applyCampaignImageFallback(
      prev ?? {
        headerText: '',
        headerMediaType: null,
        headerMediaUrl: null,
        bodyText: '',
        footerText: '',
        buttons: [],
      },
      row.image_url,
    );
    if (!preview?.headerMediaUrl || preview.headerMediaUrl === prev?.headerMediaUrl) {
      continue;
    }
    const nextPayload = { ...raw, preview };
    await prisma.chat_messages.update({
      where: { id: row.id },
      data: { raw_payload: nextPayload as Prisma.InputJsonValue },
    });
    updated += 1;
  }

  await markBackfillDone(prisma, MEDIA_BACKFILL_FLAG, { updated });
  return { updated };
}

/**
 * Corrige created_at inflado por backfill y last_message_at de conversaciones afectadas.
 */
export async function repairCampaignChatTimestampsFromLogs(
  prisma: PrismaService,
): Promise<{ messagesFixed: number; conversationsFixed: number } | { skipped: true; reason: string }> {
  if (await isBackfillDone(prisma, TIMESTAMPS_REPAIR_FLAG)) {
    return { skipped: true, reason: 'already_done' };
  }

  const messagesFixed = await prisma.$executeRaw`
    UPDATE chat_messages cm
    SET created_at = cl.created_at
    FROM campaign_logs cl
    WHERE cm.wa_message_id = cl.whatsapp_message_id
      AND cm.message_type = 'campaign'
      AND cl.status = 'sent'
      AND cm.created_at > cl.created_at
  `;

  const conversationsFixed = await prisma.$executeRaw`
    UPDATE conversations c
    SET last_message_at = sub.max_at
    FROM (
      SELECT conversation_id, MAX(created_at) AS max_at
      FROM chat_messages
      GROUP BY conversation_id
    ) sub
    WHERE c.id = sub.conversation_id
      AND c.last_message_at > sub.max_at
  `;

  const stats = {
    messagesFixed: Number(messagesFixed),
    conversationsFixed: Number(conversationsFixed),
  };
  await markBackfillDone(prisma, TIMESTAMPS_REPAIR_FLAG, stats);
  return stats;
}

export async function runCampaignChatBackfills(
  prisma: PrismaService,
): Promise<void> {
  await backfillCampaignChatFromLogs(prisma);
  await backfillCampaignChatPreviews(prisma);
  await backfillCampaignChatPreviewMedia(prisma);
  await repairCampaignChatTimestampsFromLogs(prisma);
}
