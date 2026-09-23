import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { EducationLeadWorkflowService } from './education-lead-workflow.service';
import { MaliOneLinksCatalogService } from './mali-one-links-catalog.service';
import { MetaLeadgenService } from './meta-leadgen.service';
import { TikTokLeadgenService } from './tiktok-leadgen.service';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [LeadsController],
  providers: [
    LeadsService,
    EducationLeadWorkflowService,
    MetaLeadgenService,
    TikTokLeadgenService,
    MaliOneLinksCatalogService,
  ],
  exports: [
    LeadsService,
    EducationLeadWorkflowService,
    MetaLeadgenService,
    TikTokLeadgenService,
    MaliOneLinksCatalogService,
  ],
})
export class LeadsModule {}
