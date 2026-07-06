import { Prisma } from '@prisma/client';
import { AuditEvent } from '../audit/audit-events';
import type { AuditLogService } from '../audit/audit-log.service';
import { formatAdvisorLabel } from '../users/advisor-label.util';
import type { PrismaService } from '../prisma/prisma.service';
import {
  isHumanAdvisorOutboundMessage,
  matchAuditSenderActor,
  readMessageSenderUserId,
} from './chat-sender.util';

const BACKFILL_FLAG = 'migration.conversation_auto_assign_v1';
const BATCH_SIZE = 100;

type BackfillStats = {
  scanned: number;
  assigned: number;
  skipped: number;
  errors: number;
  already_done?: boolean;
};

type AssigneeRow = {
  id: number;
  email: string;
  first_name: string | null;
  last_name: string | null;
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
    create: { area: 'global', key: flag, value },
    update: { value, updated_at: new Date() },
  });
}

function assigneeWhere(area: string) {
  return {
    is_provisioned: true,
    OR: [{ area }, { is_master: true }, { user_areas: { some: { area } } }],
  };
}

async function findAssigneeInArea(
  prisma: PrismaService,
  area: string,
  userId: number,
): Promise<AssigneeRow | null> {
  return prisma.users.findFirst({
    where: { id: userId, ...assigneeWhere(area) },
    select: { id: true, email: true, first_name: true, last_name: true },
  });
}

async function findUserByEmailInArea(
  prisma: PrismaService,
  area: string,
  email: string,
): Promise<AssigneeRow | null> {
  const normalized = email.trim();
  if (!normalized) return null;
  return prisma.users.findFirst({
    where: {
      email: { equals: normalized, mode: 'insensitive' },
      ...assigneeWhere(area),
    },
    select: { id: true, email: true, first_name: true, last_name: true },
  });
}

export async function resolveLastHumanAdvisorUserId(
  prisma: PrismaService,
  area: string,
  conversationId: number,
): Promise<{ userId: number; label: string } | null> {
  const messageRows = await prisma.chat_messages.findMany({
    where: { conversation_id: conversationId, direction: 'outbound' },
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    take: 100,
    select: {
      body_text: true,
      message_type: true,
      created_at: true,
      is_ai: true,
      raw_payload: true,
    },
  });

  const humanMessage = messageRows.find((row) =>
    isHumanAdvisorOutboundMessage(row.raw_payload, row.is_ai, row.message_type),
  );
  if (!humanMessage) return null;

  const storedUserId = readMessageSenderUserId(humanMessage.raw_payload);
  if (storedUserId) {
    const assignee = await findAssigneeInArea(prisma, area, storedUserId);
    if (assignee) {
      return { userId: assignee.id, label: formatAdvisorLabel(assignee) };
    }
  }

  const audits = await prisma.$queryRaw<
    { actor_email: string | null; created_at: Date; meta: unknown }[]
  >(Prisma.sql`
    SELECT actor_email, created_at, meta
    FROM audit_logs
    WHERE area = ${area}
      AND event_type = ${AuditEvent.CONVERSATION_REPLY}
      AND (meta->>'conversation_id')::int = ${conversationId}
    ORDER BY created_at ASC
  `);
  if (!audits.length) return null;

  const actor = matchAuditSenderActor(
    {
      body_text: humanMessage.body_text,
      created_at: humanMessage.created_at.toISOString(),
      message_type: humanMessage.message_type,
    },
    audits,
  );
  if (!actor?.actorEmail) return null;

  const assignee = await findUserByEmailInArea(prisma, area, actor.actorEmail);
  if (!assignee) return null;
  return { userId: assignee.id, label: formatAdvisorLabel(assignee) };
}

export async function autoAssignConversationIfUnassigned(
  prisma: PrismaService,
  auditLog: AuditLogService,
  area: string,
  conversationId: number,
  source: 'auto_reply' | 'auto_last_sender',
  explicit?: { userId: number; label: string },
): Promise<boolean> {
  const conversation = await prisma.conversations.findFirst({
    where: { id: conversationId, area },
    select: { id: true, assigned_user_id: true },
  });
  if (!conversation || conversation.assigned_user_id) return false;

  const assignee =
    explicit ?? (await resolveLastHumanAdvisorUserId(prisma, area, conversationId));
  if (!assignee) return false;

  const valid = await findAssigneeInArea(prisma, area, assignee.userId);
  if (!valid) return false;

  await prisma.conversations.update({
    where: { id: conversationId },
    data: {
      assigned_user_id: assignee.userId,
      assigned_at: new Date(),
      updated_at: new Date(),
    },
  });

  await auditLog.write({
    event_type: AuditEvent.CONVERSATION_ASSIGN,
    message: `Conversación ${conversationId} autoasignada a ${assignee.label}`,
    actor: { area, email: 'system@mali' },
    meta: {
      conversation_id: conversationId,
      from_user_id: null,
      to_user_id: assignee.userId,
      to_user_label: assignee.label,
      source,
    },
  });

  return true;
}

export async function backfillUnassignedConversationAssignments(
  prisma: PrismaService,
  auditLog: AuditLogService,
): Promise<BackfillStats> {
  if (await isBackfillDone(prisma, BACKFILL_FLAG)) {
    return { scanned: 0, assigned: 0, skipped: 0, errors: 0, already_done: true };
  }

  const stats: BackfillStats = { scanned: 0, assigned: 0, skipped: 0, errors: 0 };
  let lastId = 0;

  while (true) {
    const batch = await prisma.conversations.findMany({
      where: { assigned_user_id: null, id: { gt: lastId } },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      select: { id: true, area: true },
    });
    if (!batch.length) break;

    for (const row of batch) {
      stats.scanned++;
      lastId = row.id;
      try {
        const ok = await autoAssignConversationIfUnassigned(
          prisma,
          auditLog,
          row.area,
          row.id,
          'auto_last_sender',
        );
        if (ok) stats.assigned++;
        else stats.skipped++;
      } catch {
        stats.errors++;
      }
    }
  }

  await markBackfillDone(prisma, BACKFILL_FLAG, stats);
  return stats;
}
