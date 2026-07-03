import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
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
import { CampaignsService } from './campaigns.service';
import { RecipientsPreviewDto } from './dto/recipients-preview.dto';
import type {
  CampaignDetail,
  CampaignListItem,
  CampaignRetryActionResult,
  CampaignSummary,
  RecipientsPreviewResult,
  SendCampaignResult,
} from './campaigns.types';

@Controller('campaigns')
@UseGuards(JwtAuthGuard, ProvisionedGuard)
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
  ): Promise<ApiResponse<CampaignListItem[]>> {
    const data = await this.campaignsService.list(user.area);
    return { ok: true, data };
  }

  @Get('summary')
  async summary(
    @CurrentUser() user: AuthUser,
  ): Promise<ApiResponse<CampaignSummary>> {
    const data = await this.campaignsService.getSummary(user.area);
    return { ok: true, data };
  }

  @Post('recipients-preview')
  async recipientsPreview(
    @CurrentUser() user: AuthUser,
    @Body() body: RecipientsPreviewDto,
  ): Promise<ApiResponse<RecipientsPreviewResult>> {
    const data = await this.campaignsService.previewRecipients(user.area, body);
    return { ok: true, data };
  }

  @Post('send')
  async send(
    @CurrentUser() user: AuthUser,
    @Body() body: Record<string, unknown>,
  ): Promise<ApiResponse<SendCampaignResult>> {
    const data = await this.campaignsService.sendCampaign(user, body);
    return { ok: true, data };
  }

  @Get(':id/failed-export')
  async exportFailed(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.campaignsService.exportFailedCsv(
      user.area,
      id,
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  @Get(':id/logs-export')
  async exportLogs(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Query('filter') filter: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.campaignsService.exportLogsXlsx(
      user.area,
      id,
      String(filter || '').trim(),
    );
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  @Get(':id/incidents-export')
  async exportIncidents(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Query('filter') filter: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.campaignsService.exportIncidentsXlsx(
      user.area,
      id,
      String(filter || '').trim(),
    );
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  @Get(':id/responders-export')
  async exportResponders(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.campaignsService.exportRespondersXlsx(
      user.area,
      id,
    );
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  @Post(':id/sync-cost')
  async syncCost(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<
    ApiResponse<{
      amount: number;
      currency: string;
      source: string;
      isEstimated: boolean;
      deliveredCount: number;
    }>
  > {
    const data = await this.campaignsService.syncCost(user.area, id);
    return { ok: true, data };
  }

  @Post(':id/retry-failed')
  async retryFailed(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ApiResponse<CampaignRetryActionResult>> {
    const data = await this.campaignsService.retryFailed(user, id);
    return { ok: true, data };
  }

  @Get(':id')
  async detail(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ApiResponse<CampaignDetail>> {
    const data = await this.campaignsService.getById(user.area, id);
    return { ok: true, data };
  }
}
