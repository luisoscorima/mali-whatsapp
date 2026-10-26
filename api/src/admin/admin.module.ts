import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ReportsModule } from '../reports/reports.module';
import { PrismaModule } from '../prisma/prisma.module';
import { UserAreasService } from '../users/user-areas.service';
import { AdminController } from './admin.controller';
import { AdminUsersService } from './admin-users.service';
import { AdminAreasService } from './admin-areas.service';
import { MasterGuard } from './guards/master.guard';
import { WhatsAppAdminController } from '../whatsapp-admin/whatsapp-admin.controller';
import { WhatsAppAdminService } from '../whatsapp-admin/whatsapp-admin.service';
import { WhatsAppAdminTokenGuard } from '../whatsapp-admin/whatsapp-admin-token.guard';
import { WhatsAppAdminAccessGuard } from '../whatsapp-admin/whatsapp-admin-access.guard';

@Module({
  imports: [AuthModule, ReportsModule, PrismaModule],
  controllers: [AdminController, WhatsAppAdminController],
  providers: [
    AdminUsersService,
    AdminAreasService,
    UserAreasService,
    MasterGuard,
    WhatsAppAdminTokenGuard,
    WhatsAppAdminAccessGuard,
    WhatsAppAdminService,
  ],
})
export class AdminModule {}
