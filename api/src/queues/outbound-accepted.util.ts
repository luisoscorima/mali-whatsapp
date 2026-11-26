import { Prisma } from '@prisma/client';
import {
  deliveryStatusRank,
  readDeliveryStatusToken,
} from '../conversations/chat-delivery.util';
import type { PrismaService } from '../prisma/prisma.service';
import {
  WhatsAppGraphRequestError,
  WhatsAppSendNotAttemptedError,
} from '../templates/whatsapp-meta.util';
import type { Job } from 'bullmq';
import type { OutboundJobMetaFlags } from './outbound-queue.service';

const ACCEPTED_KEY = 'outbound_accepted_wamid';
const OUTBOUND_UNCERTAIN_KEY = 'outbound_uncertain';
const DISPATCH_KEY = 'outbound_dispatch_started';

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function asObject(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return { ...(raw as Record<string, unknown>) };
  }
  return {};
}

/** wamid ya aceptado por Meta pero aún no confirmado en columna / estado UI. */
export function readOutboundAcceptedWamid(rawPayload: unknown): string | null {
  const obj = asObject(rawPayload);
  const direct = String(obj[ACCEPTED_KEY] || '').trim();
  if (direct) return direct;
  const messages = obj.messages;
  if (Array.isArray(messages) && messages[0] && typeof messages[0] === 'object') {
    const id = String((messages[0] as { id?: string }).id || '').trim();
    if (id) return id;
  }
  return null;
}

/**
 * Solo una validación local o un rechazo explícito permiten repetir el envío.
 */
export function isConfirmedOutboundFailure(error: unknown): boolean {
  if (error instanceof WhatsAppSendNotAttemptedError) return true;
  const cause = error instanceof WhatsAppGraphRequestError
    ? error
    : error instanceof Error ? error.cause : undefined;
  return cause instanceof WhatsAppGraphRequestError
    && cause.status >= 400 && cause.status < 500 && cause.status !== 408;
}

/** Solo un worker puede cruzar el límite del envío para una fila pendiente. */
export async function claimOutboundDispatch(
  prisma: PrismaService,
  messageId: number,
): Promise<boolean> {
  const patch = JSON.stringify({ [DISPATCH_KEY]: true });
  const updated = await prisma.$executeRaw`
    UPDATE chat_messages
    SET raw_payload = COALESCE(raw_payload, '{}'::jsonb) || ${patch}::jsonb
    WHERE id = ${messageId} AND wa_message_id IS NULL
      AND COALESCE(raw_payload->'delivery_status'->>'status', raw_payload->>'status') = 'pending'
      AND raw_payload->>${DISPATCH_KEY} IS DISTINCT FROM 'true'
      AND raw_payload->>${OUTBOUND_UNCERTAIN_KEY} IS DISTINCT FROM 'true'
      AND NULLIF(raw_payload->>${ACCEPTED_KEY}, '') IS NULL
  `;
  return updated === 1;
}

export function hasOutboundDispatchStarted(rawPayload: unknown): boolean {
  return asObject(rawPayload)[DISPATCH_KEY] === true;
}

/**
 * Guarda el wamid aceptado sin tocar el estado de entrega si ya es mayor.
 * Una sola escritura atómica (columna + payload).
 */
export async function persistOutboundAccepted(
  prisma: PrismaService,
  input: {
    messageId: number;
    waMessageId: string;
    patch?: Record<string, unknown>;
    finalize?: (tx: Prisma.TransactionClient, payload: Record<string, unknown>) => Promise<void>;
  },
): Promise<void> {
  const waMessageId = String(input.waMessageId || '').trim();
  if (!waMessageId) throw new Error('waMessageId requerido');

  await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<
      Array<{ id: number; wa_message_id: string | null; raw_payload: unknown }>
    >`
      SELECT id, wa_message_id, raw_payload
      FROM chat_messages
      WHERE id = ${input.messageId}
      FOR UPDATE
    `;
    const row = rows[0];
    if (!row) throw new Error(`Mensaje ${input.messageId} no encontrado`);
    if (row.wa_message_id && row.wa_message_id !== waMessageId) {
      throw new Error(`Mensaje ${input.messageId} ya tiene otro wamid`);
    }

    const current = asObject(row.raw_payload);
    const currentToken = readDeliveryStatusToken(current);
    const currentRank = deliveryStatusRank(currentToken);
    const sentRank = deliveryStatusRank('sent');

    const next: Record<string, unknown> = {
      ...current,
      ...(input.patch || {}),
      [ACCEPTED_KEY]: waMessageId,
    };
    delete next[OUTBOUND_UNCERTAIN_KEY];
    delete next[DISPATCH_KEY];

    const providerFailed = Boolean(row.wa_message_id)
      && (currentToken === 'failed' || currentToken === 'undelivered');
    if (currentRank < sentRank && !providerFailed) {
      next.status = 'sent';
      next.delivery_status = { status: 'sent' };
    } else {
      // No bajar Entregado/Leído ni pisar un delivery_status más alto.
      if (current.delivery_status !== undefined) {
        next.delivery_status = current.delivery_status;
      }
      if (current.status !== undefined) {
        next.status = current.status;
      }
    }

    await tx.chat_messages.update({
      where: { id: input.messageId },
      data: {
        wa_message_id: row.wa_message_id || waMessageId,
        raw_payload: asJson(next),
      },
    });
    await input.finalize?.(tx, next);
  });
}

/** Debe persistir; si falla, el caller guarda el wamid en el job de BullMQ. */
export async function stashOutboundAcceptedWamid(
  prisma: PrismaService,
  messageId: number,
  waMessageId: string,
): Promise<void> {
  const id = String(waMessageId || '').trim();
  if (!id) throw new Error('waMessageId requerido para stash');
  const patch = JSON.stringify({ [ACCEPTED_KEY]: id });
  await prisma.$executeRaw`
    UPDATE chat_messages
    SET raw_payload = COALESCE(raw_payload, '{}'::jsonb) || ${patch}::jsonb
    WHERE id = ${messageId}
  `;
}

/** Intenta cada respaldo por separado; la marca previa al envío impide repetirlo. */
export async function rememberOutboundAccepted<T extends OutboundJobMetaFlags>(
  prisma: PrismaService,
  job: Job<T>,
  messageId: number,
  waMessageId: string,
): Promise<void> {
  await Promise.allSettled([
    job.updateData({ ...job.data, acceptedWaMessageId: waMessageId }),
    stashOutboundAcceptedWamid(prisma, messageId, waMessageId),
  ]);
}

export function needsOutboundSentHeal(rawPayload: unknown): boolean {
  return readDeliveryStatusToken(rawPayload) === 'pending';
}

export function isOutboundUncertain(rawPayload: unknown): boolean {
  return asObject(rawPayload)[OUTBOUND_UNCERTAIN_KEY] === true;
}

/**
 * Meta pudo haber aceptado el mensaje: no reenviar (ni BullMQ ni reintento manual).
 * La UI muestra error; retryOutboundMessage rechaza este estado.
 */
export async function markOutboundUncertain(
  prisma: PrismaService,
  messageId: number,
  reason: string,
  finalize?: (tx: Prisma.TransactionClient) => Promise<void>,
): Promise<void> {
  await settleOutboundFailure(prisma, messageId, reason, 'uncertain', finalize);
}

/** Un error de cola solo puede deshacer un pendiente que ningún worker reclamó. */
export async function settleOutboundFailure(
  prisma: PrismaService,
  messageId: number,
  reason: string,
  kind: 'uncertain' | 'before-dispatch' | 'rejected',
  finalize?: (tx: Prisma.TransactionClient) => Promise<void>,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<
      Array<{ wa_message_id: string | null; raw_payload: unknown }>
    >`
      SELECT wa_message_id, raw_payload
      FROM chat_messages
      WHERE id = ${messageId}
      FOR UPDATE
    `;
    const row = locked[0];
    if (!row) return;
    if (row.wa_message_id || readOutboundAcceptedWamid(row.raw_payload)) return;
    const current = asObject(row.raw_payload);
    if (readDeliveryStatusToken(current) !== 'pending') return;
    if (kind === 'before-dispatch' && hasOutboundDispatchStarted(current)) return;
    delete current[DISPATCH_KEY];
    if (kind === 'uncertain') current[OUTBOUND_UNCERTAIN_KEY] = true;
    await tx.chat_messages.update({
      where: { id: messageId },
      data: {
        raw_payload: asJson({
          ...current,
          status: 'failed',
          delivery_status: {
            status: 'failed',
            error: (kind === 'uncertain' ? `Resultado incierto: ${reason}` : reason).slice(0, 500),
          },
        }),
      },
    });
    await finalize?.(tx);
  });
}
