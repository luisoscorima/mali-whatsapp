import { Module } from '@nestjs/common';
import { AttributeDefinitionsModule } from '../attribute-definitions/attribute-definitions.module';
import { LeadsModule } from '../leads/leads.module';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';
import { CrmServiceTokenGuard } from './crm-service-token.guard';

@Module({
  imports: [AttributeDefinitionsModule, LeadsModule],
  controllers: [CrmController],
  providers: [CrmService, CrmServiceTokenGuard],
  exports: [CrmService],
})
export class CrmModule {}
