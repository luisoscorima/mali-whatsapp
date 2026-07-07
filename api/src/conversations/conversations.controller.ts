import {
  Body,
  Controller,
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
import { MAX_MEDIA_DOCUMENT_BYTES } from './conversation-whatsapp.util';
import { ConversationsService } from './conversations.service';
import type {
  EnsureConversationResult,
  InboxDetail,
  InboxListResult,
  ReplyResult,
  UpdateConversationModeResult,
  InboxConversationUpdates,
  ConversationAssigneesResult,
  AssignConversationResult,
  MessageReactionResult,
} from './conversations.types';
import {
  ReplyConversationDto,
  UpdateConversationModeDto,
  LeadScoreDto,
  AssignConversationDto,
  MessageReactionDto,
} from './dto/conversations.dto';

@Controller('conversations')
@UseGuards(JwtAuthGuard, ProvisionedGuard)
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Get('summary')
  async summary(
    @CurrentUser() user: AuthUser,
    @Query('days') days?: string,
    @Query('advisor_id') advisorId?: string,
  ) {
    const data = await this.conversationsService.getSummary(user, days, advisorId);
    return { ok: true, data };
  }

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query() query: Record<string, string | string[] | undefined>,
  ): Promise<ApiResponse<InboxListResult>> {
    const data = await this.conversationsService.list(user, query);
    return { ok: true, data };
  }

  @Get('assignees')
  async listAssignees(
    @CurrentUser() user: AuthUser,
  ): Promise<ApiResponse<ConversationAssigneesResult>> {
    const data = await this.conversationsService.listAssignees(user);
    return { ok: true, data };
  }

  @Post('from-contact/:contactId')
  async ensureFromContact(
    @CurrentUser() user: AuthUser,
    @Param('contactId', ParseIntPipe) contactId: number,
  ): Promise<ApiResponse<EnsureConversationResult>> {
    const data = await this.conversationsService.ensureFromContact(
      user,
      contactId,
    );
    return { ok: true, data };
  }

  @Post(':id/send-template')
  async sendTemplate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: Record<string, unknown>,
  ) {
    const data = await this.conversationsService.sendDirectTemplate(user, id, body);
    return { ok: true, data };
  }

  @Post(':id/reply')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_MEDIA_DOCUMENT_BYTES, files: 1 },
    }),
  )
  async reply(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: ReplyConversationDto,
    @UploadedFile()
    file?: { buffer: Buffer; mimetype: string; originalname: string },
  ): Promise<ApiResponse<ReplyResult>> {
    const replyToId =
      body.reply_to_message_id != null && body.reply_to_message_id !== ''
        ? Number(body.reply_to_message_id)
        : undefined;
    const data = await this.conversationsService.reply(
      user,
      id,
      body.message ?? '',
      file,
      Number.isInteger(replyToId) && replyToId! > 0 ? replyToId : undefined,
    );
    return { ok: true, data };
  }

  @Patch(':id/assign')
  async assign(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: AssignConversationDto,
  ): Promise<ApiResponse<AssignConversationResult>> {
    const raw = body.assigned_user_id;
    const assignedUserId =
      raw === null || raw === undefined ? null : Number(raw);
    const data = await this.conversationsService.assignConversation(
      user,
      id,
      assignedUserId,
    );
    return { ok: true, data };
  }

  @Patch(':id/mode')
  async updateMode(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateConversationModeDto,
  ): Promise<ApiResponse<UpdateConversationModeResult>> {
    const data = await this.conversationsService.updateMode(
      user,
      id,
      body.status,
    );
    return { ok: true, data };
  }

  @Post(':id/mark-unread')
  async markUnread(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ApiResponse<{ ok: true }>> {
    const data = await this.conversationsService.markUnread(user, id);
    return { ok: true, data };
  }

  @Post(':id/lead-score')
  async leadScore(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: LeadScoreDto,
  ): Promise<ApiResponse<{ lead_score: number | null }>> {
    const clear = String(body.lead_score_clear ?? '').trim() === '1';
    const data = await this.conversationsService.setLeadScore(
      user,
      id,
      clear,
      body.lead_score,
    );
    return { ok: true, data };
  }

  @Get(':id/export')
  async exportConversation(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, filename } =
      await this.conversationsService.exportConversation(user, id);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  @Post(':id/messages/:messageId/react')
  async reactToMessage(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('messageId', ParseIntPipe) messageId: number,
    @Body() body: MessageReactionDto,
  ): Promise<ApiResponse<MessageReactionResult>> {
    const data = await this.conversationsService.reactToMessage(
      user,
      id,
      messageId,
      body.emoji,
    );
    return { ok: true, data };
  }

  @Get(':id/messages/:messageId/download')
  async downloadMessageMedia(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('messageId', ParseIntPipe) messageId: number,
    @Res() res: Response,
  ): Promise<void> {
    await this.conversationsService.downloadMessageMedia(
      user,
      id,
      messageId,
      res,
    );
  }

  @Get(':id/updates')
  async updates(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Query('after_message_id') afterMessageId?: string,
    @Query('after_audit_id') afterAuditId?: string,
  ): Promise<ApiResponse<InboxConversationUpdates>> {
    const afterId = Number(afterMessageId ?? 0) || 0;
    const auditAfter = BigInt(afterAuditId ?? 0) || BigInt(0);
    const data = await this.conversationsService.getUpdates(
      user,
      id,
      afterId,
      auditAfter,
    );
    return { ok: true, data };
  }

  @Get(':id')
  async detail(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ApiResponse<InboxDetail>> {
    const data = await this.conversationsService.getDetail(user, id);
    return { ok: true, data };
  }
}
