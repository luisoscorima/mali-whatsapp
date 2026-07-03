import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CAMPAIGN_SCHEDULE_POLL_MS } from './campaign-config.util';
import {
  CampaignJobPayload,
  CampaignSenderService,
} from './campaign-sender.service';
import { CampaignRetryService } from './campaign-retry.service';

const PROMOTE_SCHEDULED_LIMIT = 50;

function parsePayload(raw: unknown): CampaignJobPayload | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as CampaignJobPayload;
    } catch {
      return null;
    }
  }
  return raw as CampaignJobPayload;
}

@Injectable()
export class CampaignJobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CampaignJobsService.name);
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sender: CampaignSenderService,
    private readonly retry: CampaignRetryService,
  ) {}

  onModuleInit(): void {
    setImmediate(() => {
      this.resumeInterruptedCampaigns().catch((error) => {
        this.logger.error('Error reanudando campañas', error);
      });
      this.resumeQueuedCampaigns().catch((error) => {
        this.logger.error('Error reanudando cola', error);
      });
    });

    this.pollTimer = setInterval(() => {
      this.promoteDueScheduledCampaigns().catch((error) => {
        this.logger.error('Error promoviendo programadas', error);
      });
      this.retry.promoteDueCampaignRetries().catch((error) => {
        this.logger.error('Error promoviendo reintentos', error);
      });
    }, CAMPAIGN_SCHEDULE_POLL_MS);
  }

  onModuleDestroy(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async promoteDueScheduledCampaigns(): Promise<void> {
    const rows = await this.prisma.campaigns.findMany({
      where: {
        status: 'scheduled',
        scheduled_at: { lte: new Date() },
      },
      orderBy: { scheduled_at: 'asc' },
      take: PROMOTE_SCHEDULED_LIMIT,
      select: { id: true, campaign_payload: true },
    });

    for (const row of rows) {
      const lock = await this.prisma.campaigns.updateMany({
        where: { id: row.id, status: 'scheduled' },
        data: { status: 'queued' },
      });
      if (lock.count === 0) continue;
      const payload = parsePayload(row.campaign_payload);
      if (!payload) continue;
      this.sender.enqueueSendJob(row.id, payload);
    }
  }

  async resumeQueuedCampaigns(): Promise<void> {
    const rows = await this.prisma.campaigns.findMany({
      where: { status: 'queued' },
      orderBy: { id: 'asc' },
      select: { id: true, campaign_payload: true },
    });
    for (const row of rows) {
      const payload = parsePayload(row.campaign_payload);
      if (!payload) continue;
      this.sender.enqueueSendJob(row.id, payload);
    }
  }

  async resumeInterruptedCampaigns(): Promise<void> {
    const rows = await this.prisma.campaigns.findMany({
      where: { status: 'processing' },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    for (const row of rows) {
      const lock = await this.prisma.campaigns.updateMany({
        where: { id: row.id, status: 'processing' },
        data: { status: 'queued' },
      });
      if (lock.count === 0) continue;
      this.logger.log(`Campaña interrumpida #${row.id} devuelta a cola`);
    }
  }
}
