import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { AuditLogService } from '../audit/audit-log.service';
import { runCampaignChatBackfills } from '../campaigns/campaign-chat-backfill.util';
import { CampaignJobsService } from '../campaigns/campaign-jobs.service';
import { CampaignRetryService } from '../campaigns/campaign-retry.service';
import { PrismaService } from '../prisma/prisma.service';
import { CAMPAIGN_SCHEDULE_POLL_MS } from '../campaigns/campaign-config.util';
import {
  AUDIT_PURGE_MS,
  MAINTENANCE_QUEUE,
  MaintenanceJobName,
} from './queue.constants';

@Injectable()
@Processor(MAINTENANCE_QUEUE, { concurrency: 1 })
export class MaintenanceQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(MaintenanceQueueProcessor.name);

  constructor(
    private readonly campaignJobs: CampaignJobsService,
    private readonly retry: CampaignRetryService,
    private readonly auditLog: AuditLogService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case MaintenanceJobName.PROMOTE_SCHEDULED:
        await this.campaignJobs.promoteDueScheduledCampaigns();
        return;

      case MaintenanceJobName.PROMOTE_AUTO_RETRIES:
        await this.retry.promoteDueCampaignRetries();
        return;

      case MaintenanceJobName.AUDIT_PURGE: {
        const deleted = await this.auditLog.purgeOld();
        const source = String((job.data as { source?: string })?.source || 'job');
        if (deleted > 0) {
          this.logger.log(`Bitácora: ${deleted} fila(s) purgadas (${source})`);
        }
        return;
      }

      case MaintenanceJobName.STARTUP_CAMPAIGNS:
        try {
          await runCampaignChatBackfills(this.prisma);
        } catch (error) {
          this.logger.warn(
            `Backfill campañas en chat: ${
              error instanceof Error ? error.message : error
            }`,
          );
        }
        await this.campaignJobs.resumeInterruptedCampaigns();
        await this.campaignJobs.resumeQueuedCampaigns();
        return;

      default:
        this.logger.warn(`Job de mantenimiento desconocido: ${job.name}`);
    }
  }
}
