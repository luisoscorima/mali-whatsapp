import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Job } from 'bullmq';
import { AuditEvent } from '../audit/audit-events';
import { AuditLogService } from '../audit/audit-log.service';
import { phoneMetaTail } from '../audit/audit-actor.util';
import {
  sanitizeApiResponse,
  sanitizeMediaOutboundPayload,
} from '../conversations/api-sanitize.util';
import { withRoutingPhoneNumberId } from '../conversations/chat-media.util';
import {
  sendSessionMediaMessage,
  sendSessionTextMessage,
  uploadMediaToWhatsApp,
} from '../conversations/conversation-whatsapp.util';
import { EducationLeadWorkflowService } from '../leads/education-lead-workflow.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  claimOutboundDispatch,
  hasOutboundDispatchStarted,
  isConfirmedOutboundFailure,
  isOutboundUncertain,
  markOutboundUncertain,
  needsOutboundSentHeal,
  persistOutboundAccepted,
  readOutboundAcceptedWamid,
  rememberOutboundAccepted,
  settleOutboundFailure,
} from './outbound-accepted.util';
import {
  OUTBOUND_QUEUE,
  OUTBOUND_TEMPLATE_DELIVER,
  OutboundJobName,
} from './queue.constants';
import type {
  OutboundJobMetaFlags,
  OutboundMediaJobData,
  OutboundReplyJobData,
  OutboundTemplateJobData,
} from './outbound-queue.service';

@Processor(OUTBOUND_QUEUE, { concurrency: 4 })
export class OutboundQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(OutboundQueueProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly educationLeads: EducationLeadWorkflowService,
    private readonly auditLog: AuditLogService,
    private readonly events: EventEmitter2,
  ) {
    super();
  }

  async process(
    job: Job<
      OutboundReplyJobData | OutboundMediaJobData | OutboundTemplateJobData
    >,
  ): Promise<void> {
    if (job.name === OutboundJobName.SEND_MEDIA) {
      await this.sendMedia(job as Job<OutboundMediaJobData>);
      return;
    }
    if (job.name === OutboundJobName.SEND_TEMPLATE) {
      await this.events.emitAsync(OUTBOUND_TEMPLATE_DELIVER, {
        bullJob: job as Job<OutboundTemplateJobData>,
      });
      return;
    }
    if (job.name !== OutboundJobName.SEND_REPLY) return;
    await this.sendText(job as Job<OutboundReplyJobData>);
  }

  private resolveResumeId(
    row: { wa_message_id: string | null; raw_payload: unknown },
    data: OutboundJobMetaFlags,
  ): string | null {
    return (
      String(row.wa_message_id || '').trim() ||
      String(data.acceptedWaMessageId || '').trim() ||
      readOutboundAcceptedWamid(row.raw_payload)
    );
  }

  private async sendText(job: Job<OutboundReplyJobData>): Promise<void> {
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
    if (isOutboundUncertain(row.raw_payload) && !this.resolveResumeId(row, data)) {
      return;
    }

    const resumeId = this.resolveResumeId(row, data);
    if (resumeId) {
      if (!row.wa_message_id || needsOutboundSentHeal(row.raw_payload)) {
        await persistOutboundAccepted(this.prisma, {
          messageId: data.messageId,
          waMessageId: resumeId,
          patch: withRoutingPhoneNumberId({}, data.phoneNumberId),
        });
      }
      if (data.reservedLeadId) {
        await this.educationLeads.markFirstHumanReply(data.reservedLeadId);
      }
      return;
    }

    if (data.metaCallStarted || hasOutboundDispatchStarted(row.raw_payload)) {
      await markOutboundUncertain(
        this.prisma,
        data.messageId,
        'WhatsApp no confirmó el envío anterior',
      );
      return;
    }

    let msgId: string | null = null;
    let dispatchStarted = false;
    try {
      if (!(await claimOutboundDispatch(this.prisma, data.messageId))) return;
      dispatchStarted = true;
      const apiResponse = await sendSessionTextMessage({
        to: data.to,
        text: data.text,
        area: data.area,
        phoneNumberId: data.phoneNumberId,
        replyToWaMessageId: data.replyToWaMessageId || undefined,
      });
      msgId = apiResponse.messages?.[0]?.id || null;
      if (!msgId) throw new Error('WhatsApp no devolvió un id de mensaje');

      const existing =
        row.raw_payload &&
        typeof row.raw_payload === 'object' &&
        !Array.isArray(row.raw_payload)
          ? (row.raw_payload as Record<string, unknown>)
          : {};
      await persistOutboundAccepted(this.prisma, {
        messageId: data.messageId,
        waMessageId: msgId,
        patch: withRoutingPhoneNumberId(
          {
            ...sanitizeApiResponse(apiResponse),
            ...(existing.sender ? { sender: existing.sender } : {}),
            ...(existing.reply_to ? { reply_to: existing.reply_to } : {}),
          },
          data.phoneNumberId,
        ),
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
      if (msgId) {
        await rememberOutboundAccepted(this.prisma, job, data.messageId, msgId);
        this.logger.warn(
          `outbound: Meta aceptó ${msgId} pero falló el guardado; se reanudará sin reenviar`,
        );
        throw error instanceof Error ? error : new Error(String(error));
      }
      const message =
        error instanceof Error ? error.message : 'No se pudo enviar';
      this.logger.warn(`outbound falló mensaje ${data.messageId}: ${message}`);
      await this.markFailed(data.messageId, message, job, error, dispatchStarted);
    }
  }

  private async sendMedia(job: Job<OutboundMediaJobData>): Promise<void> {
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
    if (isOutboundUncertain(row.raw_payload) && !this.resolveResumeId(row, data)) {
      return;
    }

    const resumeId = this.resolveResumeId(row, data);
    if (resumeId) {
      if (!row.wa_message_id || needsOutboundSentHeal(row.raw_payload)) {
        const existing =
          row.raw_payload &&
          typeof row.raw_payload === 'object' &&
          !Array.isArray(row.raw_payload)
            ? (row.raw_payload as Record<string, unknown>)
            : {};
        await persistOutboundAccepted(this.prisma, {
          messageId: data.messageId,
          waMessageId: resumeId,
          patch: withRoutingPhoneNumberId(
            {
              ...(existing.outbound_media
                ? { outbound_media: existing.outbound_media }
                : {}),
              ...(existing.local_preview
                ? { local_preview: existing.local_preview }
                : {}),
              ...(existing.sender ? { sender: existing.sender } : {}),
            },
            data.phoneNumberId,
          ),
        });
      }
      if (data.reservedLeadId) {
        await this.educationLeads.markFirstHumanReply(data.reservedLeadId);
      }
      return;
    }

    if (data.metaCallStarted || hasOutboundDispatchStarted(row.raw_payload)) {
      await markOutboundUncertain(
        this.prisma,
        data.messageId,
        'WhatsApp no confirmó el envío anterior',
      );
      return;
    }

    let msgId: string | null = null;
    let dispatchStarted = false;
    try {
      const downloaded = await fetch(data.mediaUrl);
      if (!downloaded.ok) {
        throw new Error('No se pudo leer el archivo guardado');
      }
      const buffer = Buffer.from(await downloaded.arrayBuffer());
      if (data.voiceNote) {
        this.logger.log(
          `Nota de voz a Graph: ${buffer.length} bytes, inicio=${buffer.subarray(0, 4).toString()}`,
        );
      }
      const upload = await uploadMediaToWhatsApp({
        area: data.area,
        buffer,
        mimeType: data.mimeType,
        filename: data.filename,
        phoneNumberId: data.phoneNumberId,
      });
      if (!(await claimOutboundDispatch(this.prisma, data.messageId))) return;
      dispatchStarted = true;
      const apiResponse = await sendSessionMediaMessage({
        to: data.to,
        area: data.area,
        waType: upload.waType,
        mediaId: upload.mediaId,
        caption: data.caption,
        documentFilename:
          upload.waType === 'document' ? upload.safeFilename : undefined,
        phoneNumberId: data.phoneNumberId,
        voiceNote: data.voiceNote,
        replyToWaMessageId: data.replyToWaMessageId,
      });
      msgId = apiResponse.messages?.[0]?.id || null;
      if (!msgId) throw new Error('WhatsApp no devolvió un id de mensaje');

      const existing =
        row.raw_payload &&
        typeof row.raw_payload === 'object' &&
        !Array.isArray(row.raw_payload)
          ? (row.raw_payload as Record<string, unknown>)
          : {};
      await persistOutboundAccepted(this.prisma, {
        messageId: data.messageId,
        waMessageId: msgId,
        patch: withRoutingPhoneNumberId(
          {
            ...sanitizeMediaOutboundPayload(upload.mediaId, apiResponse, {
              url: data.mediaUrl,
              mime: data.mimeType,
            }),
            ...(existing.sender ? { sender: existing.sender } : {}),
            ...(existing.reply_to ? { reply_to: existing.reply_to } : {}),
            ...(existing.outbound_media
              ? { outbound_media: existing.outbound_media }
              : {}),
          },
          data.phoneNumberId,
        ),
      });
      if (data.reservedLeadId) {
        await this.educationLeads.markFirstHumanReply(data.reservedLeadId);
      }
      await this.auditLog.write({
        event_type: AuditEvent.CONVERSATION_REPLY,
        message: `Respuesta WhatsApp (${upload.waType}) en conversación ${data.conversationId}`,
        actor: {
          userId: data.actorUserId,
          email: data.actorEmail,
          area: data.actorArea,
        },
        meta: {
          conversation_id: data.conversationId,
          message_id: data.messageId,
          phone_tail: phoneMetaTail(data.to),
          media_type: upload.waType,
          filename: data.filename.slice(0, 200),
          has_caption: Boolean(data.caption),
          async: true,
        },
      });
    } catch (error) {
      if (msgId) {
        await rememberOutboundAccepted(this.prisma, job, data.messageId, msgId);
        this.logger.warn(
          `outbound media: Meta aceptó ${msgId} pero falló el guardado; se reanudará sin reenviar`,
        );
        throw error instanceof Error ? error : new Error(String(error));
      }
      const message =
        error instanceof Error ? error.message : 'No se pudo enviar';
      this.logger.warn(
        `outbound media falló mensaje ${data.messageId}: ${message}`,
      );
      await this.markFailed(data.messageId, message, job, error, dispatchStarted);
    }
  }

  private async markFailed(
    messageId: number,
    message: string,
    job: Job,
    error: unknown,
    dispatchStarted: boolean,
  ): Promise<void> {
    if (dispatchStarted) {
      if (isConfirmedOutboundFailure(error)) {
        await settleOutboundFailure(this.prisma, messageId, message, 'rejected');
      } else {
        await markOutboundUncertain(this.prisma, messageId, message);
      }
      return;
    }

    if ((job.attemptsMade ?? 0) + 1 < (job.opts.attempts ?? 1)) {
      throw error;
    }
    await settleOutboundFailure(this.prisma, messageId, message, 'before-dispatch');
  }
}
