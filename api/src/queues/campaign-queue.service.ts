import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { CampaignJobPayload } from '../campaigns/campaign-sender.service';
import { CAMPAIGNS_QUEUE, CampaignJobName } from './queue.constants';

const JOB_OPTS = {
  removeOnComplete: true,
  removeOnFail: 50,
} as const;

@Injectable()
export class CampaignQueueService {
  constructor(
    @InjectQueue(CAMPAIGNS_QUEUE) private readonly queue: Queue,
  ) {}

  async enqueueSend(
    campaignId: number,
    payload: CampaignJobPayload,
  ): Promise<void> {
    await this.queue.add(
      CampaignJobName.SEND,
      { campaignId, payload },
      JOB_OPTS,
    );
  }

  async enqueueRetry(
    campaignId: number,
    mode: 'auto' | 'manual' = 'auto',
  ): Promise<void> {
    await this.queue.add(
      CampaignJobName.RETRY,
      { campaignId, mode },
      JOB_OPTS,
    );
  }
}
