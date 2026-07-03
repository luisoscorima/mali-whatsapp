import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { ApiResponse, AuthUser } from '../auth/auth.types';
import { MetaSettingsService } from '../meta-settings/meta-settings.service';
import { ReportsService } from '../reports/reports.service';
import type { AuditLogListResult } from '../reports/reports.types';
import { AdminUsersService } from './admin-users.service';
import type { AdminMetaSettingsView, AdminUserDetail, AdminUserListItem } from './admin.types';
import {
  CreateAdminUserDto,
  UpdateAdminMetaDto,
  UpdateAdminUserDto,
} from './dto/admin.dto';
import { MasterGuard } from './guards/master.guard';

@Controller('admin')
@UseGuards(JwtAuthGuard, MasterGuard)
export class AdminController {
  constructor(
    private readonly adminUsersService: AdminUsersService,
    private readonly metaSettingsService: MetaSettingsService,
    private readonly reportsService: ReportsService,
  ) {}

  @Get('users')
  async listUsers(): Promise<ApiResponse<AdminUserListItem[]>> {
    const data = await this.adminUsersService.list();
    return { ok: true, data };
  }

  @Get('users/:id')
  async getUser(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ApiResponse<AdminUserDetail>> {
    const data = await this.adminUsersService.getById(id);
    return { ok: true, data };
  }

  @Post('users')
  async createUser(
    @CurrentUser() user: AuthUser,
    @Body() body: CreateAdminUserDto,
  ): Promise<ApiResponse<AdminUserDetail>> {
    const data = await this.adminUsersService.create(body, user);
    return { ok: true, data };
  }

  @Patch('users/:id')
  async updateUser(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateAdminUserDto,
  ): Promise<ApiResponse<AdminUserDetail>> {
    const data = await this.adminUsersService.update(user, id, body);
    return { ok: true, data };
  }

  @Delete('users/:id')
  async deleteUser(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ApiResponse<{ deleted: true }>> {
    await this.adminUsersService.remove(user, id);
    return { ok: true, data: { deleted: true } };
  }

  @Get('meta')
  getMeta(): ApiResponse<AdminMetaSettingsView> {
    return { ok: true, data: this.metaSettingsService.getAdminView() };
  }

  @Patch('meta')
  async updateMeta(
    @CurrentUser() user: AuthUser,
    @Body() body: UpdateAdminMetaDto,
  ): Promise<ApiResponse<AdminMetaSettingsView>> {
    await this.metaSettingsService.save(body, user);
    return { ok: true, data: this.metaSettingsService.getAdminView() };
  }

  @Get('audit-logs/options')
  auditLogOptions(): ApiResponse<
    ReturnType<ReportsService['getAuditFilterOptions']>
  > {
    return { ok: true, data: this.reportsService.getAuditFilterOptions() };
  }

  @Get('audit-logs')
  async auditLogs(
    @Query() query: Record<string, string | undefined>,
  ): Promise<ApiResponse<AuditLogListResult>> {
    const data = await this.reportsService.listAuditLogsForAdmin(query);
    return { ok: true, data };
  }

  @Get('audit-logs/export')
  async exportAuditLogs(
    @Query() query: Record<string, string | undefined>,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, filename } =
      await this.reportsService.exportAuditLogsForAdmin(query);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }
}
