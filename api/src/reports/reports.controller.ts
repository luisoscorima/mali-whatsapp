import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProvisionedGuard } from '../auth/guards/provisioned.guard';
import type { ApiResponse, AuthUser } from '../auth/auth.types';
import { ReportsService } from './reports.service';
import type { AuditLogListResult, CommunicationReportResult } from './reports.types';

@Controller('reports')
@UseGuards(JwtAuthGuard, ProvisionedGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('audit-logs/options')
  auditOptions(): ApiResponse<ReturnType<ReportsService['getAuditFilterOptions']>> {
    return { ok: true, data: this.reportsService.getAuditFilterOptions() };
  }

  @Get('audit-logs')
  async auditLogs(
    @CurrentUser() user: AuthUser,
    @Query() query: Record<string, string | undefined>,
  ): Promise<ApiResponse<AuditLogListResult>> {
    const data = await this.reportsService.listAuditLogs(user, query);
    return { ok: true, data };
  }

  @Get('audit-logs/export')
  async exportAuditLogs(
    @CurrentUser() user: AuthUser,
    @Query() query: Record<string, string | undefined>,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.reportsService.exportAuditLogs(
      user,
      query,
    );
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  @Get('communications')
  async communications(
    @CurrentUser() user: AuthUser,
    @Query() query: Record<string, string | undefined>,
  ): Promise<ApiResponse<CommunicationReportResult>> {
    const data = await this.reportsService.listCommunications(user, query);
    return { ok: true, data };
  }

  @Get('communications/export')
  async exportCommunications(
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, filename } =
      await this.reportsService.exportCommunications(user);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }
}
