import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FlowsModule } from '../flows/flows.module';
import { LeadsModule } from '../leads/leads.module';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';

@Module({
  imports: [AuthModule, FlowsModule, LeadsModule],
  controllers: [ConversationsController],
  providers: [ConversationsService],
})
export class ConversationsModule {}
