import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProvisionedGuard } from '../auth/guards/provisioned.guard';
import type { ApiResponse, AuthUser } from '../auth/auth.types';
import {
  EnableAiDto,
  UpdateAiConfigDto,
  UpdateBusinessHoursDto,
} from './dto/settings.dto';
import { SettingsService } from './settings.service';
import type {
  AiSettingsView,
  BusinessHoursSettingsView,
  IntegrationSettings,
  SettingsModuleItem,
} from './settings.types';

@Controller('settings')
@UseGuards(JwtAuthGuard, ProvisionedGuard)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get('modules')
  async modules(
    @CurrentUser() user: AuthUser,
  ): Promise<
    ApiResponse<{ modules: SettingsModuleItem[]; first_path: string | null }>
  > {
    const data = this.settingsService.getModules(user);
    return { ok: true, data };
  }

  @Get('integration')
  async integration(
    @CurrentUser() user: AuthUser,
  ): Promise<ApiResponse<IntegrationSettings>> {
    const data = this.settingsService.getIntegration(user);
    return { ok: true, data };
  }

  @Get('ai')
  async getAi(@CurrentUser() user: AuthUser): Promise<ApiResponse<AiSettingsView>> {
    const data = await this.settingsService.getAi(user);
    return { ok: true, data };
  }

  @Get('ai/:area')
  async getAiForArea(
    @CurrentUser() user: AuthUser,
    @Param('area') area: string,
  ): Promise<ApiResponse<AiSettingsView>> {
    const data = await this.settingsService.getAi(user, area);
    return { ok: true, data };
  }

  @Patch('ai')
  async patchAi(
    @CurrentUser() user: AuthUser,
    @Body() body: UpdateAiConfigDto,
  ): Promise<ApiResponse<undefined>> {
    await this.settingsService.updateAi(user, body);
    return { ok: true, data: undefined };
  }

  @Patch('ai/:area')
  async patchAiForArea(
    @CurrentUser() user: AuthUser,
    @Param('area') area: string,
    @Body() body: UpdateAiConfigDto,
  ): Promise<ApiResponse<undefined>> {
    await this.settingsService.updateAi(user, body, area);
    return { ok: true, data: undefined };
  }

  @Post('ai/enable')
  async enableAi(
    @CurrentUser() user: AuthUser,
    @Body() body: EnableAiDto,
  ): Promise<ApiResponse<undefined>> {
    await this.settingsService.enableAi(user, body);
    return { ok: true, data: undefined };
  }

  @Post('ai/:area/enable')
  async enableAiForArea(
    @CurrentUser() user: AuthUser,
    @Param('area') area: string,
    @Body() body: EnableAiDto,
  ): Promise<ApiResponse<undefined>> {
    await this.settingsService.enableAi(user, body, area);
    return { ok: true, data: undefined };
  }

  @Get('business-hours')
  async getBusinessHours(
    @CurrentUser() user: AuthUser,
  ): Promise<ApiResponse<BusinessHoursSettingsView>> {
    const data = await this.settingsService.getBusinessHours(user);
    return { ok: true, data };
  }

  @Get('business-hours/:area')
  async getBusinessHoursForArea(
    @CurrentUser() user: AuthUser,
    @Param('area') area: string,
  ): Promise<ApiResponse<BusinessHoursSettingsView>> {
    const data = await this.settingsService.getBusinessHours(user, area);
    return { ok: true, data };
  }

  @Patch('business-hours')
  async patchBusinessHours(
    @CurrentUser() user: AuthUser,
    @Body() body: UpdateBusinessHoursDto,
  ): Promise<ApiResponse<undefined>> {
    await this.settingsService.updateBusinessHours(user, body);
    return { ok: true, data: undefined };
  }

  @Patch('business-hours/:area')
  async patchBusinessHoursForArea(
    @CurrentUser() user: AuthUser,
    @Param('area') area: string,
    @Body() body: UpdateBusinessHoursDto,
  ): Promise<ApiResponse<undefined>> {
    await this.settingsService.updateBusinessHours(user, body, area);
    return { ok: true, data: undefined };
  }
}
