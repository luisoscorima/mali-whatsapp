import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProvisionedGuard } from '../auth/guards/provisioned.guard';
import type { ApiResponse, AuthUser } from '../auth/auth.types';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
@UseGuards(JwtAuthGuard, ProvisionedGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  async index(@CurrentUser() user: AuthUser): Promise<ApiResponse<Awaited<ReturnType<DashboardService['getDashboard']>>>> {
    const data = await this.dashboardService.getDashboard(user);
    return { ok: true, data };
  }
}
