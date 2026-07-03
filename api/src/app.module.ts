import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AppConfigModule } from './config/app-config.module';
import { AuthModule } from './auth/auth.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { MetaAdsModule } from './meta-ads/meta-ads.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [AppConfigModule, PrismaModule, AuthModule, DashboardModule, MetaAdsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
