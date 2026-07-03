import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { CampaignRetryService } from '../campaigns/campaign-retry.service';
import type { CampaignJobPayload } from '../campaigns/campaign-sender.service';
import { CampaignSenderService } from '../campaigns/campaign-sender.service';
import { CAMPAIGNS_QUEUE, CampaignJobName } from './queue.constants';

@Injectable()
@Processor(CAMPAIGNS_QUEUE, { concurrency: 2 })
export class CampaignQueueProcessor extends WorkerHost {
  constructor(
    private readonly sender: CampaignSenderService,
    private readonly retry: CampaignRetryService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === CampaignJobName.SEND) {
      const { campaignId, payload } = job.data as {
        campaignId: number;
        payload: CampaignJobPayload;
      };
      await this.sender.runCampaignSendJob(campaignId, payload);
      return;
    }

    if (job.name === CampaignJobName.RETRY) {
      const { campaignId, mode } = job.data as {
        campaignId: number;
        mode: 'auto' | 'manual';
      };
      await this.retry.runCampaignRetryJob(campaignId, mode);
    }
  }
}
