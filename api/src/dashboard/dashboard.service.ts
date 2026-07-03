import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(user: AuthUser) {
    const area = user.area;

    const [contacts, campaigns, segmentStats, campaignTotals] =
      await Promise.all([
        this.prisma.contacts.findMany({
          where: { area },
          orderBy: { id: 'desc' },
          take: 25,
          select: {
            id: true,
            name: true,
            phone: true,
            opt_in: true,
            active: true,
            created_at: true,
          },
        }),
        this.prisma.campaigns.findMany({
          where: { area },
          orderBy: { id: 'desc' },
          take: 25,
          select: {
            id: true,
            segment: true,
            template_name: true,
            status: true,
            total_recipients: true,
            created_at: true,
          },
        }),
        this.prisma.contact_segments.findMany({
          where: {
            area,
            contacts: { active: true },
          },
          select: { segment_slug: true, contact_id: true },
        }),
        this.prisma.campaign_logs.aggregate({
          where: { campaigns: { area } },
          _count: { id: true },
        }),
      ]);

    const segmentCounts = new Map<string, number>();
    for (const row of segmentStats) {
      segmentCounts.set(
        row.segment_slug,
        (segmentCounts.get(row.segment_slug) ?? 0) + 1,
      );
    }

    return {
      contacts,
      campaigns,
      stats: Array.from(segmentCounts.entries())
        .map(([segment, total]) => ({ segment, total }))
        .sort((a, b) => a.segment.localeCompare(b.segment)),
      campaignTotals: {
        total_logs: campaignTotals._count.id,
      },
    };
  }
}
