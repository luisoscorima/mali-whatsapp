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
const FIRST_SENDER_REASSIGN_FLAG = 'migration.conversation_first_sender_reassign_v1';
const BATCH_SIZE = 100;

type BackfillStats = {
  scanned: number;
  assigned: number;
  skipped: number;
  errors: number;
  already_done?: boolean;
};

type FirstSenderReassignBackfillStats = {
  scanned: number;
  updated: number;
  unchanged: number;
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

type HumanOutboundMessage = {
  body_text: string | null;
  message_type: string;
  created_at: Date;
  raw_payload: unknown;
};

async function resolveAssigneeFromHumanMessage(
  prisma: PrismaService,
  area: string,
  conversationId: number,
  humanMessage: HumanOutboundMessage,
): Promise<{ userId: number; label: string } | null> {
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

export async function resolveFirstHumanAdvisorUserId(
  prisma: PrismaService,
  area: string,
  conversationId: number,
): Promise<{ userId: number; label: string } | null> {
  const batchSize = 100;
  let skip = 0;

  while (true) {
    const messageRows = await prisma.chat_messages.findMany({
      where: { conversation_id: conversationId, direction: 'outbound' },
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
      skip,
      take: batchSize,
      select: {
        body_text: true,
        message_type: true,
        created_at: true,
        is_ai: true,
        raw_payload: true,
      },
    });
    if (!messageRows.length) return null;

    const humanMessage = messageRows.find((row) =>
      isHumanAdvisorOutboundMessage(row.raw_payload, row.is_ai, row.message_type),
    );
    if (humanMessage) {
      return resolveAssigneeFromHumanMessage(
        prisma,
        area,
        conversationId,
        humanMessage,
      );
    }

    if (messageRows.length < batchSize) return null;
    skip += batchSize;
  }
}

export async function autoAssignConversationIfUnassigned(
  prisma: PrismaService,
  auditLog: AuditLogService,
  area: string,
  conversationId: number,
  source: 'auto_reply' | 'auto_first_sender',
  explicit?: { userId: number; label: string },
): Promise<boolean> {
  const conversation = await prisma.conversations.findFirst({
    where: { id: conversationId, area },
    select: { id: true, assigned_user_id: true },
  });
  if (!conversation || conversation.assigned_user_id) return false;

  const assignee =
    explicit ?? (await resolveFirstHumanAdvisorUserId(prisma, area, conversationId));
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
          'auto_first_sender',
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

type AutoLastSenderCandidate = {
  conversation_id: number;
  area: string;
  to_user_id: number;
  audit_id: bigint;
};

async function loadAutoLastSenderReassignCandidates(
  prisma: PrismaService,
): Promise<AutoLastSenderCandidate[]> {
  return prisma.$queryRaw<AutoLastSenderCandidate[]>(Prisma.sql`
    WITH last_sender_assigns AS (
      SELECT DISTINCT ON ((meta->>'conversation_id')::int)
        (meta->>'conversation_id')::int AS conversation_id,
        area,
        (meta->>'to_user_id')::int AS to_user_id,
        id AS audit_id
      FROM audit_logs
      WHERE event_type = ${AuditEvent.CONVERSATION_ASSIGN}
        AND meta->>'source' = 'auto_last_sender'
        AND (meta->>'conversation_id')::int IS NOT NULL
        AND (meta->>'to_user_id')::int IS NOT NULL
      ORDER BY (meta->>'conversation_id')::int, created_at DESC, id DESC
    ),
    later_overrides AS (
      SELECT DISTINCT (a.meta->>'conversation_id')::int AS conversation_id
      FROM audit_logs a
      INNER JOIN last_sender_assigns l
        ON l.conversation_id = (a.meta->>'conversation_id')::int
      WHERE a.event_type = ${AuditEvent.CONVERSATION_ASSIGN}
        AND a.id > l.audit_id
        AND (
          a.meta->>'source' = 'auto_reply'
          OR (
            COALESCE(a.meta->>'source', '') = ''
            AND COALESCE(a.actor_email, '') <> 'system@mali'
          )
        )
    )
    SELECT l.conversation_id, l.area, l.to_user_id, l.audit_id
    FROM last_sender_assigns l
    INNER JOIN conversations c
      ON c.id = l.conversation_id
      AND c.area = l.area
    LEFT JOIN later_overrides o ON o.conversation_id = l.conversation_id
    WHERE o.conversation_id IS NULL
      AND c.assigned_user_id IS NOT NULL
      AND c.assigned_user_id = l.to_user_id
    ORDER BY l.conversation_id ASC
  `);
}

export async function backfillFirstSenderHistoricalAssignments(
  prisma: PrismaService,
  auditLog: AuditLogService,
): Promise<FirstSenderReassignBackfillStats> {
  if (await isBackfillDone(prisma, FIRST_SENDER_REASSIGN_FLAG)) {
    return {
      scanned: 0,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      errors: 0,
      already_done: true,
    };
  }

  const stats: FirstSenderReassignBackfillStats = {
    scanned: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    errors: 0,
  };

  const candidates = await loadAutoLastSenderReassignCandidates(prisma);

  for (const row of candidates) {
    stats.scanned++;
    try {
      const firstAssignee = await resolveFirstHumanAdvisorUserId(
        prisma,
        row.area,
        row.conversation_id,
      );
      if (!firstAssignee) {
        stats.skipped++;
        continue;
      }

      if (firstAssignee.userId === row.to_user_id) {
        stats.unchanged++;
        continue;
      }

      const valid = await findAssigneeInArea(prisma, row.area, firstAssignee.userId);
      if (!valid) {
        stats.skipped++;
        continue;
      }

      const stillAssigned = await prisma.conversations.findFirst({
        where: {
          id: row.conversation_id,
          area: row.area,
          assigned_user_id: row.to_user_id,
        },
        select: { id: true },
      });
      if (!stillAssigned) {
        stats.skipped++;
        continue;
      }

      await prisma.conversations.update({
        where: { id: row.conversation_id },
        data: {
          assigned_user_id: firstAssignee.userId,
          assigned_at: new Date(),
          updated_at: new Date(),
        },
      });

      await auditLog.write({
        event_type: AuditEvent.CONVERSATION_ASSIGN,
        message: `Conversación ${row.conversation_id} reasignada a ${firstAssignee.label} (migración primer asesor)`,
        actor: { area: row.area, email: 'system@mali' },
        meta: {
          conversation_id: row.conversation_id,
          from_user_id: row.to_user_id,
          to_user_id: firstAssignee.userId,
          to_user_label: firstAssignee.label,
          source: 'migration_first_sender',
        },
      });

      stats.updated++;
    } catch {
      stats.errors++;
    }
  }

  await markBackfillDone(prisma, FIRST_SENDER_REASSIGN_FLAG, stats);
  return stats;
}
