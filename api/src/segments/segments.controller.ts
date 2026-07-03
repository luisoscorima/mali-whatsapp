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
import { CreateSegmentDto, UpdateSegmentDto } from './dto/segment.dto';
import { SegmentsService } from './segments.service';
import type { SegmentDefinition, SegmentDetail } from './segments.types';

@Controller('segments')
@UseGuards(JwtAuthGuard, ProvisionedGuard)
export class SegmentsController {
  constructor(private readonly segmentsService: SegmentsService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
  ): Promise<ApiResponse<SegmentDefinition[]>> {
    const data = await this.segmentsService.list(user.area);
    return { ok: true, data };
  }

  @Get(':id')
  async detail(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ApiResponse<SegmentDetail>> {
    const data = await this.segmentsService.getDetail(user.area, id);
    return { ok: true, data };
  }

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body() body: CreateSegmentDto,
  ): Promise<ApiResponse<SegmentDefinition>> {
    const data = await this.segmentsService.create(user, body);
    return { ok: true, data };
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateSegmentDto,
  ): Promise<ApiResponse<SegmentDefinition>> {
    const data = await this.segmentsService.update(user, id, body);
    return { ok: true, data };
  }

  @Delete(':id')
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ApiResponse<{ deleted: true }>> {
    await this.segmentsService.remove(user, id);
    return { ok: true, data: { deleted: true } };
  }

  @Delete(':id/contacts/:contactId')
  async removeMember(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('contactId', ParseIntPipe) contactId: number,
  ): Promise<ApiResponse<SegmentDetail>> {
    const data = await this.segmentsService.removeMember(
      user.area,
      id,
      contactId,
    );
    return { ok: true, data };
  }
}
