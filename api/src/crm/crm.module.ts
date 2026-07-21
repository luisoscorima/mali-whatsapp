import { Module } from '@nestjs/common';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';
import { CrmServiceTokenGuard } from './crm-service-token.guard';

@Module({
  controllers: [CrmController],
  providers: [CrmService, CrmServiceTokenGuard],
  exports: [CrmService],
})
export class CrmModule {}
