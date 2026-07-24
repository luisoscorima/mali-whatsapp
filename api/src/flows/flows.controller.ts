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
import { CreateFlowDto, UpdateFlowDto } from './dto/flow.dto';
import { FlowsService } from './flows.service';
import type { FlowDetail, FlowListItem } from './flows.types';

@Controller('flows')
@UseGuards(JwtAuthGuard, ProvisionedGuard)
export class FlowsController {
  constructor(private readonly flowsService: FlowsService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
  ): Promise<ApiResponse<FlowListItem[]>> {
    const data = await this.flowsService.list(user.area);
    return { ok: true, data };
  }

  @Get('advisors')
  async advisors(
    @CurrentUser() user: AuthUser,
  ): Promise<ApiResponse<{ id: number; label: string }[]>> {
    const data = await this.flowsService.listAdvisors(user.area);
    return { ok: true, data };
  }

  @Get(':id')
  async detail(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ApiResponse<FlowDetail>> {
    const data = await this.flowsService.getDetail(user.area, id);
    return { ok: true, data };
  }

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body() body: CreateFlowDto,
  ): Promise<ApiResponse<FlowDetail>> {
    const data = await this.flowsService.create(user.area, body);
    return { ok: true, data };
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateFlowDto,
  ): Promise<ApiResponse<FlowDetail>> {
    const data = await this.flowsService.update(user.area, id, body);
    return { ok: true, data };
  }

  @Delete(':id')
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ApiResponse<{ deleted: true }>> {
    await this.flowsService.remove(user.area, id);
    return { ok: true, data: { deleted: true } };
  }
}
