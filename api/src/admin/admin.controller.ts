import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { ApiResponse, AuthUser } from '../auth/auth.types';
import { MetaSettingsService } from '../meta-settings/meta-settings.service';
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
    @Body() body: CreateAdminUserDto,
  ): Promise<ApiResponse<AdminUserDetail>> {
    const data = await this.adminUsersService.create(body);
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
    @Body() body: UpdateAdminMetaDto,
  ): Promise<ApiResponse<AdminMetaSettingsView>> {
    await this.metaSettingsService.save(body);
    return { ok: true, data: this.metaSettingsService.getAdminView() };
  }
}
