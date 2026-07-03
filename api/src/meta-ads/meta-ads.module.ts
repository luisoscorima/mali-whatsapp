import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MetaAdsController } from './meta-ads.controller';
import { MetaAdsService } from './meta-ads.service';

@Module({
  imports: [AuthModule],
  controllers: [MetaAdsController],
  providers: [MetaAdsService],
})
export class MetaAdsModule {}
