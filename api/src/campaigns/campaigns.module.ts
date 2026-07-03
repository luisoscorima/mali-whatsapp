import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { QueuesModule } from '../queues/queues.module';
import { CampaignJobsService } from './campaign-jobs.service';
import { CampaignRetryService } from './campaign-retry.service';
import { CampaignSenderService } from './campaign-sender.service';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';

@Module({
  imports: [AuthModule, forwardRef(() => QueuesModule)],
  controllers: [CampaignsController],
  providers: [
    CampaignsService,
    CampaignSenderService,
    CampaignRetryService,
    CampaignJobsService,
  ],
  exports: [
    CampaignsService,
    CampaignSenderService,
    CampaignRetryService,
    CampaignJobsService,
  ],
})
export class CampaignsModule {}
