import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { OUTBOUND_QUEUE, OutboundJobName } from './queue.constants';

/** Marcadores durables en Redis (sobreviven si PostgreSQL falla tras Meta). */
export type OutboundJobMetaFlags = {
  /** Compatibilidad con jobs creados antes de la marca en PostgreSQL. */
  metaCallStarted?: boolean;
  /** wamid aceptado; el reintento solo reanuda el persist. */
  acceptedWaMessageId?: string;
};

export type OutboundReplyJobData = OutboundJobMetaFlags & {
  messageId: number;
  conversationId: number;
  area: string;
  to: string;
  text: string;
  phoneNumberId?: string;
  replyToWaMessageId?: string | null;
  reservedLeadId?: number | null;
  actorUserId: number;
  actorEmail: string;
  actorArea: string;
};

export type OutboundMediaJobData = OutboundJobMetaFlags & {
  messageId: number;
  conversationId: number;
  area: string;
  to: string;
  mediaUrl: string;
  mimeType: string;
  filename: string;
  waType: 'image' | 'video' | 'audio' | 'document';
  caption: string;
  voiceNote?: boolean;
  replyToWaMessageId?: string | null;
  phoneNumberId?: string;
  reservedLeadId?: number | null;
  actorUserId: number;
  actorEmail: string;
  actorArea: string;
};

export type OutboundTemplateJobData = OutboundJobMetaFlags & {
  messageId: number;
  campaignId: number;
  conversationId: number;
  area: string;
  to: string;
  templateName: string;
  languageCode: string;
  components: Record<string, unknown>[];
  phoneNumberId?: string | null;
  contactId: number | null;
  whatsappLineId: number | null;
  actorUserId: number;
  actorEmail: string;
  actorArea: string;
};

const JOB_OPTS = {
  removeOnComplete: 100,
  removeOnFail: 100,
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 2000 },
};

@Injectable()
export class OutboundQueueService {
  constructor(
    @InjectQueue(OUTBOUND_QUEUE) private readonly queue: Queue,
  ) {}

  /** Un solo jobId por mensaje: evita dos reintentos concurrentes. */
  private async replaceJob(
    name: string,
    data: object,
    jobId: string,
  ): Promise<void> {
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state !== 'completed' && state !== 'failed') {
        throw new Error('Este mensaje ya se está reenviando');
      }
      await existing.remove();
    }
    await this.queue.add(name, data, { ...JOB_OPTS, jobId });
  }

  async enqueueReply(data: OutboundReplyJobData): Promise<void> {
    await this.replaceJob(
      OutboundJobName.SEND_REPLY,
      data,
      `outbound-reply-${data.messageId}`,
    );
  }

  async enqueueReplyRetry(data: OutboundReplyJobData): Promise<void> {
    await this.enqueueReply(data);
  }

  async enqueueMedia(data: OutboundMediaJobData): Promise<void> {
    await this.replaceJob(
      OutboundJobName.SEND_MEDIA,
      data,
      `outbound-media-${data.messageId}`,
    );
  }

  async enqueueMediaRetry(data: OutboundMediaJobData): Promise<void> {
    await this.enqueueMedia(data);
  }

  async enqueueTemplate(data: OutboundTemplateJobData): Promise<void> {
    await this.replaceJob(
      OutboundJobName.SEND_TEMPLATE,
      data,
      `outbound-template-${data.messageId}`,
    );
  }

  async enqueueTemplateRetry(data: OutboundTemplateJobData): Promise<void> {
    await this.enqueueTemplate(data);
  }
}
