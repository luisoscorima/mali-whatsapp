import { BadRequestException, ConflictException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import type { AuditLogService } from '../audit/audit-log.service';
import type { PrismaService } from '../prisma/prisma.service';
import { CampaignJobsService } from './campaign-jobs.service';
import { CampaignsService } from './campaigns.service';
import type { CampaignSenderService } from './campaign-sender.service';
import type { CampaignRetryService } from './campaign-retry.service';

describe('reprogramación de campañas', () => {
  const now = new Date('2026-09-23T12:00:00.000Z');
  const original = new Date('2026-09-24T12:00:00.000Z');
  const next = new Date('2026-09-25T12:00:00.000Z');
  const user = { id: 1, email: 'admin@example.com', area: 'ti' } as AuthUser;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function makeService(status = 'scheduled', scheduledAt: Date | null = original) {
    const findFirst = jest.fn().mockResolvedValue({ status, scheduled_at: scheduledAt });
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const write = jest.fn().mockResolvedValue(undefined);
    const prisma = { campaigns: { findFirst, updateMany } } as unknown as PrismaService;
    const auditLog = { write } as unknown as AuditLogService;
    const service = new CampaignsService(
      prisma,
      {} as CampaignSenderService,
      {} as CampaignRetryService,
      auditLog,
    );
    return { service, findFirst, updateMany, write };
  }

  it('guarda otra fecha para la campaña del área y registra el cambio', async () => {
    const { service, updateMany, write } = makeService();

    await expect(service.reschedule(user, 7, next.toISOString())).resolves.toEqual({
      scheduled_at: next.toISOString(),
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 7,
        area: 'ti',
        status: 'scheduled',
        scheduled_at: { equals: original, gt: now },
      },
      data: { scheduled_at: next },
    });
    expect(write).toHaveBeenCalledWith(expect.objectContaining({
      event_type: 'campaign.rescheduled',
      meta: expect.objectContaining({
        previous_scheduled_at: original.toISOString(),
        scheduled_at: next.toISOString(),
      }),
    }));
  });

  it.each([
    ['queued', original],
    ['scheduled', new Date('2026-09-23T11:59:00.000Z')],
  ])('rechaza campaña %s cuando ya inició o venció', async (status, scheduledAt) => {
    const { service, updateMany } = makeService(status, scheduledAt);
    await expect(service.reschedule(user, 7, next.toISOString())).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('rechaza un cambio concurrente después de leer la campaña', async () => {
    const { service, updateMany } = makeService();
    updateMany.mockResolvedValue({ count: 0 });
    await expect(service.reschedule(user, 7, next.toISOString())).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it.each([
    new Date(now.getTime() + 30_000),
    new Date(now.getTime() + 91 * 24 * 60 * 60 * 1000),
  ])('rechaza una fecha fuera del rango de programación', async (invalidDate) => {
    const { service, updateMany } = makeService();
    await expect(service.reschedule(user, 7, invalidDate.toISOString())).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('el promotor comprueba otra vez la fecha antes de encolar', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const enqueueSendJob = jest.fn();
    const prisma = {
      campaigns: {
        findMany: jest.fn().mockResolvedValue([{ id: 7, campaign_payload: {} }]),
        updateMany,
      },
    } as unknown as PrismaService;
    const jobs = new CampaignJobsService(
      prisma,
      { enqueueSendJob } as unknown as CampaignSenderService,
    );

    await jobs.promoteDueScheduledCampaigns();

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 7, status: 'scheduled', scheduled_at: { lte: now } },
      data: { status: 'queued' },
    });
    expect(enqueueSendJob).not.toHaveBeenCalled();
  });
});
