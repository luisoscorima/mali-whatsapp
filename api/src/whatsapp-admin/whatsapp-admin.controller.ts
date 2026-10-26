import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { ApiResponse, AuthUser } from '../auth/auth.types';
import { WhatsAppAdminAccessGuard } from './whatsapp-admin-access.guard';
import { WhatsAppAdminService } from './whatsapp-admin.service';
import {
  CreateWhatsAppLineDto,
  CreateWhatsAppWabaDto,
  RotateWhatsAppTokenDto,
  UpdateWhatsAppLineDto,
  UpdateWhatsAppWabaDto,
} from './dto/whatsapp-admin.dto';

@Controller('admin/whatsapp')
@UseGuards(WhatsAppAdminAccessGuard)
export class WhatsAppAdminController {
  constructor(private readonly whatsappAdmin: WhatsAppAdminService) {}

  @Get()
  async overview(): Promise<ApiResponse<unknown>> {
    return { ok: true, data: await this.whatsappAdmin.overview() };
  }

  @Post('wabas')
  async createWaba(
    @Body() body: CreateWhatsAppWabaDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ApiResponse<unknown>> {
    return {
      ok: true,
      data: await this.whatsappAdmin.createWaba(body, user),
    };
  }

  @Patch('wabas/:id')
  async updateWaba(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateWhatsAppWabaDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ApiResponse<unknown>> {
    return {
      ok: true,
      data: await this.whatsappAdmin.updateWaba(id, body, user),
    };
  }

  @Post('wabas/:id/validate')
  async validateWaba(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
  ): Promise<ApiResponse<unknown>> {
    return {
      ok: true,
      data: await this.whatsappAdmin.validateWaba(id, user),
    };
  }

  @Post('lines')
  async createLine(
    @Body() body: CreateWhatsAppLineDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ApiResponse<unknown>> {
    return {
      ok: true,
      data: await this.whatsappAdmin.createLine(body, user),
    };
  }

  @Post('wabas/:id/token')
  async rotateWabaToken(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: RotateWhatsAppTokenDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ApiResponse<unknown>> {
    return {
      ok: true,
      data: await this.whatsappAdmin.rotateWabaToken(id, body, user),
    };
  }

  @Post('lines/:id/token')
  async rotateLineToken(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: RotateWhatsAppTokenDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ApiResponse<unknown>> {
    return {
      ok: true,
      data: await this.whatsappAdmin.rotateLineToken(id, body, user),
    };
  }

  @Patch('lines/:id')
  async updateLine(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateWhatsAppLineDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ApiResponse<unknown>> {
    return {
      ok: true,
      data: await this.whatsappAdmin.updateLine(id, body, user),
    };
  }

  @Post('lines/:id/validate')
  async validateLine(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
  ): Promise<ApiResponse<unknown>> {
    return {
      ok: true,
      data: await this.whatsappAdmin.validateLine(id, user),
    };
  }

  @Post('lines/:id/activate')
  async activateLine(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
  ): Promise<ApiResponse<unknown>> {
    return {
      ok: true,
      data: await this.whatsappAdmin.activateLine(id, user),
    };
  }

  @Post('lines/:id/deactivate')
  async deactivateLine(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
  ): Promise<ApiResponse<unknown>> {
    return {
      ok: true,
      data: await this.whatsappAdmin.deactivateLine(id, user),
    };
  }
}
