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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProvisionedGuard } from '../auth/guards/provisioned.guard';
import type { ApiResponse, AuthUser } from '../auth/auth.types';
import {
  assertCanListFlows,
  assertCanManageFlows,
  hasPermission,
} from '../auth/permission.util';
import { PERMISSION } from '../auth/roles';
import { MAX_MEDIA_DOCUMENT_BYTES } from '../conversations/conversation-whatsapp.util';
import { CreateFlowDto, UpdateFlowDto } from './dto/flow.dto';
import { FlowsService } from './flows.service';
import type {
  FlowDetail,
  FlowEventContactRow,
  FlowListItem,
} from './flows.types';
import {
  fetchFlowSummary,
  type FlowSummary,
} from './flow-summary.util';

@Controller('flows')
@UseGuards(JwtAuthGuard, ProvisionedGuard)
export class FlowsController {
  constructor(private readonly flowsService: FlowsService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
  ): Promise<ApiResponse<FlowListItem[]>> {
    assertCanListFlows(user);
    const data = await this.flowsService.list(user.area);
    return { ok: true, data };
  }

  @Get('summary')
  async summary(
    @CurrentUser() user: AuthUser,
  ): Promise<ApiResponse<FlowSummary>> {
    assertCanListFlows(user);
    const data = await this.flowsService.getSummary(user.area);
    return { ok: true, data };
  }

  @Get('advisors')
  async advisors(
    @CurrentUser() user: AuthUser,
  ): Promise<ApiResponse<{ id: number; label: string }[]>> {
    assertCanListFlows(user);
    const data = await this.flowsService.listAdvisors(user.area);
    return { ok: true, data };
  }

  @Post('media')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_MEDIA_DOCUMENT_BYTES, files: 1 },
    }),
  )
  async uploadMedia(
    @CurrentUser() user: AuthUser,
    @UploadedFile()
    file:
      | { buffer: Buffer; mimetype: string; originalname: string }
      | undefined,
    @Body() body: { kind?: string },
  ): Promise<
    ApiResponse<{
      url: string;
      mime: string;
      filename: string;
      wa_type: 'image' | 'document';
    }>
  > {
    assertCanManageFlows(user);
    const kindRaw = String(body?.kind || 'image').trim().toLowerCase();
    const kind = kindRaw === 'document' ? 'document' : 'image';
    if (!file) {
      throw new BadRequestException('Archivo obligatorio');
    }
    const data = await this.flowsService.uploadMedia(user.area, file, kind);
    return { ok: true, data };
  }

  @Get(':id/events')
  async events(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Query('client_key') clientKey?: string,
    @Query('event_type') eventType?: string,
  ): Promise<ApiResponse<FlowEventContactRow[]>> {
    assertCanListFlows(user);
    const data = await this.flowsService.listEventContacts(user.area, id, {
      client_key: clientKey,
      event_type: eventType,
    });
    return { ok: true, data };
  }

  @Get(':id')
  async detail(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ApiResponse<FlowDetail>> {
    assertCanListFlows(user);
    const data = await this.flowsService.getDetail(user.area, id);
    return { ok: true, data };
  }

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body() body: CreateFlowDto,
  ): Promise<ApiResponse<FlowDetail>> {
    assertCanManageFlows(user);
    const data = await this.flowsService.create(user.area, body);
    return { ok: true, data };
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateFlowDto,
  ): Promise<ApiResponse<FlowDetail>> {
    if (
      !hasPermission(user, PERMISSION.FLOWS_MANAGE) &&
      !hasPermission(user, PERMISSION.FLOWS_TOGGLE)
    ) {
      assertCanManageFlows(user);
    }
    const data = await this.flowsService.update(user.area, id, body);
    return { ok: true, data };
  }

  @Delete(':id')
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ApiResponse<{ deleted: true }>> {
    assertCanManageFlows(user);
    await this.flowsService.remove(user.area, id);
    return { ok: true, data: { deleted: true } };
  }
}
