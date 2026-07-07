import { AuditEvent } from '../audit/audit-events';
import type { InboxTimelineEvent } from './conversations.types';
import { formatAdvisorLabel } from '../users/advisor-label.util';

const DISPLAY_TIMEZONE = 'America/Lima';

export const INBOX_TIMELINE_EVENT_TYPES = [
  AuditEvent.CONVERSATION_ASSIGN,
  AuditEvent.CONVERSATION_MODE,
  AuditEvent.CONTACT_LEAD_SCORE,
  AuditEvent.CONTACT_UPDATED,
] as const;

type AuditRow = {
  id: bigint;
  created_at: Date;
  event_type: string;
  actor_email: string | null;
  meta: unknown;
};

function dayKey(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: DISPLAY_TIMEZONE });
}

export function formatTimelineDateLabel(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const now = new Date();
  const dk = dayKey(date);
  if (dk === dayKey(now)) return 'Hoy';
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (dk === dayKey(yesterday)) return 'Ayer';
  return date.toLocaleDateString('es-PE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: DISPLAY_TIMEZONE,
  });
}

function actorDisplay(email: string | null | undefined): string {
  const raw = String(email ?? '').trim();
  if (!raw) return 'Sistema';
  const local = raw.split('@')[0]?.trim();
  return local || raw;
}

function readMeta(meta: unknown): Record<string, unknown> {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return {};
  return meta as Record<string, unknown>;
}

function segmentLabelsFromSlugs(
  slugs: unknown,
  labelBySlug: Map<string, string>,
): string[] {
  if (!Array.isArray(slugs)) return [];
  return slugs
    .map((slug) => labelBySlug.get(String(slug).trim()) ?? String(slug).trim())
    .filter(Boolean);
}

export function formatInboxTimelineEventLabel(
  row: AuditRow,
  userLabelById: Map<number, string>,
  segmentLabelBySlug: Map<string, string>,
): string | null {
  const meta = readMeta(row.meta);
  const actor = actorDisplay(row.actor_email);
  const eventType = String(row.event_type || '').trim();

  if (eventType === AuditEvent.CONVERSATION_ASSIGN) {
    const toUserId = meta.to_user_id != null ? Number(meta.to_user_id) : null;
    const source = String(meta.source ?? '').trim();
    if (toUserId == null || !Number.isFinite(toUserId)) {
      return `${actor} quitó la asignación`;
    }
    const assignee =
      userLabelById.get(toUserId) ||
      String(meta.to_user_label ?? '').trim() ||
      'asesor';
    if (source === 'auto_reply') {
      return `Asignado a ${assignee} (autoasignación al responder)`;
    }
    if (source === 'auto_first_sender' || source === 'auto_last_sender') {
      return `Asignado a ${assignee} (primer asesor que escribió)`;
    }
    if (source === 'migration_first_sender') {
      return `Reasignado a ${assignee} (primer asesor que escribió)`;
    }
    return `${actor} asignó a ${assignee}`;
  }

  if (eventType === AuditEvent.CONVERSATION_MODE) {
    const status = String(meta.new_status ?? '').trim().toLowerCase();
    if (status === 'bot') return `${actor} cambió a modo Bot`;
    if (status === 'human') return `${actor} cambió a modo Asesor`;
    return `${actor} cambió el modo de la conversación`;
  }

  if (eventType === AuditEvent.CONTACT_LEAD_SCORE) {
    if (meta.cleared === true) {
      return `${actor} quitó la calificación del lead`;
    }
    const score = Number(meta.score);
    if (Number.isInteger(score) && score >= 1 && score <= 5) {
      return `${actor} calificó el lead (${score}/5)`;
    }
    return `${actor} actualizó la calificación del lead`;
  }

  if (eventType === AuditEvent.CONTACT_UPDATED) {
    const segments = segmentLabelsFromSlugs(meta.segments, segmentLabelBySlug);
    if (segments.length > 0) {
      return `${actor} actualizó segmentos: ${segments.join(', ')}`;
    }
    return `${actor} actualizó el contacto`;
  }

  return null;
}

export function mapAuditRowsToTimelineEvents(
  rows: AuditRow[],
  userLabelById: Map<number, string>,
  segmentLabelBySlug: Map<string, string>,
): InboxTimelineEvent[] {
  const events: InboxTimelineEvent[] = [];
  for (const row of rows) {
    const label = formatInboxTimelineEventLabel(
      row,
      userLabelById,
      segmentLabelBySlug,
    );
    if (!label) continue;
    events.push({
      id: String(row.id),
      created_at: row.created_at.toISOString(),
      label,
    });
  }
  return events;
}

export function collectUserIdsFromAuditRows(rows: AuditRow[]): number[] {
  const ids = new Set<number>();
  for (const row of rows) {
    const meta = readMeta(row.meta);
    const toUserId = Number(meta.to_user_id);
    if (Number.isInteger(toUserId) && toUserId > 0) ids.add(toUserId);
  }
  return [...ids];
}

export function advisorLabelFromUserRow(row: {
  id: number;
  first_name: string | null;
  last_name: string | null;
  email: string;
}): [number, string] {
  return [row.id, formatAdvisorLabel(row)];
}
