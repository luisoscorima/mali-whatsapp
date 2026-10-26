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
import { AdminAreasService } from './admin-areas.service';
import type { AdminAreaSummary } from './admin-areas.service';
import type {
  AdminMetaSettingsView,
  AdminOnlineUsersResult,
  AdminUserDetail,
  AdminUserListItem,
} from './admin.types';
import {
  CreateAdminUserDto,
  UpdateAdminMetaDto,
  UpdateAdminUserDto,
} from './dto/admin.dto';
import { MasterGuard } from './guards/master.guard';
import {
  buildAdminRolesCatalog,
  type AdminRolesCatalog,
} from '../auth/roles';

@Controller('admin')
@UseGuards(JwtAuthGuard, MasterGuard)
export class AdminController {
  constructor(
    private readonly adminUsersService: AdminUsersService,
    private readonly adminAreasService: AdminAreasService,
    private readonly metaSettingsService: MetaSettingsService,
    private readonly reportsService: ReportsService,
  ) {}

  @Get('roles')
  listRoles(): ApiResponse<AdminRolesCatalog> {
    return { ok: true, data: buildAdminRolesCatalog() };
  }

  @Get('areas')
  async listAreas(): Promise<ApiResponse<AdminAreaSummary[]>> {
    const data = await this.adminAreasService.listSummaries();
    return { ok: true, data };
  }

  @Get('conflicts')
  async listConflicts(@Query('page') page?: string) {
    const requested = Number(page);
    return {
      ok: true,
      data: await this.adminAreasService.listConflicts(Number.isFinite(requested) ? requested : 1),
    };
  }

  @Post('conflicts/consolidation/phone/merge')
  async mergeConsolidationPhone(
    @Body() body: { phone?: string; name?: string; last_name?: string; email?: string; dni?: string },
  ) {
    return {
      ok: true,
      data: await this.adminAreasService.mergeConsolidationPhone({
        phone: String(body.phone || ''),
        name: String(body.name || ''),
        last_name: String(body.last_name || ''),
        email: String(body.email || ''),
        dni: String(body.dni || ''),
      }),
    };
  }

  @Post('conflicts/consolidation/phone/separate')
  async separateConsolidationPhone(@Body() body: { phone?: string }) {
    return { ok: true, data: await this.adminAreasService.separateConsolidationPhone(String(body.phone || '')) };
  }

  @Post('conflicts/consolidation/:contactId/separate')
  async separateConsolidation(@Param('contactId', ParseIntPipe) contactId: number) {
    return { ok: true, data: await this.adminAreasService.separateConsolidation(contactId) };
  }

  @Post('conflicts/identity/:id/apply')
  async applyIdentity(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { phone?: string; dni?: string; email?: string; whatsapp_user_id?: string },
  ) {
    return { ok: true, data: await this.adminAreasService.applyIdentityReview(id, body) };
  }

  @Post('conflicts/identity/:id/resolve')
  async resolveIdentity(@Param('id', ParseIntPipe) id: number) {
    return { ok: true, data: await this.adminAreasService.resolveIdentityReview(id) };
  }

  @Get('areas/:slug/categories')
  async listCategories(@Param('slug') slug: string) {
    return { ok: true, data: await this.adminAreasService.listCategories(slug) };
  }

  @Post('areas/:slug/categories')
  async createCategory(
    @Param('slug') slug: string,
    @Body() body: { slug?: string; label?: string },
  ) {
    return {
      ok: true,
      data: await this.adminAreasService.createCategory(slug, {
        slug: String(body.slug || ''),
        label: String(body.label || ''),
      }),
    };
  }

  @Patch('areas/:slug/categories/:category')
  async updateCategory(
    @Param('slug') slug: string,
    @Param('category') category: string,
    @Body() body: { label?: string; active?: boolean },
  ) {
    return { ok: true, data: await this.adminAreasService.updateCategory(slug, category, body) };
  }

  @Get('users')
  async listUsers(): Promise<ApiResponse<AdminUserListItem[]>> {
    const data = await this.adminUsersService.list();
    return { ok: true, data };
  }

  @Get('online-users')
  async listOnlineUsers(): Promise<ApiResponse<AdminOnlineUsersResult>> {
    const data = await this.adminUsersService.listOnlineUsers();
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
