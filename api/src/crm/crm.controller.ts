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
import { CrmAudienceQueryDto } from './dto/crm-audience-query.dto';
import { CrmContactsQueryDto } from './dto/crm-contacts-query.dto';
import { CrmPatchContactDto } from './dto/crm-patch-contact.dto';
import { CrmSyncContactDto } from './dto/crm-sync-contact.dto';

@Controller('crm')
@UseGuards(CrmServiceTokenGuard)
export class CrmController {
  constructor(private readonly crm: CrmService) {}

  /** Upsert contact from MALI ONE product (PamRegistration). */
  @Post('sync')
  async sync(@Body() body: CrmSyncContactDto) {
    const data = await this.crm.syncFromProduct(body);
    return { ok: true, data };
  }

  /** Email audience for mailing (opt_in_email + valid email). */
  @Get('audience')
  async audience(@Query() query: CrmAudienceQueryDto) {
    const data = await this.crm.listAudience(query);
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
