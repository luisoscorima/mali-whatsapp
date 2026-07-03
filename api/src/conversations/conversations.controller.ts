import {
  Body,
  Controller,
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
} from './conversations.types';
import {
  ReplyConversationDto,
  UpdateConversationModeDto,
} from './dto/conversations.dto';

@Controller('conversations')
@UseGuards(JwtAuthGuard)
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query() query: Record<string, string | string[] | undefined>,
  ): Promise<ApiResponse<InboxListResult>> {
    const data = await this.conversationsService.list(user, query);
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
    const data = await this.conversationsService.reply(
      user,
      id,
      body.message ?? '',
      file,
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

  @Get(':id/updates')
  async updates(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Query('after_message_id') afterMessageId?: string,
  ): Promise<ApiResponse<InboxConversationUpdates>> {
    const afterId = Number(afterMessageId ?? 0) || 0;
    const data = await this.conversationsService.getUpdates(user, id, afterId);
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
