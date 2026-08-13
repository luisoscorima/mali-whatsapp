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
import { CrmEnsureAttributeDefinitionsDto } from './dto/crm-ensure-attribute-definitions.dto';
import { CrmIngestOriginDto } from './dto/crm-ingest-origin.dto';
import { CrmPatchContactDto } from './dto/crm-patch-contact.dto';
import { CrmSyncContactDto } from './dto/crm-sync-contact.dto';
import { LeadsService } from '../leads/leads.service';
import type { LeadChannel } from '../leads/leads.types';
import { BadRequestException } from '@nestjs/common';
import { LEAD_CHANNELS } from '../leads/leads.types';

@Controller('crm')
@UseGuards(CrmServiceTokenGuard)
export class CrmController {
  constructor(
    private readonly crm: CrmService,
    private readonly leads: LeadsService,
  ) {}

  /** Upsert contact from MALI ONE product (PamRegistration). */
  @Post('sync')
  async sync(@Body() body: CrmSyncContactDto) {
    const data = await this.crm.syncFromProduct(body);
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
