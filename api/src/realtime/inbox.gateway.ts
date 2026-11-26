import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { AuthService } from '../auth/auth.service';
import type { AuthUser, JwtPayload } from '../auth/auth.types';
import { hasPermission } from '../auth/roles/has-permission';
import { PERMISSION } from '../auth/roles/permission-codes';
import { AppConfigService } from '../config/app-config.service';

/** Revalida permisos de sockets abiertos (revocación / cambio de líneas). */
const REVALIDATE_MS = 2 * 60 * 1000;

export function inboxRoomsForUser(user: AuthUser): string[] {
  const access = user.isMaster ? undefined : user.businessAccess;
  if (access?.mode === 'restricted') return access.lineIds.map((id) => `line:${id}`);
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
  ) {}

  async handleConnection(socket: Socket): Promise<void> {
    const user = await this.authenticate(socket);
    if (!socket.connected) return;
    if (!user) {
      socket.emit('inbox.unauthorized');
      socket.disconnect(true);
      return;
    }
    await this.applyRooms(socket, user);
    if (!socket.connected) return;
    const timer = setInterval(() => void this.revalidate(socket), REVALIDATE_MS);
    timer.unref();
    socket.data.revalidateTimer = timer;
  }

  handleDisconnect(socket: Socket): void {
    const timer = socket.data.revalidateTimer as NodeJS.Timeout | undefined;
    if (timer) clearInterval(timer);
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

  private async revalidate(socket: Socket): Promise<void> {
    if (!socket.connected) return;
    const user = await this.authenticate(socket);
    if (!user || user.area !== socket.data.area) {
      socket.emit('inbox.unauthorized');
      socket.disconnect(true);
      return;
    }
    await this.applyRooms(socket, user);
  }

  private async applyRooms(socket: Socket, user: AuthUser): Promise<void> {
    const next = new Set(inboxRoomsForUser(user));
    for (const room of socket.rooms) {
      if (room !== socket.id && !next.has(room)) await socket.leave(room);
    }
    await socket.join([...next]);
    socket.data.area = user.area;
    socket.data.userId = user.id;
  }

  private async authenticate(socket: Socket): Promise<AuthUser | null> {
    try {
      if (!this.config.requireAuth) return this.auth.getDevUser();
      const fromAuth = socket.handshake.auth?.token;
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
