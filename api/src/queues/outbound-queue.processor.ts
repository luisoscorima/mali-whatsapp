import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { Prisma } from '@prisma/client';
import { AuditEvent } from '../audit/audit-events';
import { AuditLogService } from '../audit/audit-log.service';
import { phoneMetaTail } from '../audit/audit-actor.util';
import { sanitizeApiResponse } from '../conversations/api-sanitize.util';
import { withRoutingPhoneNumberId } from '../conversations/chat-media.util';
import { sendSessionTextMessage } from '../conversations/conversation-whatsapp.util';
import { EducationLeadWorkflowService } from '../leads/education-lead-workflow.service';
import { PrismaService } from '../prisma/prisma.service';
import { OUTBOUND_QUEUE, OutboundJobName } from './queue.constants';
import type { OutboundReplyJobData } from './outbound-queue.service';

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function mergePayload(
  current: unknown,
  patch: Record<string, unknown>,
): Prisma.InputJsonValue {
  const base =
    current && typeof current === 'object' && !Array.isArray(current)
      ? { ...(current as Record<string, unknown>) }
      : {};
  return asJson({ ...base, ...patch });
}

@Processor(OUTBOUND_QUEUE, { concurrency: 4 })
export class OutboundQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(OutboundQueueProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly educationLeads: EducationLeadWorkflowService,
    private readonly auditLog: AuditLogService,
  ) {
    super();
  }

  async process(job: Job<OutboundReplyJobData>): Promise<void> {
    if (job.name !== OutboundJobName.SEND_REPLY) return;
    const data = job.data;
    const row = await this.prisma.chat_messages.findUnique({
      where: { id: data.messageId },
      select: {
        id: true,
        conversation_id: true,
        wa_message_id: true,
        raw_payload: true,
      },
    });
    if (!row || row.conversation_id !== data.conversationId) {
      this.logger.warn(`outbound: mensaje ${data.messageId} no encontrado`);
      return;
    }
    if (row.wa_message_id) return;

    try {
      const apiResponse = await sendSessionTextMessage({
        to: data.to,
        text: data.text,
        area: data.area,
        phoneNumberId: data.phoneNumberId,
        replyToWaMessageId: data.replyToWaMessageId || undefined,
      });
      const msgId = apiResponse.messages?.[0]?.id || null;
      const existing =
        row.raw_payload &&
        typeof row.raw_payload === 'object' &&
        !Array.isArray(row.raw_payload)
          ? (row.raw_payload as Record<string, unknown>)
          : {};
      const payload = withRoutingPhoneNumberId(
        {
          ...sanitizeApiResponse(apiResponse),
          status: 'sent',
          delivery_status: { status: 'sent' },
          ...(existing.sender ? { sender: existing.sender } : {}),
          ...(existing.reply_to ? { reply_to: existing.reply_to } : {}),
        },
        data.phoneNumberId,
      );

      await this.prisma.chat_messages.update({
        where: { id: data.messageId },
        data: {
          wa_message_id: msgId,
          raw_payload: asJson(payload),
        },
      });

      if (data.reservedLeadId) {
        await this.educationLeads.markFirstHumanReply(data.reservedLeadId);
      }

      await this.auditLog.write({
        event_type: AuditEvent.CONVERSATION_REPLY,
        message: `Respuesta WhatsApp (texto) en conversación ${data.conversationId}`,
        actor: {
          userId: data.actorUserId,
          email: data.actorEmail,
          area: data.actorArea,
        },
        meta: {
          conversation_id: data.conversationId,
          message_id: data.messageId,
          phone_tail: phoneMetaTail(data.to),
          text_preview: data.text.slice(0, 120),
          async: true,
        },
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'No se pudo enviar';
      this.logger.warn(
        `outbound falló mensaje ${data.messageId}: ${message}`,
      );
      await this.prisma.chat_messages.update({
        where: { id: data.messageId },
        data: {
          raw_payload: mergePayload(row.raw_payload, {
            status: 'failed',
            delivery_status: {
              status: 'failed',
              error: message.slice(0, 500),
            },
          }),
        },
      });
      if ((job.attemptsMade ?? 0) + 1 >= (job.opts.attempts ?? 1)) return;
      throw error;
    }
  }
}
