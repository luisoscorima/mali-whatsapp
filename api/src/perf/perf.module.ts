import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MasterGuard } from '../admin/guards/master.guard';
import { EventLoopLagService } from './event-loop-lag.service';
import { PerfController } from './perf.controller';

@Module({
  imports: [AuthModule],
  controllers: [PerfController],
  providers: [EventLoopLagService, MasterGuard],
})
export class PerfModule {}
