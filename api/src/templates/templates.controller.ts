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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProvisionedGuard } from '../auth/guards/provisioned.guard';
import type { ApiResponse, AuthUser } from '../auth/auth.types';
import {
  CreateTemplateDto,
  UpdateTemplateDto,
  UpdateTemplateFlagsDto,
  ValidateTemplateDto,
} from './dto/template.dto';
import { TemplatesService } from './templates.service';
import type {
  TemplateCreateResult,
  TemplateDefinition,
  TemplateDetail,
  TemplateListItem,
  TemplateSyncResult,
  TemplateValidateResult,
} from './templates.types';

@Controller('templates')
@UseGuards(JwtAuthGuard, ProvisionedGuard)
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
    const data = await this.templatesService.sync(user);
    return { ok: true, data };
  }

  @Post('validate')
  async validate(
    @CurrentUser() user: AuthUser,
    @Body() body: ValidateTemplateDto,
  ): Promise<ApiResponse<TemplateValidateResult>> {
    const data = await this.templatesService.validateBuilder(user.area, body);
    return { ok: true, data };
  }

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body() body: CreateTemplateDto,
  ): Promise<ApiResponse<TemplateCreateResult>> {
    const data = await this.templatesService.create(user.area, user.id, body);
    return { ok: true, data };
  }

  @Get(':id/definition')
  async definition(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ApiResponse<TemplateDefinition>> {
    const data = await this.templatesService.getDefinition(user.area, id);
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

  @Patch(':id/flags')
  async updateFlags(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateTemplateFlagsDto,
  ): Promise<ApiResponse<TemplateDetail>> {
    const data = await this.templatesService.updateFlags(
      user.area,
      id,
      body,
    );
    return { ok: true, data };
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateTemplateDto,
  ): Promise<ApiResponse<TemplateCreateResult>> {
    const data = await this.templatesService.update(
      user.area,
      user.id,
      id,
      body,
    );
    return { ok: true, data };
  }
}
