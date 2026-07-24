import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProvisionedGuard } from '../auth/guards/provisioned.guard';
import type { ApiResponse, AuthUser } from '../auth/auth.types';
import {
  CreateAdvisorNoteDto,
  UpdateAdvisorNoteDto,
} from './dto/advisor-note.dto';
import {
  AdvisorNotesService,
  type AdvisorNoteDto,
} from './advisor-notes.service';

@Controller('advisor-notes')
@UseGuards(JwtAuthGuard, ProvisionedGuard)
export class AdvisorNotesController {
  constructor(private readonly notesService: AdvisorNotesService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
  ): Promise<ApiResponse<AdvisorNoteDto[]>> {
    const data = await this.notesService.list(user.id);
    return { ok: true, data };
  }

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body() body: CreateAdvisorNoteDto,
  ): Promise<ApiResponse<AdvisorNoteDto>> {
    const data = await this.notesService.create(user.id, body);
    return { ok: true, data };
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateAdvisorNoteDto,
  ): Promise<ApiResponse<AdvisorNoteDto>> {
    const data = await this.notesService.update(user.id, id, body);
    return { ok: true, data };
  }

  @Delete(':id')
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ApiResponse<{ deleted: true }>> {
    await this.notesService.remove(user.id, id);
    return { ok: true, data: { deleted: true } };
  }
}
