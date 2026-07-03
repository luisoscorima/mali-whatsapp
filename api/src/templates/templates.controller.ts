import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { ApiResponse, AuthUser } from '../auth/auth.types';
import { TemplatesService } from './templates.service';
import type {
  TemplateDetail,
  TemplateListItem,
  TemplateSyncResult,
} from './templates.types';

@Controller('templates')
@UseGuards(JwtAuthGuard)
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
  ): Promise<ApiResponse<TemplateListItem[]>> {
    const data = await this.templatesService.list(user.area);
    return { ok: true, data };
  }

  @Post('sync')
  async sync(
    @CurrentUser() user: AuthUser,
  ): Promise<ApiResponse<TemplateSyncResult>> {
    const data = await this.templatesService.sync(user.area);
    return { ok: true, data };
  }

  @Get(':id')
  async detail(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ApiResponse<TemplateDetail>> {
    const data = await this.templatesService.getById(user.area, id);
    return { ok: true, data };
  }
}
