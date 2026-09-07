import {
  Body,
  Controller,
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
import { ProvisionedGuard } from '../auth/guards/provisioned.guard';
import type { ApiResponse, AuthUser } from '../auth/auth.types';
import { assertCanManageLeads } from '../auth/permission.util';
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { LeadsService } from './leads.service';
import { MetaLeadgenService } from './meta-leadgen.service';

class CreateLeadStatusDto {
  @IsString()
  @MaxLength(50)
  slug!: string;

  @IsString()
  @MaxLength(120)
  label!: string;

  @IsOptional()
  @IsInt()
  sort_order?: number;

  @IsOptional()
  @IsBoolean()
  is_default?: boolean;

  @IsOptional()
  @IsBoolean()
  is_terminal?: boolean;
}

class UpdateLeadStatusDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;

  @IsOptional()
  @IsInt()
  sort_order?: number;

  @IsOptional()
  @IsBoolean()
  is_default?: boolean;

  @IsOptional()
  @IsBoolean()
  is_terminal?: boolean;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

class BackfillFormDto {
  @IsString()
  form_id!: string;
}

class UpdateFormRouteDto {
  @IsString()
  @MaxLength(32)
  area!: string;
}

class SetContactStatusDto {
  @IsInt()
  @Min(1)
  status_id!: number;
}

@Controller('leads')
@UseGuards(JwtAuthGuard, ProvisionedGuard)
export class LeadsController {
  constructor(
    private readonly leadsService: LeadsService,
    private readonly metaLeadgen: MetaLeadgenService,
  ) {}

  @Get('summary')
  async summary(
    @CurrentUser() user: AuthUser,
  ): Promise<ApiResponse<unknown>> {
    assertCanManageLeads(user);
    const data = await this.leadsService.channelSummary(user.area);
    return { ok: true, data };
  }

  @Get('origins')
  async origins(
    @CurrentUser() user: AuthUser,
    @Query('channel') channel?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<ApiResponse<unknown>> {
    assertCanManageLeads(user);
    const data = await this.leadsService.listOrigins({
      area: user.area,
      channel,
      q,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return { ok: true, data };
  }

  @Get('origins/export')
  async exportOrigins(
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
    @Query('channel') channel?: string,
    @Query('q') q?: string,
  ): Promise<void> {
    assertCanManageLeads(user);
    const { buffer, filename } = await this.leadsService.exportOrigins({
      area: user.area,
      channel,
      q,
    });
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  /** Catálogo de estados: lectura para asesores y gestores (asignar status). */
  @Get('statuses')
  async listStatuses(
    @CurrentUser() user: AuthUser,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.leadsService.listStatuses(user.area);
    return { ok: true, data };
  }

  @Post('statuses')
  async createStatus(
    @CurrentUser() user: AuthUser,
    @Body() body: CreateLeadStatusDto,
  ): Promise<ApiResponse<unknown>> {
    assertCanManageLeads(user);
    const data = await this.leadsService.createStatus(user.area, body);
    return { ok: true, data };
  }

  @Patch('statuses/:id')
  async updateStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateLeadStatusDto,
  ): Promise<ApiResponse<unknown>> {
    assertCanManageLeads(user);
    const data = await this.leadsService.updateStatus(user.area, id, body);
    return { ok: true, data };
  }

  /** Asignar estado del lead: asesores y gestores (ProvisionedGuard). */
  @Patch('contacts/:contactId/status')
  async setContactStatus(
    @CurrentUser() user: AuthUser,
    @Param('contactId', ParseIntPipe) contactId: number,
    @Body() body: SetContactStatusDto,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.leadsService.setContactStatus(
      user.area,
      contactId,
      body.status_id,
    );
    return { ok: true, data };
  }

  @Get('meta-forms')
  async listForms(
    @CurrentUser() user: AuthUser,
  ): Promise<ApiResponse<unknown>> {
    assertCanManageLeads(user);
    const data = await this.metaLeadgen.listForms(user.area);
    return { ok: true, data };
  }

  @Get('meta-forms/routes')
  async listFormRoutes(
    @CurrentUser() user: AuthUser,
  ): Promise<ApiResponse<unknown>> {
    assertCanManageLeads(user);
    const data = await this.metaLeadgen.listFormRoutes();
    return { ok: true, data };
  }

  @Patch('meta-forms/routes/:formId')
  async updateFormRoute(
    @CurrentUser() user: AuthUser,
    @Param('formId') formId: string,
    @Body() body: UpdateFormRouteDto,
  ): Promise<ApiResponse<unknown>> {
    assertCanManageLeads(user);
    const data = await this.metaLeadgen.updateFormRoute(formId, body);
    return { ok: true, data };
  }

  @Post('meta-forms/sync-forms')
  async syncForms(
    @CurrentUser() user: AuthUser,
  ): Promise<ApiResponse<unknown>> {
    assertCanManageLeads(user);
    const data = await this.metaLeadgen.syncFormsFromGraph(user.area);
    return { ok: true, data };
  }

  @Get('meta-forms/leads')
  async listFormLeads(
    @CurrentUser() user: AuthUser,
    @Query('form_id') formId?: string,
    @Query('form_name') formName?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<ApiResponse<unknown>> {
    assertCanManageLeads(user);
    const data = await this.metaLeadgen.listFormLeads(user.area, {
      formId,
      formName,
      q,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return { ok: true, data };
  }

  @Get('meta-forms/leads/export')
  async exportFormLeads(
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
    @Query('form_id') formId?: string,
    @Query('form_name') formName?: string,
    @Query('q') q?: string,
  ): Promise<void> {
    assertCanManageLeads(user);
    const { buffer, filename } = await this.metaLeadgen.exportFormLeads(
      user.area,
      { formId, formName, q },
    );
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  @Post('meta-forms/backfill')
  async backfill(
    @CurrentUser() user: AuthUser,
    @Body() body: BackfillFormDto,
  ): Promise<ApiResponse<unknown>> {
    assertCanManageLeads(user);
    const data = await this.metaLeadgen.backfillForm(user.area, body.form_id);
    return { ok: true, data };
  }

  @Get('meta-forms/leads/:id')
  async getLead(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ApiResponse<unknown>> {
    assertCanManageLeads(user);
    const data = await this.metaLeadgen.getLead(user.area, id);
    return { ok: true, data };
  }
}
