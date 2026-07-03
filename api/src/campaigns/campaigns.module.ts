import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CampaignJobsService } from './campaign-jobs.service';
import { CampaignRetryService } from './campaign-retry.service';
import { CampaignSenderService } from './campaign-sender.service';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';

@Module({
  imports: [AuthModule],
  controllers: [CampaignsController],
  providers: [
    CampaignsService,
    CampaignSenderService,
    CampaignRetryService,
    CampaignJobsService,
  ],
  exports: [CampaignsService],
})
export class CampaignsModule {}
