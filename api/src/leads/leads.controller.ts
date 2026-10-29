import {
  BadRequestException,
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
import { parseCategorySlugs } from '../config/category-scope';
import { LeadsService } from './leads.service';
import { EducationLeadWorkflowService } from './education-lead-workflow.service';
import { MetaLeadgenService } from './meta-leadgen.service';
import { TikTokLeadgenService } from './tiktok-leadgen.service';

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

class UpdateTikTokFormRouteDto {
  @IsString()
  @MaxLength(32)
  area!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  category?: string;
}

class UpdateMetaFormRouteDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  area?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  category?: string;

  @IsOptional()
  @IsBoolean()
  is_operational?: boolean;
}

class SetContactStatusDto {
  @IsInt()
  @Min(1)
  status_id!: number;

  /** Preferred: target the open attention cycle explicitly. */
  @IsOptional()
  @IsInt()
  @Min(1)
  lead_id?: number;

  /** Fallback when lead_id is unknown: category slug (general|ca|ep|…). */
  @IsOptional()
  @IsString()
  @MaxLength(32)
  category?: string;
}

class StartAttentionDto {
  @IsInt()
  @Min(1)
  contact_id!: number;

  @IsOptional()
  @IsInt()
  program_id?: number | null;

  @IsOptional()
  @IsInt()
  conversation_id?: number | null;
}

@Controller('leads')
@UseGuards(JwtAuthGuard, ProvisionedGuard)
export class LeadsController {
  constructor(
    private readonly leadsService: LeadsService,
    private readonly educationWorkflow: EducationLeadWorkflowService,
    private readonly metaLeadgen: MetaLeadgenService,
    private readonly tiktokLeadgen: TikTokLeadgenService,
  ) {}

  @Post('mali-one-links/backfill')
  async backfillMaliOneLinks(
    @CurrentUser() user: AuthUser,
    @Query('apply') apply?: string,
  ): Promise<ApiResponse<unknown>> {
    assertCanManageLeads(user);
    const data = await this.leadsService.backfillOrganicMaliOneLinks({
      apply: apply === '1' || apply === 'true',
    });
    return { ok: true, data };
  }

  @Get('summary')
  async summary(
    @CurrentUser() user: AuthUser,
    @Query('category') category?: string | string[],
  ): Promise<ApiResponse<unknown>> {
    assertCanManageLeads(user);
    const data = await this.leadsService.channelSummary(
      user.area,
      parseCategorySlugs(category),
    );
    return { ok: true, data };
  }

  /** Open opportunities (one row per lead), including leads without chat. */
  @Get('cycles')
  async listCycles(
    @CurrentUser() user: AuthUser,
    @Query('q') q?: string,
    @Query('unassigned') unassigned?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('category') category?: string | string[],
  ): Promise<ApiResponse<unknown>> {
    assertCanManageLeads(user);
    const categories = parseCategorySlugs(category) ?? [];
    const data = await this.educationWorkflow.listOpenCycles({
      area: categories[0] ?? user.area,
      q,
      unassigned: unassigned === '1' || unassigned === 'true',
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
    return { ok: true, data };
  }

  @Get('attention/current')
  async currentAttention(
    @CurrentUser() user: AuthUser,
    @Query('contact_id') contactIdRaw?: string,
    @Query('conversation_id') conversationIdRaw?: string,
  ): Promise<ApiResponse<unknown>> {
    const contactId = Number(contactIdRaw);
    if (!Number.isInteger(contactId) || contactId <= 0) {
      throw new BadRequestException('contact_id inválido');
    }
    const conversationId = conversationIdRaw ? Number(conversationIdRaw) : null;
    const data = await this.educationWorkflow.getAttentionForContext({
      contactId,
      area: user.area,
      conversationId:
        conversationId && Number.isInteger(conversationId) && conversationId > 0
          ? conversationId
          : null,
      user,
    });
    return { ok: true, data };
  }

  @Post('attention/start')
  async startAttention(
    @CurrentUser() user: AuthUser,
    @Body() body: StartAttentionDto,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.educationWorkflow.startAttention({
      contactId: body.contact_id,
      area: user.area,
      programId: body.program_id ?? null,
      conversationId: body.conversation_id ?? null,
      actorEmail: user.email,
      user,
    });
    return { ok: true, data };
  }

  @Get('alerts')
  async listAlerts(
    @CurrentUser() user: AuthUser,
    @Query('limit') limit?: string,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.educationWorkflow.listAlertsForUser(
      {
        id: user.id,
        area: user.area,
        is_master: user.isMaster,
        email: user.email,
        businessAccess: user.businessAccess,
        allowedAreas: user.allowedAreas,
      },
      { limit: limit ? Number(limit) : undefined },
    );
    return { ok: true, data };
  }

  @Post('alerts/:id/read')
  async markAlertRead(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.educationWorkflow.markAlertRead(id, user.id);
    return { ok: true, data };
  }

  @Patch('cycles/:id/attributes')
  async setCycleAttributes(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { attributes: Record<string, string> },
  ): Promise<ApiResponse<unknown>> {
    const data = await this.educationWorkflow.setLeadAttributes(
      id,
      body.attributes ?? {},
      user.email,
      user,
    );
    return { ok: true, data };
  }

  @Get('origins')
  async origins(
    @CurrentUser() user: AuthUser,
    @Query('channel') channel?: string,
    @Query('q') q?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('category') category?: string | string[],
  ): Promise<ApiResponse<unknown>> {
    assertCanManageLeads(user);
    const data = await this.leadsService.listOrigins({
      area: user.area,
      channel,
      q,
      from,
      to,
      categories: parseCategorySlugs(category),
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
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('category') category?: string | string[],
  ): Promise<void> {
    assertCanManageLeads(user);
    const { buffer, filename } = await this.leadsService.exportOrigins({
      area: user.area,
      channel,
      q,
      from,
      to,
      categories: parseCategorySlugs(category),
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
      {
        leadId: body.lead_id ?? null,
        category: body.category ?? null,
        user,
      },
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
    @Query('all') all?: string,
  ): Promise<ApiResponse<unknown>> {
    assertCanManageLeads(user);
    // La Página de Meta es compartida por CA, EP y Educación; el catálogo
    // operativo debe mostrar los forms aprobados de las tres rutas.
    const data = await this.metaLeadgen.listFormRoutes(undefined, all !== 'true');
    return { ok: true, data };
  }

  @Patch('meta-forms/routes/:formId')
  async updateFormRoute(
    @CurrentUser() user: AuthUser,
    @Param('formId') formId: string,
    @Body() body: UpdateMetaFormRouteDto,
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

  @Get('tiktok-forms/routes')
  async listTikTokFormRoutes(
    @CurrentUser() user: AuthUser,
  ): Promise<ApiResponse<unknown>> {
    assertCanManageLeads(user);
    const data = await this.tiktokLeadgen.listFormRoutes();
    return { ok: true, data };
  }

  @Patch('tiktok-forms/routes/:formId')
  async updateTikTokFormRoute(
    @CurrentUser() user: AuthUser,
    @Param('formId') formId: string,
    @Body() body: UpdateTikTokFormRouteDto,
  ): Promise<ApiResponse<unknown>> {
    assertCanManageLeads(user);
    const data = await this.tiktokLeadgen.updateFormRoute(formId, body);
    return { ok: true, data };
  }

  @Post('tiktok-forms/sync-forms')
  async syncTikTokForms(
    @CurrentUser() user: AuthUser,
  ): Promise<ApiResponse<unknown>> {
    assertCanManageLeads(user);
    const data = await this.tiktokLeadgen.syncFormsFromTikTok();
    return { ok: true, data };
  }

  @Get('tiktok-forms/leads')
  async listTikTokFormLeads(
    @CurrentUser() user: AuthUser,
    @Query('form_id') formId?: string,
    @Query('form_name') formName?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<ApiResponse<unknown>> {
    assertCanManageLeads(user);
    const data = await this.tiktokLeadgen.listFormLeads(user.area, {
      formId,
      formName,
      q,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return { ok: true, data };
  }

  @Post('tiktok-forms/backfill')
  async backfillTikTok(
    @CurrentUser() user: AuthUser,
    @Body() body: BackfillFormDto,
  ): Promise<ApiResponse<unknown>> {
    assertCanManageLeads(user);
    const data = await this.tiktokLeadgen.backfillForm(body.form_id);
    return { ok: true, data };
  }
}
