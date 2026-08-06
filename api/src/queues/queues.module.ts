import { BullModule } from '@nestjs/bullmq';
import { Global, Module, forwardRef } from '@nestjs/common';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { FlowsModule } from '../flows/flows.module';
import { CampaignQueueProcessor } from './campaign-queue.processor';
import { CampaignQueueService } from './campaign-queue.service';
import { MaintenanceQueueProcessor } from './maintenance-queue.processor';
import { QueueBootstrapService } from './queue-bootstrap.service';
import { CAMPAIGNS_QUEUE, MAINTENANCE_QUEUE } from './queue.constants';
import { readRedisConnection } from './redis.util';

@Global()
@Module({
  imports: [
    BullModule.forRoot({
      connection: readRedisConnection(),
    }),
    BullModule.registerQueue(
      { name: CAMPAIGNS_QUEUE },
      { name: MAINTENANCE_QUEUE },
    ),
    forwardRef(() => CampaignsModule),
    forwardRef(() => FlowsModule),
  ],
  providers: [
    CampaignQueueService,
    QueueBootstrapService,
    CampaignQueueProcessor,
    MaintenanceQueueProcessor,
  ],
  exports: [CampaignQueueService],
})
export class QueuesModule {}
