import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ReportsModule } from '../reports/reports.module';
import { UserAreasService } from '../users/user-areas.service';
import { AdminController } from './admin.controller';
import { AdminUsersService } from './admin-users.service';
import { MasterGuard } from './guards/master.guard';

@Module({
  imports: [AuthModule, ReportsModule],
  controllers: [AdminController],
  providers: [AdminUsersService, UserAreasService, MasterGuard],
})
export class AdminModule {}
