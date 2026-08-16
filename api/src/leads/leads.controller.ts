import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
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
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<ApiResponse<unknown>> {
    assertCanManageLeads(user);
    const data = await this.leadsService.listOrigins({
      area: user.area,
      channel,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return { ok: true, data };
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

  @Get('meta-forms/leads')
  async listFormLeads(
    @CurrentUser() user: AuthUser,
    @Query('form_id') formId?: string,
    @Query('limit') limit?: string,
  ): Promise<ApiResponse<unknown>> {
    assertCanManageLeads(user);
    const data = await this.metaLeadgen.listFormLeads(
      user.area,
      formId,
      limit ? Number(limit) : 50,
    );
    return { ok: true, data };
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
