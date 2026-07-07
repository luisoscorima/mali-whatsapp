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
import { AttributeDefinitionsService } from './attribute-definitions.service';
import type { AttributeDefinition } from './attribute-definitions.types';
import {
  CreateAttributeDefinitionDto,
  UpdateAttributeDefinitionDto,
} from './dto/attribute-definition.dto';
import { ReorderAttributeDefinitionsDto } from './dto/reorder-attribute-definitions.dto';

@Controller('attribute-definitions')
@UseGuards(JwtAuthGuard, ProvisionedGuard)
export class AttributeDefinitionsController {
  constructor(private readonly service: AttributeDefinitionsService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
  ): Promise<ApiResponse<AttributeDefinition[]>> {
    const data = await this.service.listAll(user.area);
    return { ok: true, data };
  }

  @Get('segments')
  async segments(@CurrentUser() user: AuthUser) {
    const data = await this.service.listSegments(user.area);
    return { ok: true, data };
  }

  @Patch('reorder')
  async reorder(
    @CurrentUser() user: AuthUser,
    @Body() body: ReorderAttributeDefinitionsDto,
  ): Promise<ApiResponse<{ ok: true }>> {
    await this.service.reorder(user.area, body.orderedIds);
    return { ok: true, data: { ok: true } };
  }

  @Get(':id')
  async getOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ApiResponse<AttributeDefinition>> {
    const data = await this.service.getById(user.area, id);
    return { ok: true, data };
  }

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body() body: CreateAttributeDefinitionDto,
  ): Promise<ApiResponse<AttributeDefinition>> {
    const data = await this.service.create(user.area, body);
    return { ok: true, data };
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateAttributeDefinitionDto,
  ): Promise<ApiResponse<AttributeDefinition>> {
    const data = await this.service.update(user.area, id, body);
    return { ok: true, data };
  }

  @Delete(':id')
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ApiResponse<{ deleted: true }>> {
    await this.service.remove(user.area, id);
    return { ok: true, data: { deleted: true } };
  }
}
