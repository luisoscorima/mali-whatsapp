import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CampaignJobPayload,
  CampaignSenderService,
} from './campaign-sender.service';

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
export class CampaignJobsService {
  private readonly logger = new Logger(CampaignJobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sender: CampaignSenderService,
  ) {}

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
