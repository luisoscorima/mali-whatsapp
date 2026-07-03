import { Global, Module } from '@nestjs/common';
import { MetaSettingsService } from './meta-settings.service';

@Global()
@Module({
  providers: [MetaSettingsService],
  exports: [MetaSettingsService],
})
export class MetaSettingsModule {}
