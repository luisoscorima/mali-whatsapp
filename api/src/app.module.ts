import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AppConfigModule } from './config/app-config.module';
import { AuthModule } from './auth/auth.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { AttributeDefinitionsModule } from './attribute-definitions/attribute-definitions.module';
import { MetaAdsModule } from './meta-ads/meta-ads.module';
import { ContactsModule } from './contacts/contacts.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { ReportsModule } from './reports/reports.module';
import { SettingsModule } from './settings/settings.module';
import { SegmentsModule } from './segments/segments.module';
import { TemplatesModule } from './templates/templates.module';
import { ConversationsModule } from './conversations/conversations.module';
import { WebhookModule } from './webhook/webhook.module';
import { MetaSettingsModule } from './meta-settings/meta-settings.module';
import { AdminModule } from './admin/admin.module';
import { AuditModule } from './audit/audit.module';
import { QueuesModule } from './queues/queues.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    AuditModule,
    QueuesModule,
    MetaSettingsModule,
    AuthModule,
    DashboardModule,
    MetaAdsModule,
    AttributeDefinitionsModule,
    SegmentsModule,
    ContactsModule,
    CampaignsModule,
    SettingsModule,
    ReportsModule,
    TemplatesModule,
    ConversationsModule,
    WebhookModule,
    AdminModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
