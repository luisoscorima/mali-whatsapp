import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Client } from 'pg';
import { InboxGateway } from './inbox.gateway';
import {
  InboxEvents,
  INBOX_INVALIDATED_SOCKET_EVENT,
  type InboxDomainEvent,
  type InboxEventName,
} from './inbox-events';

const CHANNEL = 'inbox_events';
const KNOWN = new Set<string>(Object.values(InboxEvents));

/**
 * Equivalente a los callbacks `after_commit` de Chatwoot: los triggers de
 * `chat_messages` y `conversations` hacen NOTIFY al confirmar y aquí se
 * traducen a eventos del dispatcher.
 */
@Injectable()
export class InboxDbListenerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InboxDbListenerService.name);
  private client: Client | null = null;
  private stopped = false;
  private retryMs = 1000;
  private retryTimer: NodeJS.Timeout | null = null;
  /** Tras un corte, al volver a escuchar hay que invalidar clientes. */
  private hadDisconnect = false;

  constructor(
    private readonly events: EventEmitter2,
    private readonly gateway: InboxGateway,
  ) {}

  onModuleInit(): void {
    if (process.env.INBOX_REALTIME_DISABLED === '1') return;
    void this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    await this.client?.end().catch(() => undefined);
  }

  private async connect(): Promise<void> {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString || this.stopped) return;
    const client = new Client({ connectionString });
    client.on('notification', (msg) => this.onNotification(msg.payload));
    client.on('error', (err) => {
      this.logger.warn(`inbox listener error: ${err.message}`);
      this.scheduleReconnect(client);
    });
    client.on('end', () => this.scheduleReconnect(client));
    try {
      await client.connect();
      await client.query(`LISTEN ${CHANNEL}`);
      this.client = client;
      this.retryMs = 1000;
      this.logger.log('inbox realtime: escuchando inbox_events');
      if (this.hadDisconnect) {
        this.hadDisconnect = false;
        this.gateway.emitAll(INBOX_INVALIDATED_SOCKET_EVENT, {
          reason: 'listen_reconnect',
        });
      }
    } catch (err) {
      this.logger.warn(
        `inbox listener no conectó: ${err instanceof Error ? err.message : String(err)}`,
      );
      this.scheduleReconnect(client);
    }
  }

  private scheduleReconnect(client: Client): void {
    if (this.stopped || this.retryTimer) return;
    if (this.client === client) this.client = null;
    this.hadDisconnect = true;
    client.removeAllListeners();
    void client.end().catch(() => undefined);
    const delay = this.retryMs;
    this.retryMs = Math.min(this.retryMs * 2, 30000);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connect();
    }, delay);
    this.retryTimer.unref();
  }

  private onNotification(payload: string | undefined): void {
    if (!payload) return;
    let raw: { k?: string; c?: number; m?: number; u?: boolean; a?: boolean };
    try {
      raw = JSON.parse(payload);
    } catch {
      return;
    }
    const conversationId = Number(raw.c);
    if (!raw.k || !KNOWN.has(raw.k) || !Number.isFinite(conversationId)) return;
    const event: InboxDomainEvent = {
      name: raw.k as InboxEventName,
      conversationId,
      ...(raw.m != null ? { messageId: Number(raw.m) } : {}),
      unreadChanged: Boolean(raw.u),
      archivedChanged: Boolean(raw.a),
    };
    this.events.emit(event.name, event);
  }
}
