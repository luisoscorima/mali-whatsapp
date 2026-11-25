import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { InboxBroadcastService } from './inbox-broadcast.service';
import { InboxDbListenerService } from './inbox-db-listener.service';
import { InboxGateway } from './inbox.gateway';

@Module({
  imports: [AuthModule, ConversationsModule],
  providers: [InboxGateway, InboxBroadcastService, InboxDbListenerService],
})
export class RealtimeModule {}
