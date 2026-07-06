import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ReportsModule } from '../reports/reports.module';
import { PrismaModule } from '../prisma/prisma.module';
import { UserAreasService } from '../users/user-areas.service';
import { AdminController } from './admin.controller';
import { AdminUsersService } from './admin-users.service';
import { AdminAreasService } from './admin-areas.service';
import { MasterGuard } from './guards/master.guard';

@Module({
  imports: [AuthModule, ReportsModule, PrismaModule],
  controllers: [AdminController],
  providers: [AdminUsersService, AdminAreasService, UserAreasService, MasterGuard],
})
export class AdminModule {}
