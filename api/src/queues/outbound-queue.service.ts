import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { OUTBOUND_QUEUE, OutboundJobName } from './queue.constants';

export type OutboundReplyJobData = {
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

  async enqueueReply(data: OutboundReplyJobData): Promise<void> {
    await this.queue.add(OutboundJobName.SEND_REPLY, data, {
      ...JOB_OPTS,
      jobId: `outbound-reply-${data.messageId}`,
    });
  }

  async enqueueReplyRetry(data: OutboundReplyJobData): Promise<void> {
    await this.queue.add(OutboundJobName.SEND_REPLY, data, {
      ...JOB_OPTS,
      jobId: `outbound-reply-retry-${data.messageId}-${Date.now()}`,
    });
  }
}
