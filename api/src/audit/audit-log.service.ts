import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { readAuditRetentionDays } from '../reports/audit-log-query.util';
import type { AuditEventType } from './audit-events';

function deepSanitize(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[truncado]';
  if (value == null) return value;
  if (typeof value === 'string') {
    if (value.length > 2000) return `${value.slice(0, 2000)}…`;
    return value;
  }
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((x) => deepSanitize(x, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const lk = k.toLowerCase();
    if (
      /password|secret|token|hash|credential|authorization|cookie|session/i.test(
        lk,
      ) ||
      lk.includes('whatsapp_token') ||
      lk.includes('app_secret') ||
      lk.includes('verify_token')
    ) {
      out[k] = '[omitido]';
      continue;
    }
    if (lk === 'prompt' && typeof v === 'string' && v.length > 200) {
      out[k] = `${v.slice(0, 200)}…`;
      continue;
    }
    out[k] = deepSanitize(v, depth + 1);
  }
  return out;
}

export function readClientIp(req: {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
}): string | null {
  const xf = String(req.headers?.['x-forwarded-for'] || '')
    .split(',')[0]
    .trim();
  if (xf) return xf.slice(0, 128);
  const ip = req.ip || req.socket?.remoteAddress || '';
  return String(ip).slice(0, 128) || null;
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async write(input: {
    level?: 'info' | 'warn' | 'error';
    event_type: AuditEventType | string;
    message: string;
    actor?: {
      userId?: number | null;
      email?: string | null;
      area?: string | null;
    };
    meta?: Record<string, unknown>;
    clientIp?: string | null;
    requestId?: string | null;
  }): Promise<void> {
    const safeMeta = deepSanitize(input.meta ?? {}) as Prisma.InputJsonValue;

    try {
      await this.prisma.audit_logs.create({
        data: {
          level: input.level || 'info',
          event_type: String(input.event_type).slice(0, 100),
          message: String(input.message).slice(0, 4000),
          actor_user_id:
            input.actor?.userId != null &&
            Number.isFinite(Number(input.actor.userId))
              ? Number(input.actor.userId)
              : null,
          actor_email: input.actor?.email
            ? String(input.actor.email).slice(0, 160)
            : null,
          area: input.actor?.area
            ? String(input.actor.area).slice(0, 32)
            : null,
          client_ip: input.clientIp ? String(input.clientIp).slice(0, 128) : null,
          request_id: input.requestId
            ? String(input.requestId).slice(0, 64)
            : null,
          meta: safeMeta,
        },
      });
    } catch (error) {
      this.logger.error(
        `audit_logs insert failed (${input.event_type}): ${
          error instanceof Error ? error.message : error
        }`,
      );
    }
  }

  async purgeOld(): Promise<number> {
    const days = readAuditRetentionDays();
    try {
      const deleted = await this.prisma.$executeRaw`
        DELETE FROM audit_logs
        WHERE created_at < NOW() - (${days}::int * INTERVAL '1 day')
      `;
      return Number(deleted) || 0;
    } catch (error) {
      this.logger.error(
        `audit_logs purge failed: ${error instanceof Error ? error.message : error}`,
      );
      return 0;
    }
  }
}
