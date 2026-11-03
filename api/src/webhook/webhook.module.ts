import { Module } from '@nestjs/common';
import { FlowsModule } from '../flows/flows.module';
import { LeadsModule } from '../leads/leads.module';
import { PeopleModule } from '../people/people.module';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';

@Module({
  imports: [FlowsModule, LeadsModule, PeopleModule],
  controllers: [WebhookController],
  providers: [WebhookService],
})
export class WebhookModule {}
