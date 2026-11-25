import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { BUSINESS_AREAS, businessReadScope } from '../config/areas';
import { ConversationsService } from '../conversations/conversations.service';
import type { InboxPushRow } from '../conversations/conversations.types';
import { perfStore } from '../perf/perf-store';
import { PrismaService } from '../prisma/prisma.service';
import { InboxGateway } from './inbox.gateway';
import {
  INBOX_INVALIDATED_SOCKET_EVENT,
  INBOX_SOCKET_EVENT,
  InboxEvents,
  type InboxDomainEvent,
  type InboxEventName,
  type InboxPushPayload,
} from './inbox-events';

/** Junta ráfagas (mensaje + update de conversación del mismo webhook). */
const COALESCE_MS = 150;
/** Más que esto en una ventana = operación masiva: invalidar en lugar de empujar filas. */
const MAX_ROWS_PER_FLUSH = 200;

type Pending = {
  events: Set<InboxEventName>;
  created: Set<number>;
  updated: Set<number>;
  unreadChanged: boolean;
  archivedChanged: boolean;
};

/** Salas `area:{slug}` que ven esta fila (mismo criterio que conversationAreaPredicate). */
export function areaRoomsForRow(area: string, linePrograms: string[]): string[] {
  const rooms: string[] = [];
  for (const slug of BUSINESS_AREAS) {
    const scope = businessReadScope(slug);
    if (!scope.areas.includes(area)) continue;
    if (scope.program && area !== slug && !linePrograms.includes(scope.program)) continue;
    rooms.push(`area:${slug}`);
  }
  return rooms;
}

/**
 * Como `ActionCableListener` + `ActionCableBroadcastJob` de Chatwoot:
 * recibe eventos del dispatcher, recarga la fila fresca y la envía a las salas.
 */
@Injectable()
export class InboxBroadcastService implements OnModuleDestroy {
  private readonly logger = new Logger(InboxBroadcastService.name);
  private pending = new Map<number, Pending>();
  private timer: NodeJS.Timeout | null = null;
  private flushing = false;

  constructor(
    private readonly conversations: ConversationsService,
    private readonly prisma: PrismaService,
    private readonly gateway: InboxGateway,
  ) {}

  onModuleDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  @OnEvent(InboxEvents.messageCreated)
  @OnEvent(InboxEvents.messageUpdated)
  @OnEvent(InboxEvents.conversationCreated)
  @OnEvent(InboxEvents.conversationUpdated)
  onInboxEvent(event: InboxDomainEvent): void {
    let entry = this.pending.get(event.conversationId);
    if (!entry) {
      entry = {
        events: new Set(),
        created: new Set(),
        updated: new Set(),
        unreadChanged: false,
        archivedChanged: false,
      };
      this.pending.set(event.conversationId, entry);
    }
    entry.events.add(event.name);
    if (event.messageId != null) {
      if (event.name === InboxEvents.messageCreated) entry.created.add(event.messageId);
      if (event.name === InboxEvents.messageUpdated) entry.updated.add(event.messageId);
    }
    if (event.unreadChanged) entry.unreadChanged = true;
    if (event.archivedChanged) entry.archivedChanged = true;
    this.schedule();
  }

  private schedule(): void {
    if (this.timer || this.flushing) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, COALESCE_MS);
  }

  private async flush(): Promise<void> {
    if (!this.pending.size) return;
    this.flushing = true;
    const batch = this.pending;
    this.pending = new Map();
    const t0 = Date.now();
    try {
      const ids = [...batch.keys()];
      const bulk = ids.length > MAX_ROWS_PER_FLUSH;
      if (bulk) {
        await this.invalidate(ids);
      } else {
        const rows = await this.conversations.loadInboxPushRows(ids);
        for (const row of rows) this.push(row, batch.get(row.item.id)!);
      }
      perfStore.record('realtime_flush', Date.now() - t0, bulk ? 'bulk' : 'rows');
    } catch (err) {
      this.logger.warn(
        `inbox broadcast falló: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.flushing = false;
      if (this.pending.size) this.schedule();
    }
  }

  private roomsFor(area: string, lineId: number | null, lineProgram: string | null): string[] {
    const rooms = areaRoomsForRow(area, lineProgram ? [lineProgram] : []);
    if (lineId != null) rooms.push(`line:${lineId}`);
    return rooms;
  }

  private push(row: InboxPushRow, entry: Pending): void {
    const payload: InboxPushPayload = {
      conversation_id: row.item.id,
      events: [...entry.events],
      conversation: row.item,
      created_message_ids: [...entry.created],
      updated_message_ids: [...entry.updated],
      unread_changed: entry.unreadChanged,
      archived_changed: entry.archivedChanged,
    };
    this.gateway.emitTo(
      this.roomsFor(row.area, row.whatsappLineId, row.item.line_program),
      INBOX_SOCKET_EVENT,
      payload,
    );
  }

  private async invalidate(ids: number[]): Promise<void> {
    const rows = await this.prisma.conversations.findMany({
      where: { id: { in: ids } },
      select: {
        area: true,
        whatsapp_line_id: true,
        whatsapp_line: {
          select: { program_key: true, program: { select: { slug: true } } },
        },
      },
    });
    const rooms = new Set<string>();
    for (const row of rows) {
      const program = row.whatsapp_line?.program?.slug || row.whatsapp_line?.program_key || null;
      for (const room of this.roomsFor(row.area, row.whatsapp_line_id, program)) rooms.add(room);
    }
    this.gateway.emitTo([...rooms], INBOX_INVALIDATED_SOCKET_EVENT, { reason: 'bulk' });
  }
}
