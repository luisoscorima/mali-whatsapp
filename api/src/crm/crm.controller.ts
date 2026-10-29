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
import { CrmServiceTokenGuard } from './crm-service-token.guard';
import { CrmService } from './crm.service';
import {
  CrmCreateAttributeDefinitionDto,
  CrmUpdateAttributeDefinitionDto,
} from './dto/crm-attribute-definition.dto';
import { CrmAudienceBodyDto } from './dto/crm-audience-body.dto';
import { CrmAudienceQueryDto } from './dto/crm-audience-query.dto';
import { CrmContactsQueryDto } from './dto/crm-contacts-query.dto';
import { CrmEducationLeadsQueryDto } from './dto/crm-education-leads-query.dto';
import { CrmEducationCyclesQueryDto } from './dto/crm-education-cycles-query.dto';
import { CrmEnsureAttributeDefinitionsDto } from './dto/crm-ensure-attribute-definitions.dto';
import { CrmIngestOriginDto } from './dto/crm-ingest-origin.dto';
import { CrmPatchContactDto } from './dto/crm-patch-contact.dto';
import { CrmSyncContactDto } from './dto/crm-sync-contact.dto';
import { CrmSendTemplateDto } from './dto/crm-send-template.dto';
import { LeadsService } from '../leads/leads.service';
import { EducationLeadWorkflowService } from '../leads/education-lead-workflow.service';
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min, ValidateNested } from 'class-validator';
import { educationProgramOf, isEducationAreaSlug } from '../config/education-scope';
import { Type } from 'class-transformer';
import { ProspectiaAdvisorService } from '../leads/prospectia-advisor.service';
import { ProspectiaSyncService } from '../leads/prospectia-sync.service';
import type { LeadChannel } from '../leads/leads.types';
import { BadRequestException } from '@nestjs/common';
import { LEAD_CHANNELS } from '../leads/leads.types';

class EducationManagementDto {
  @IsOptional() @IsInt() @Min(1) assigned_user_id?: number | null;
  @IsOptional() @IsInt() @Min(1) lead_status_id?: number | null;
  @IsOptional() @IsInt() @Min(1) lead_id?: number;
  @IsOptional() @IsString() @MaxLength(120) actor_email?: string;
}

class EducationReviewDto {
  @IsIn(['open_new', 'keep_existing', 'dismiss']) action!: 'open_new' | 'keep_existing' | 'dismiss';
  @IsOptional() @IsString() @MaxLength(120) actor_email?: string;
}

class ProspectiaSubjectDto {
  @IsString() @MaxLength(160) key!: string;
  @IsOptional() @IsString() @MaxLength(32) phone?: string | null;
  @IsOptional() @IsString() @MaxLength(64) username?: string | null;
  @IsOptional() @IsString() @MaxLength(128) whatsapp_user_id?: string | null;
}

class ProspectiaCheckDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => ProspectiaSubjectDto)
  subjects!: ProspectiaSubjectDto[];
}

class EducationDistributeDto {
  @Matches(/^(all|educacion(_[a-z][a-z0-9_]{0,9})?|[a-z][a-z0-9_]{0,9})$/)
  area!: string;
  @IsOptional() @IsIn(LEAD_CHANNELS) channel?: string;
  @IsOptional() @IsString() @MaxLength(120) q?: string;
  @IsOptional() @IsString() @MaxLength(120) actor_email?: string;
}

class EducationCreateStatusDto {
  @IsIn(['educacion', 'educacion_ca', 'educacion_ep']) area!: string;
  @IsString() @MaxLength(50) slug!: string;
  @IsString() @MaxLength(120) label!: string;
  @IsOptional() @IsInt() sort_order?: number;
  @IsOptional() @IsBoolean() is_default?: boolean;
  @IsOptional() @IsBoolean() is_terminal?: boolean;
}

class EducationUpdateStatusDto {
  @IsIn(['educacion', 'educacion_ca', 'educacion_ep']) area!: string;
  @IsOptional() @IsString() @MaxLength(120) label?: string;
  @IsOptional() @IsInt() sort_order?: number;
  @IsOptional() @IsBoolean() is_default?: boolean;
  @IsOptional() @IsBoolean() is_terminal?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;
}

@Controller('crm')
@UseGuards(CrmServiceTokenGuard)
export class CrmController {
  constructor(
    private readonly crm: CrmService,
    private readonly leads: LeadsService,
    private readonly educationWorkflow: EducationLeadWorkflowService,
    private readonly prospectia: ProspectiaAdvisorService,
    private readonly prospectiaSync: ProspectiaSyncService,
  ) {}

  /** Upsert contact from MALI ONE product (PamRegistration). */
  @Post('sync')
  async sync(@Body() body: CrmSyncContactDto) {
    const data = await this.crm.syncFromProduct(body);
    return { ok: true, data };
  }

  /** Plantilla WhatsApp transaccional (p. ej. bienvenida PAM desde MALI ONE). */
  @Post('send-template')
  async sendTemplate(@Body() body: CrmSendTemplateDto) {
    const data = await this.crm.sendProductTemplate(body);
    return { ok: true, data };
  }

  /**
   * Ingest lead origin (widget / multichannel). No lead-campaign attributes.
   * Match global de persona: identidad de WhatsApp, teléfono, DNI, correo.
   */
  @Post('origins')
  async ingestOrigin(@Body() body: CrmIngestOriginDto) {
    const channel = String(body.channel || '').trim() as LeadChannel;
    if (!(LEAD_CHANNELS as readonly string[]).includes(channel)) {
      throw new BadRequestException(`channel inválido: ${body.channel}`);
    }
    const requested = String(body.area || 'ti').trim().toLowerCase();
    const program = educationProgramOf(body.categoria) || educationProgramOf(requested);
    let area = requested;
    if (program === 'ca') area = 'educacion_ca';
    else if (program === 'ep') area = 'educacion_ep';
    else if (program || requested === 'educacion' || isEducationAreaSlug(requested)) area = 'educacion';
    const data = await this.leads.upsertOrigin({
      area,
      program_slug: program,
      channel,
      external_id: body.external_id,
      source_key: body.source_key,
      source_label: body.source_label,
      payload: body.payload,
      contact: {
        name: body.name,
        last_name: body.last_name,
        phone: body.phone,
        email: body.email,
        dni: body.dni,
        opt_in: body.opt_in,
        opt_in_email: body.opt_in_email,
      },
    });
    return { ok: true, data };
  }

  /** Email audience for mailing (opt_in_email + valid email). Legacy single segment. */
  @Get('audience')
  async audience(@Query() query: CrmAudienceQueryDto) {
    const data = await this.crm.listAudience(query);
    return { ok: true, data };
  }

  /**
   * Email audience with multi-segment include/exclude (MALI ONE campaigns).
   * Same response shape as GET /audience.
   */
  @Post('audience')
  async audiencePost(@Body() body: CrmAudienceBodyDto) {
    const data = await this.crm.listAudience(body);
    return { ok: true, data };
  }

  /** Full PAM contact list for MALI ONE CRM view. */
  @Get('education/contacts')
  async educationContacts(@Query() query: CrmContactsQueryDto) {
    const data = await this.crm.listEducationContacts(query);
    return { ok: true, data };
  }

  @Get('education/leads')
  async educationLeads(@Query() query: CrmEducationLeadsQueryDto) {
    const data = await this.educationWorkflow.listEntries(query);
    return { ok: true, data };
  }

  /** Open opportunities (ciclo = lead), independent of entries list. */
  @Get('education/cycles')
  async educationCycles(@Query() query: CrmEducationCyclesQueryDto) {
    const data = await this.educationWorkflow.listCycles(query);
    return { ok: true, data };
  }

  @Post('education/attention/start')
  async educationStartAttention(
    @Body() body: { contact_id: number; area: string; program_id?: number | null; conversation_id?: number | null; actor_email?: string },
  ) {
    const data = await this.educationWorkflow.startAttention({
      contactId: body.contact_id,
      area: body.area,
      programId: body.program_id ?? null,
      conversationId: body.conversation_id ?? null,
      actorEmail: body.actor_email,
    });
    return { ok: true, data };
  }

  @Post('education/prospectia/check')
  async educationProspectiaCheck(@Body() body: ProspectiaCheckDto) {
    if (body.subjects.length > 50 || body.subjects.some((subject) =>
      subject.key.length > 160 || (subject.phone?.length ?? 0) > 32 ||
      (subject.username?.length ?? 0) > 64 || (subject.whatsapp_user_id?.length ?? 0) > 128)) {
      throw new BadRequestException('Máximo 50 contactos');
    }
    return { ok: true, data: await this.prospectia.checkSubjects(body.subjects) };
  }

  @Post('education/prospectia/sync')
  educationProspectiaSync() {
    return { ok: true, data: this.prospectiaSync.start('all') };
  }

  @Get('education/prospectia/sync')
  educationProspectiaSyncStatus() {
    return { ok: true, data: this.prospectiaSync.status() };
  }

  @Get('education/management-catalogs')
  async educationManagementCatalogs() {
    return { ok: true, data: await this.educationWorkflow.catalogs() };
  }

  @Get('education/statuses')
  async educationStatuses() {
    const areas = ['educacion', 'educacion_ca', 'educacion_ep'];
    const statuses = await Promise.all(
      areas.map((area) => this.leads.listStatuses(area, { includeInactive: true })),
    );
    return { ok: true, data: statuses.flat() };
  }

  @Post('education/statuses')
  async educationCreateStatus(@Body() body: EducationCreateStatusDto) {
    const { area, ...status } = body;
    return { ok: true, data: await this.leads.createStatus(area, status) };
  }

  @Patch('education/statuses/:id')
  async educationUpdateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: EducationUpdateStatusDto,
  ) {
    const { area, ...status } = body;
    return { ok: true, data: await this.leads.updateStatus(area, id, status) };
  }

  @Patch('education/contacts/:id/management')
  async educationManagement(
    @Param('id', ParseIntPipe) id: number,
    @Query('area') area: string,
    @Body() body: EducationManagementDto,
  ) {
    return { ok: true, data: await this.educationWorkflow.updateManagement(id, area, body) };
  }

  @Post('education/distribute')
  async educationDistribute(@Body() body: EducationDistributeDto) {
    return { ok: true, data: await this.educationWorkflow.distribute(body) };
  }

  @Patch('education/entries/:id/review')
  async educationReview(
    @Param('id', ParseIntPipe) id: number,
    @Query('area') area: string,
    @Body() body: EducationReviewDto,
  ) {
    return { ok: true, data: await this.educationWorkflow.reviewEntry(id, area, body.action, body.actor_email) };
  }

  /** Full PAM contact list for MALI ONE CRM view. */
  @Get('contacts')
  async contacts(@Query() query: CrmContactsQueryDto) {
    const data = await this.crm.listContacts(query);
    return { ok: true, data };
  }

  @Patch('contacts/:id')
  async patchContact(
    @Param('id', ParseIntPipe) id: number,
    @Query('area') area: string | undefined,
    @Body() body: CrmPatchContactDto,
  ) {
    const data = await this.crm.patchContact(id, area, body);
    return { ok: true, data };
  }

  @Get('attribute-definitions')
  async listAttributeDefinitions(@Query('area') area?: string) {
    const data = await this.crm.listAttributeDefinitions(area);
    return { ok: true, data };
  }

  @Get('segments')
  async listSegments(@Query('area') area?: string) {
    const data = await this.crm.listSegments(area);
    return { ok: true, data };
  }

  @Post('attribute-definitions')
  async createAttributeDefinition(
    @Body() body: CrmCreateAttributeDefinitionDto,
  ) {
    const data = await this.crm.createAttributeDefinition(body);
    return { ok: true, data };
  }

  @Post('attribute-definitions/ensure')
  async ensureAttributeDefinitions(
    @Body() body: CrmEnsureAttributeDefinitionsDto,
  ) {
    const data = await this.crm.ensureAttributeDefinitions(body);
    return { ok: true, data };
  }

  @Patch('attribute-definitions/:id')
  async updateAttributeDefinition(
    @Param('id', ParseIntPipe) id: number,
    @Query('area') area: string | undefined,
    @Body() body: CrmUpdateAttributeDefinitionDto,
  ) {
    const data = await this.crm.updateAttributeDefinition(id, area, body);
    return { ok: true, data };
  }
}
