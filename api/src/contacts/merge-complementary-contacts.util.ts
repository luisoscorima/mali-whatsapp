import { Prisma } from '@prisma/client';
import {
  pickComplementaryKeepDrop,
  type IdentityFields,
} from '../conversations/whatsapp-identity.util';

type Tx = Prisma.TransactionClient;

export type MergeComplementaryResult = {
  keepId: number;
  dropId: number;
  phone: string;
  whatsappUserId: string;
  keepConversationId: number | null;
};

/**
 * Fusiona un contacto solo-phone en el contacto solo-BSUID (o BSUID canónico).
 * Reapunta FKs, une conversaciones si hace falta y desactiva el drop.
 */
export async function mergeComplementaryContacts(
  tx: Tx,
  area: string,
  contactA: IdentityFields & {
    email?: string | null;
    dni?: string | null;
    last_name?: string | null;
    lead_status_id?: number | null;
    lead_score?: number | null;
  },
  contactB: IdentityFields & {
    email?: string | null;
    dni?: string | null;
    last_name?: string | null;
    lead_status_id?: number | null;
    lead_score?: number | null;
  },
): Promise<MergeComplementaryResult> {
  const pair = pickComplementaryKeepDrop(contactA, contactB);
  if (!pair) {
    throw new Error('Contacts are not a complementary BSUID/phone pair');
  }
  const { keep, drop } = pair;
  const phone = String(drop.phone ?? keep.phone ?? '').trim();
  const whatsappUserId = String(
    keep.whatsapp_user_id ?? drop.whatsapp_user_id ?? '',
  ).trim();
  if (!phone || !whatsappUserId) {
    throw new Error('Complementary merge requires phone and BSUID');
  }

  // Liberar unique (area, phone) en el drop
  if (drop.phone) {
    await tx.contacts.update({
      where: { id: drop.id },
      data: { phone: null, updated_at: new Date() },
    });
  }

  const dropFull = drop.id === contactA.id ? contactA : contactB;
  const keepFull = keep.id === contactA.id ? contactA : contactB;

  await tx.contacts.update({
    where: { id: keep.id },
    data: {
      phone: keepFull.phone?.trim() ? keepFull.phone : phone,
      email:
        keepFull.email?.trim() || dropFull.email?.trim() || undefined,
      dni: keepFull.dni?.trim() || dropFull.dni?.trim() || undefined,
      last_name:
        keepFull.last_name?.trim() ||
        dropFull.last_name?.trim() ||
        undefined,
      lead_status_id: keepFull.lead_status_id ?? dropFull.lead_status_id ?? undefined,
      lead_score: keepFull.lead_score ?? dropFull.lead_score ?? undefined,
      updated_at: new Date(),
    },
  });

  await reassignContactFks(tx, drop.id, keep.id);
  const keepConversationId = await mergeComplementaryConversations(
    tx,
    area,
    keep.id,
    drop.id,
    phone,
    whatsappUserId,
  );

  await tx.contacts.update({
    where: { id: drop.id },
    data: { active: false, updated_at: new Date() },
  });

  return {
    keepId: keep.id,
    dropId: drop.id,
    phone,
    whatsappUserId,
    keepConversationId,
  };
}

async function reassignContactFks(
  tx: Tx,
  dropId: number,
  keepId: number,
): Promise<void> {
  await tx.contact_origins.updateMany({
    where: { contact_id: dropId },
    data: { contact_id: keepId, updated_at: new Date() },
  });
  await tx.education_lead_entries.updateMany({
    where: { contact_id: dropId },
    data: { contact_id: keepId },
  });
  await tx.campaign_logs.updateMany({
    where: { contact_id: dropId },
    data: { contact_id: keepId },
  });
  await tx.meta_ctwa_ad_leads.updateMany({
    where: { contact_id: dropId },
    data: { contact_id: keepId },
  });
  await tx.meta_leadgen_leads.updateMany({
    where: { contact_id: dropId },
    data: { contact_id: keepId },
  });
  await tx.tiktok_leads.updateMany({
    where: { contact_id: dropId },
    data: { contact_id: keepId },
  });

  // Segmentos / attrs: copiar ausentes, luego borrar del drop (cascade al desactivar no borra;
  // contact sigue existiendo inactive)
  const dropSegs = await tx.contact_segments.findMany({
    where: { contact_id: dropId },
  });
  for (const seg of dropSegs) {
    await tx.contact_segments.upsert({
      where: {
        contact_id_segment_slug: {
          contact_id: keepId,
          segment_slug: seg.segment_slug,
        },
      },
      create: {
        contact_id: keepId,
        area: seg.area,
        segment_slug: seg.segment_slug,
      },
      update: {},
    });
  }
  const dropAttrs = await tx.contact_attributes.findMany({
    where: { contact_id: dropId },
  });
  for (const attr of dropAttrs) {
    await tx.contact_attributes.upsert({
      where: {
        contact_id_attr_key: {
          contact_id: keepId,
          attr_key: attr.attr_key,
        },
      },
      create: {
        contact_id: keepId,
        attr_key: attr.attr_key,
        attr_value: attr.attr_value,
        updated_at: new Date(),
      },
      update: {},
    });
  }

  const keepHasCycle = await tx.education_lead_cycles.findFirst({
    where: { contact_id: keepId },
    select: { id: true },
  });
  if (!keepHasCycle) {
    await tx.education_lead_cycles.updateMany({
      where: { contact_id: dropId },
      data: { contact_id: keepId, updated_at: new Date() },
    });
  }
}

export async function mergeComplementaryConversations(
  tx: Tx,
  area: string,
  keepContactId: number,
  dropContactId: number | null,
  phone: string,
  whatsappUserId: string,
): Promise<number | null> {
  const byUser = await tx.conversations.findUnique({
    where: {
      area_whatsapp_user_id: { area, whatsapp_user_id: whatsappUserId },
    },
  });
  const byPhone = await tx.conversations.findUnique({
    where: { area_phone: { area, phone } },
  });

  let keepConv = byUser;
  let dropConv =
    byPhone && (!byUser || byPhone.id !== byUser.id) ? byPhone : null;

  // Conversaciones huérfanas ligadas al drop por contact_id
  if (!dropConv && dropContactId != null) {
    dropConv = await tx.conversations.findFirst({
      where: { area, contact_id: dropContactId, id: { not: keepConv?.id } },
    });
  }
  if (!keepConv) {
    keepConv = await tx.conversations.findFirst({
      where: { area, contact_id: keepContactId },
    });
  }

  if (keepConv && dropConv && keepConv.id !== dropConv.id) {
    await tx.conversations.update({
      where: { id: dropConv.id },
      data: { phone: null, updated_at: new Date() },
    });

    const msgCountDrop = await tx.chat_messages.count({
      where: { conversation_id: dropConv.id },
    });
    const msgCountKeep = await tx.chat_messages.count({
      where: { conversation_id: keepConv.id },
    });

    // Preferir como destino el chat con más mensajes; si empate, el del BSUID
    let target = keepConv;
    let source = dropConv;
    if (msgCountDrop > msgCountKeep) {
      target = dropConv;
      source = keepConv;
      // source era BSUID: liberar whatsapp_user_id antes de mover
      await tx.conversations.update({
        where: { id: source.id },
        data: { whatsapp_user_id: null, updated_at: new Date() },
      });
    }

    await tx.chat_messages.updateMany({
      where: { conversation_id: source.id },
      data: { conversation_id: target.id },
    });

    const sourceTags = await tx.conversation_tags.findMany({
      where: { conversation_id: source.id },
    });
    for (const tag of sourceTags) {
      await tx.conversation_tags.upsert({
        where: {
          conversation_id_label: {
            conversation_id: target.id,
            label: tag.label,
          },
        },
        create: {
          conversation_id: target.id,
          label: tag.label,
          source: tag.source,
          meta_source_id: tag.meta_source_id,
        },
        update: {},
      });
    }
    await tx.conversation_tags.deleteMany({
      where: { conversation_id: source.id },
    });

    await tx.flow_sessions.updateMany({
      where: { conversation_id: source.id },
      data: { conversation_id: target.id },
    });
    await tx.flow_session_events.updateMany({
      where: { conversation_id: source.id },
      data: { conversation_id: target.id },
    });
    await tx.contact_origins.updateMany({
      where: { conversation_id: source.id },
      data: { conversation_id: target.id, updated_at: new Date() },
    });

    // CTWA leads: evitar unique (area, ad, conversation)
    const sourceLeads = await tx.meta_ctwa_ad_leads.findMany({
      where: { conversation_id: source.id },
    });
    for (const lead of sourceLeads) {
      const exists = await tx.meta_ctwa_ad_leads.findFirst({
        where: {
          area: lead.area,
          meta_ctwa_ad_id: lead.meta_ctwa_ad_id,
          conversation_id: target.id,
        },
        select: { id: true },
      });
      if (exists) {
        await tx.meta_ctwa_ad_leads.delete({ where: { id: lead.id } });
      } else {
        await tx.meta_ctwa_ad_leads.update({
          where: { id: lead.id },
          data: { conversation_id: target.id },
        });
      }
    }

    await tx.conversations.update({
      where: { id: target.id },
      data: {
        contact_id: keepContactId,
        phone,
        whatsapp_user_id: whatsappUserId,
        assigned_user_id:
          target.assigned_user_id ?? source.assigned_user_id,
        wa_username: target.wa_username ?? source.wa_username,
        wa_profile_name: target.wa_profile_name ?? source.wa_profile_name,
        last_message_at:
          maxDate(target.last_message_at, source.last_message_at) ??
          target.last_message_at,
        last_user_message_at:
          maxDate(target.last_user_message_at, source.last_user_message_at) ??
          target.last_user_message_at,
        inbox_unread: Boolean(target.inbox_unread || source.inbox_unread),
        archived: Boolean(target.archived && source.archived),
        updated_at: new Date(),
      },
    });

    await tx.conversations.delete({ where: { id: source.id } });
    return target.id;
  }

  if (keepConv) {
    await tx.conversations.update({
      where: { id: keepConv.id },
      data: {
        contact_id: keepContactId,
        phone: keepConv.phone ?? phone,
        whatsapp_user_id: keepConv.whatsapp_user_id ?? whatsappUserId,
        updated_at: new Date(),
      },
    });
    if (dropContactId != null) {
      await tx.conversations.updateMany({
        where: { contact_id: dropContactId },
        data: { contact_id: keepContactId, updated_at: new Date() },
      });
    }
    return keepConv.id;
  }

  if (dropConv) {
    await tx.conversations.update({
      where: { id: dropConv.id },
      data: {
        contact_id: keepContactId,
        phone,
        whatsapp_user_id: whatsappUserId,
        updated_at: new Date(),
      },
    });
    return dropConv.id;
  }

  if (dropContactId != null) {
    await tx.conversations.updateMany({
      where: { contact_id: dropContactId },
      data: { contact_id: keepContactId, updated_at: new Date() },
    });
  }
  return null;
}

function maxDate(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a.getTime() >= b.getTime() ? a : b;
}
