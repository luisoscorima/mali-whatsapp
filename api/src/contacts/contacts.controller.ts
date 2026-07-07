import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProvisionedGuard } from '../auth/guards/provisioned.guard';
import type { ApiResponse, AuthUser } from '../auth/auth.types';
import { buildContactImportSampleXlsxBuffer, MAX_CSV_BYTES } from './contacts-import.utils';
import { ContactsService } from './contacts.service';
import type {
  ContactDetail,
  ContactsFilterOptions,
  ContactsImportResult,
  ContactsListResult,
} from './contacts.types';
import { ListContactsQueryDto } from './dto/list-contacts.query.dto';
import { BulkAddSegmentDto } from './dto/bulk-add-segment.dto';
import { SetAssignableSegmentDto } from './dto/set-assignable-segment.dto';
import { UpsertContactDto } from './dto/upsert-contact.dto';

function normalizeSegmentParam(
  raw: string | string[] | undefined,
): string[] | undefined {
  if (raw === undefined) return undefined;
  const values = Array.isArray(raw) ? raw : [raw];
  return values.map((item) => String(item).trim()).filter(Boolean);
}

function isImportFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('.csv') || lower.endsWith('.xlsx');
}

@Controller('contacts')
@UseGuards(JwtAuthGuard, ProvisionedGuard)
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Get('filter-options')
  async filterOptions(
    @CurrentUser() user: AuthUser,
  ): Promise<ApiResponse<ContactsFilterOptions>> {
    const data = await this.contactsService.getFilterOptions(user.area);
    return { ok: true, data };
  }

  @Get('import/sample')
  downloadSample(@Res() res: Response): void {
    const buffer = buildContactImportSampleXlsxBuffer();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="contactos-ejemplo.xlsx"',
    );
    res.send(buffer);
  }

  @Post('import')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_CSV_BYTES },
    }),
  )
  async import(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: { buffer: Buffer; originalname: string } | undefined,
  ): Promise<ApiResponse<ContactsImportResult>> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Selecciona un archivo CSV o Excel');
    }
    if (!isImportFileName(file.originalname ?? '')) {
      throw new BadRequestException('Solo archivos .csv o .xlsx');
    }
    const data = await this.contactsService.importFromBuffer(
      user,
      file.buffer,
      file.originalname,
    );
    return { ok: true, data };
  }

  @Get('export')
  async exportList(
    @CurrentUser() user: AuthUser,
    @Query() query: ListContactsQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.contactsService.exportFiltered(
      user.area,
      {
        page: query.page,
        limit: query.limit,
        q: query.q,
        segment: normalizeSegmentParam(query.segment),
        show_replaced:
          query.show_replaced === '1' || query.show_replaced === 'true',
        attr_key: query.attr_key,
        attr_value: query.attr_value,
      },
      String(query.attrs ?? '1') !== '0',
    );
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  @Post('bulk-add-segment')
  async bulkAddSegment(
    @CurrentUser() user: AuthUser,
    @Body() body: BulkAddSegmentDto,
  ): Promise<ApiResponse<{ updated: number }>> {
    const data = await this.contactsService.bulkAddSegment(
      user,
      body.segment_slug,
      body.contact_ids,
    );
    return { ok: true, data };
  }

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query() query: ListContactsQueryDto,
  ): Promise<ApiResponse<ContactsListResult>> {
    const data = await this.contactsService.list(user.area, {
      page: query.page,
      limit: query.limit,
      q: query.q,
      segment: normalizeSegmentParam(query.segment),
      show_replaced:
        query.show_replaced === '1' || query.show_replaced === 'true',
      attr_key: query.attr_key,
      attr_value: query.attr_value,
    });
    return { ok: true, data };
  }

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body() body: UpsertContactDto,
  ): Promise<ApiResponse<ContactDetail>> {
    const data = await this.contactsService.create(user, body);
    return { ok: true, data };
  }

  @Get(':id')
  async getOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ApiResponse<ContactDetail>> {
    const data = await this.contactsService.getById(user.area, id);
    return { ok: true, data };
  }

  @Patch(':id/assignable-segment')
  async setAssignableSegment(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: SetAssignableSegmentDto,
  ): Promise<ApiResponse<{ segment_slugs: string[] }>> {
    const data = await this.contactsService.setAssignableSegment(
      user,
      id,
      body.segment_slug,
    );
    return { ok: true, data };
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpsertContactDto,
  ): Promise<ApiResponse<ContactDetail>> {
    const data = await this.contactsService.update(user, id, body);
    return { ok: true, data };
  }

  @Delete(':id')
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ApiResponse<{ deleted: true }>> {
    await this.contactsService.remove(user, id);
    return { ok: true, data: { deleted: true } };
  }

  @Post(':id/reactivate')
  async reactivate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ApiResponse<ContactDetail>> {
    const data = await this.contactsService.reactivate(user.area, id);
    return { ok: true, data };
  }
}
