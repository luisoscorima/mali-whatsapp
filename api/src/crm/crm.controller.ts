import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { CrmServiceTokenGuard } from './crm-service-token.guard';
import { CrmService } from './crm.service';
import { CrmAudienceQueryDto } from './dto/crm-audience-query.dto';
import { CrmContactsQueryDto } from './dto/crm-contacts-query.dto';
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
}
