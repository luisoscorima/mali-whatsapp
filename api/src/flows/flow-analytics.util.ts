import type { Prisma } from '@prisma/client';
import type {
  FlowAnalytics,
  FlowEventContactRow,
  FlowEventType,
  FlowNodeAnalytics,
  FlowNodeKind,
} from './flows.types';

export function nodeLabelSnapshot(
  kind: string,
  bodyText: string | null | undefined,
  mediaFilename?: string | null,
): string {
  const body = String(bodyText || '')
    .trim()
    .replace(/\s+/g, ' ');
  if (body) return body.slice(0, 120);
  const file = String(mediaFilename || '').trim();
  if (kind === 'message_image') return file ? `Imagen: ${file}` : 'Imagen';
  if (kind === 'message_document') {
    return file ? `Archivo: ${file}` : 'Documento';
  }
  if (kind === 'handoff_human') return 'Derivar a asesor';
  if (kind === 'end') return 'Fin del flujo';
  return 'Mensaje';
}

type EventWriter = {
  flow_session_events: {
    create: (args: {
      data: Prisma.flow_session_eventsUncheckedCreateInput;
    }) => Promise<unknown>;
  };
};

export async function recordFlowEvent(
  prisma: EventWriter,
  input: {
    flowId: number;
    sessionId: number;
    conversationId: number;
    nodeId?: number | null;
    clientKey?: string | null;
    nodeKind?: string | null;
    nodeLabel?: string | null;
    eventType: FlowEventType;
    matchPayload?: string | null;
  },
): Promise<void> {
  await prisma.flow_session_events.create({
    data: {
      flow_id: input.flowId,
      session_id: input.sessionId,
      conversation_id: input.conversationId,
      node_id: input.nodeId ?? null,
      client_key: input.clientKey ? String(input.clientKey).slice(0, 64) : null,
      node_kind: input.nodeKind ? String(input.nodeKind).slice(0, 32) : null,
      node_label: input.nodeLabel
        ? String(input.nodeLabel).slice(0, 200)
        : null,
      event_type: input.eventType,
      match_payload: input.matchPayload
        ? String(input.matchPayload).slice(0, 256)
        : null,
    },
  });
}

type EventAggRow = {
  client_key: string | null;
  event_type: string;
  count: bigint | number;
};

type WaitingRow = {
  client_key: string | null;
  count: bigint | number;
};

export function buildFlowAnalytics(input: {
  sessions: { status: string }[];
  nodes: {
    id: number;
    client_key: string | null;
    kind: string;
    body_text: string | null;
    media_filename?: string | null;
  }[];
  eventAggs: EventAggRow[];
  waitingByKey: WaitingRow[];
  timeoutClosed: number;
}): FlowAnalytics {
  const started = input.sessions.length;
  const active = input.sessions.filter((s) => s.status === 'active').length;
  const completed = input.sessions.filter(
    (s) => s.status === 'completed',
  ).length;
  const handed_off = input.sessions.filter(
    (s) => s.status === 'handed_off',
  ).length;

  const enteredMap = new Map<string, number>();
  const repliedMap = new Map<string, number>();

  for (const row of input.eventAggs) {
    const key = String(row.client_key || '').trim();
    if (!key) continue;
    const n = Number(row.count) || 0;
    if (row.event_type === 'entered') {
      enteredMap.set(key, (enteredMap.get(key) || 0) + n);
    } else if (row.event_type === 'replied') {
      repliedMap.set(key, (repliedMap.get(key) || 0) + n);
    }
  }

  const waitingMap = new Map<string, number>();
  for (const row of input.waitingByKey) {
    const key = String(row.client_key || '').trim();
    if (!key) continue;
    waitingMap.set(key, Number(row.count) || 0);
  }

  const currentKeys = new Set<string>();
  const nodes: FlowNodeAnalytics[] = input.nodes.map((n) => {
    const key = String(n.client_key || `n_${n.id}`);
    currentKeys.add(key);
    const label = nodeLabelSnapshot(n.kind, n.body_text, n.media_filename);
    return {
      client_key: key,
      node_id: n.id,
      label,
      kind: n.kind,
      entered: enteredMap.get(key) || 0,
      replied: repliedMap.get(key) || 0,
      waiting: waitingMap.get(key) || 0,
      deleted: false,
    };
  });

  for (const [key, entered] of enteredMap) {
    if (currentKeys.has(key)) continue;
    nodes.push({
      client_key: key,
      node_id: null,
      label: `Paso eliminado (${key})`,
      kind: 'unknown',
      entered,
      replied: repliedMap.get(key) || 0,
      waiting: waitingMap.get(key) || 0,
      deleted: true,
    });
  }

  return {
    started,
    active,
    completed,
    handed_off,
    timeout_closed: input.timeoutClosed,
    nodes,
  };
}

export function asFlowNodeKind(value: string): FlowNodeKind {
  if (
    value === 'message_text' ||
    value === 'message_buttons' ||
    value === 'message_image' ||
    value === 'message_document' ||
    value === 'handoff_human' ||
    value === 'end'
  ) {
    return value;
  }
  return 'message_text';
}

export type { FlowEventContactRow };
