import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { CAMPAIGN_SCHEDULE_POLL_MS } from '../campaigns/campaign-config.util';
import {
  AUDIT_PURGE_MS,
  MAINTENANCE_QUEUE,
  MaintenanceJobName,
} from './queue.constants';

const REPEAT_JOB_OPTS = {
  removeOnComplete: true,
  removeOnFail: 20,
} as const;

@Injectable()
export class QueueBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(QueueBootstrapService.name);

  constructor(
    @InjectQueue(MAINTENANCE_QUEUE) private readonly maintenanceQueue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.maintenanceQueue.add(
      MaintenanceJobName.PROMOTE_SCHEDULED,
      {},
      {
        ...REPEAT_JOB_OPTS,
        repeat: { every: CAMPAIGN_SCHEDULE_POLL_MS, key: 'promote-scheduled' },
      },
    );

    await this.maintenanceQueue.add(
      MaintenanceJobName.PROMOTE_AUTO_RETRIES,
      {},
      {
        ...REPEAT_JOB_OPTS,
        repeat: { every: CAMPAIGN_SCHEDULE_POLL_MS, key: 'promote-auto-retries' },
      },
    );

    await this.maintenanceQueue.add(
      MaintenanceJobName.AUDIT_PURGE,
      { source: 'interval' },
      {
        ...REPEAT_JOB_OPTS,
        repeat: { every: AUDIT_PURGE_MS, key: 'audit-purge' },
      },
    );

    await this.maintenanceQueue.add(
      MaintenanceJobName.STARTUP_CAMPAIGNS,
      {},
      REPEAT_JOB_OPTS,
    );

    await this.maintenanceQueue.add(
      MaintenanceJobName.AUDIT_PURGE,
      { source: 'startup' },
      REPEAT_JOB_OPTS,
    );

    this.logger.log('Colas BullMQ registradas (campañas + mantenimiento)');
  }
}
