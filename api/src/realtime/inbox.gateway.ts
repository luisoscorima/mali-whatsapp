import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { DefaultEventsMap, Server, Socket } from 'socket.io';
import { AuthService } from '../auth/auth.service';
import type { AuthUser, JwtPayload } from '../auth/auth.types';
import { hasPermission } from '../auth/roles/has-permission';
import { PERMISSION } from '../auth/roles/permission-codes';
import { AppConfigService } from '../config/app-config.service';
import { runWithBusinessAccess } from '../business-model/business-access.context';
import { visibleConversationWhere } from '../config/business-scope';
import { PrismaService } from '../prisma/prisma.service';
import { formatAdvisorLabel } from '../users/advisor-label.util';

/** Revalida permisos de sockets abiertos (revocación / cambio de líneas). */
const REVALIDATE_MS = 2 * 60 * 1000;
const TYPING_EVENT = 'inbox.typing';
const TYPING_ROOM_PREFIX = 'typing:';

type TypingWatch = {
  conversationId: number;
  label: string;
  active: boolean;
  lastTypingAt: number;
};

type InboxSocket = Socket<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  {
    area?: AuthUser['area'];
    userId?: number;
    user?: AuthUser;
    revalidateTimer?: NodeJS.Timeout;
    typingWatch?: TypingWatch;
    typingRevision?: number;
  }
>;

export function inboxRoomsForUser(user: AuthUser): string[] {
  const access = user.isMaster ? undefined : user.businessAccess;
  if (access?.mode === 'restricted')
    return access.lineIds.map((id) => `line:${id}`);
  return [`area:${user.area}`];
}

function readCookie(header: string | undefined, name: string): string | null {
  for (const part of String(header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

@WebSocketGateway({
  path: '/api/realtime',
  serveClient: false,
  cors: { origin: true, credentials: true },
})
export class InboxGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(InboxGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly auth: AuthService,
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(socket: InboxSocket): Promise<void> {
    const user = await this.authenticate(socket);
    if (!socket.connected) return;
    if (!user) {
      socket.emit('inbox.unauthorized');
      socket.disconnect(true);
      return;
    }
    await this.applyRooms(socket, user);
    if (!socket.connected) return;
    socket.emit('inbox.ready');
    const timer = setInterval(
      () => void this.revalidate(socket),
      REVALIDATE_MS,
    );
    timer.unref();
    socket.data.revalidateTimer = timer;
  }

  handleDisconnect(socket: InboxSocket): void {
    const timer = socket.data.revalidateTimer;
    if (timer) clearInterval(timer);
    this.clearTypingWatch(socket);
  }

  @SubscribeMessage('inbox.watch')
  async watchConversation(
    @ConnectedSocket() socket: InboxSocket,
    @MessageBody() conversationId: unknown,
  ): Promise<void> {
    if (
      conversationId != null &&
      (typeof conversationId !== 'number' ||
        !Number.isInteger(conversationId) ||
        conversationId <= 0 ||
        conversationId > 2_147_483_647)
    )
      return;

    const previous = socket.data.typingWatch;
    if (previous?.conversationId === conversationId) return;
    const revision = this.clearTypingWatch(socket);
    const user = socket.data.user;
    if (!user || typeof conversationId !== 'number') return;

    if (!(await this.canWatch(user, conversationId))) return;
    const advisor = await this.prisma.users.findUnique({
      where: { id: user.id },
      select: { first_name: true, last_name: true, email: true },
    });
    if (
      !socket.connected ||
      socket.data.typingRevision !== revision ||
      socket.data.user !== user
    )
      return;

    socket.data.typingWatch = {
      conversationId,
      label: formatAdvisorLabel(advisor ?? user),
      active: false,
      lastTypingAt: 0,
    };
    await socket.join(TYPING_ROOM_PREFIX + conversationId);
  }

  @SubscribeMessage(TYPING_EVENT)
  handleTyping(
    @ConnectedSocket() socket: InboxSocket,
    @MessageBody() event: { conversationId?: unknown; active?: unknown } | null,
  ): void {
    const watch = socket.data.typingWatch;
    if (
      !watch ||
      event?.conversationId !== watch.conversationId ||
      typeof event.active !== 'boolean'
    )
      return;

    const now = Date.now();
    if (event.active && now - watch.lastTypingAt < 1000) return;
    if (!event.active && !watch.active) return;
    if (event.active) watch.lastTypingAt = now;
    watch.active = event.active;
    this.emitTyping(socket, watch, event.active);
  }

  private canWatch(user: AuthUser, conversationId: number): Promise<boolean> {
    return runWithBusinessAccess(user, async () => {
      const conversation = await this.prisma.conversations.findFirst({
        where: visibleConversationWhere(user.area, conversationId),
        select: { id: true },
      });
      return conversation != null;
    });
  }

  private clearTypingWatch(socket: InboxSocket): number {
    const revision = (socket.data.typingRevision ?? 0) + 1;
    socket.data.typingRevision = revision;

    const watch = socket.data.typingWatch;
    if (watch) {
      if (watch.active) this.emitTyping(socket, watch, false);
      delete socket.data.typingWatch;
      void socket.leave(TYPING_ROOM_PREFIX + watch.conversationId);
    }
    return revision;
  }

  private emitTyping(
    socket: InboxSocket,
    watch: TypingWatch,
    active: boolean,
  ): void {
    socket.to(TYPING_ROOM_PREFIX + watch.conversationId).emit(TYPING_EVENT, {
      conversationId: watch.conversationId,
      advisorId: socket.data.userId,
      connectionId: socket.id,
      label: watch.label,
      active,
    });
  }

  emitTo(rooms: string[], event: string, payload: unknown): void {
    if (!rooms.length || !this.server) return;
    this.server.to(rooms).emit(event, payload);
  }

  /** Aviso global (p. ej. LISTEN de Postgres se recuperó y pudo haber huecos). */
  emitAll(event: string, payload: unknown): void {
    if (!this.server) return;
    this.server.emit(event, payload);
  }

  private async revalidate(socket: InboxSocket): Promise<void> {
    if (!socket.connected) return;
    const user = await this.authenticate(socket);
    if (!user || user.area !== socket.data.area) {
      socket.emit('inbox.unauthorized');
      socket.disconnect(true);
      return;
    }
    await this.applyRooms(socket, user);
    const watch = socket.data.typingWatch;
    if (watch) {
      const allowed = await this.canWatch(user, watch.conversationId).catch(
        () => false,
      );
      if (!allowed && socket.data.typingWatch === watch)
        this.clearTypingWatch(socket);
    } else if (socket.connected) {
      // Vuelve a solicitar el chat si su autorización coincidió con la revalidación.
      socket.emit('inbox.ready');
    }
  }

  private async applyRooms(socket: InboxSocket, user: AuthUser): Promise<void> {
    const next = new Set(inboxRoomsForUser(user));
    for (const room of socket.rooms) {
      if (
        room !== socket.id &&
        !room.startsWith(TYPING_ROOM_PREFIX) &&
        !next.has(room)
      ) {
        await socket.leave(room);
      }
    }
    await socket.join([...next]);
    socket.data.area = user.area;
    socket.data.userId = user.id;
    socket.data.user = user;
  }

  private async authenticate(socket: InboxSocket): Promise<AuthUser | null> {
    try {
      if (!this.config.requireAuth) return this.auth.getDevUser();
      const fromAuth: unknown = socket.handshake.auth?.token;
      const token =
        (typeof fromAuth === 'string' && fromAuth) ||
        readCookie(socket.handshake.headers.cookie, this.config.authCookieName);
      if (!token) return null;
      const payload = this.jwt.verify<JwtPayload>(token);
      if (!payload?.sub) return null;
      const user = await this.auth.validateJwtPayload(payload);
      if (!user.isMaster && !user.isProvisioned) return null;
      // Misma puerta que GET /api/conversations: sin manage no hay filas del Inbox.
      if (!hasPermission(user, PERMISSION.CONVERSATIONS_MANAGE)) return null;
      return user;
    } catch (err) {
      this.logger.debug(
        `socket rechazado: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }
}
