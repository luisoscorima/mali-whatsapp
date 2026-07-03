import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AppConfigModule } from './config/app-config.module';
import { AuthModule } from './auth/auth.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { AttributeDefinitionsModule } from './attribute-definitions/attribute-definitions.module';
import { MetaAdsModule } from './meta-ads/meta-ads.module';
import { ContactsModule } from './contacts/contacts.module';
import { SegmentsModule } from './segments/segments.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    AuthModule,
    DashboardModule,
    MetaAdsModule,
    AttributeDefinitionsModule,
    SegmentsModule,
    ContactsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
