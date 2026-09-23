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
import { CrmEnsureAttributeDefinitionsDto } from './dto/crm-ensure-attribute-definitions.dto';
import { CrmIngestOriginDto } from './dto/crm-ingest-origin.dto';
import { CrmPatchContactDto } from './dto/crm-patch-contact.dto';
import { CrmSyncContactDto } from './dto/crm-sync-contact.dto';
import { CrmSendTemplateDto } from './dto/crm-send-template.dto';
import { LeadsService } from '../leads/leads.service';
import { EducationLeadWorkflowService } from '../leads/education-lead-workflow.service';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import type { LeadChannel } from '../leads/leads.types';
import { BadRequestException } from '@nestjs/common';
import { LEAD_CHANNELS } from '../leads/leads.types';

class EducationManagementDto {
  @IsOptional() @IsInt() @Min(1) assigned_user_id?: number | null;
  @IsOptional() @IsInt() @Min(1) lead_status_id?: number | null;
  @IsOptional() @IsString() @MaxLength(120) actor_email?: string;
}

class EducationReviewDto {
  @IsIn(['open_new', 'keep_existing', 'dismiss']) action!: 'open_new' | 'keep_existing' | 'dismiss';
  @IsOptional() @IsString() @MaxLength(120) actor_email?: string;
}

class EducationDistributeDto {
  @IsIn(['all', 'educacion', 'educacion_ca', 'educacion_ep']) area!: string;
  @IsOptional() @IsIn(LEAD_CHANNELS) channel?: string;
  @IsOptional() @IsString() @MaxLength(120) q?: string;
  @IsOptional() @IsString() @MaxLength(120) actor_email?: string;
}

@Controller('crm')
@UseGuards(CrmServiceTokenGuard)
export class CrmController {
  constructor(
    private readonly crm: CrmService,
    private readonly leads: LeadsService,
    private readonly educationWorkflow: EducationLeadWorkflowService,
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
   * Match: phone → dni → email.
   */
  @Post('origins')
  async ingestOrigin(@Body() body: CrmIngestOriginDto) {
    const channel = String(body.channel || '').trim() as LeadChannel;
    if (!(LEAD_CHANNELS as readonly string[]).includes(channel)) {
      throw new BadRequestException(`channel inválido: ${body.channel}`);
    }
    const data = await this.leads.upsertOrigin({
      area: body.area || 'ti',
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

  @Get('education/management-catalogs')
  async educationManagementCatalogs() {
    return { ok: true, data: await this.educationWorkflow.catalogs() };
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
