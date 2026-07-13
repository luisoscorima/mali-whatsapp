import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProvisionedGuard } from '../auth/guards/provisioned.guard';
import type { ApiResponse, AuthUser } from '../auth/auth.types';
import { assertCanManageAnuncios } from '../auth/permission.util';
import type { MetaCtwaAdDetail, MetaCtwaAdLead, MetaCtwaAdListItem } from './meta-ads.types';
import { UpdateMetaAdDto } from './dto/update-meta-ad.dto';
import { MetaAdsService } from './meta-ads.service';

@Controller('meta-ads')
@UseGuards(JwtAuthGuard, ProvisionedGuard)
export class MetaAdsController {
  constructor(private readonly metaAdsService: MetaAdsService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser): Promise<ApiResponse<MetaCtwaAdListItem[]>> {
    assertCanManageAnuncios(user);
    const data = await this.metaAdsService.list(user.area);
    return { ok: true, data };
  }

  @Get(':id')
  async detail(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ApiResponse<{ ad: MetaCtwaAdDetail; leads: MetaCtwaAdLead[] }>> {
    assertCanManageAnuncios(user);
    const data = await this.metaAdsService.getDetail(user.area, id);
    return { ok: true, data };
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateMetaAdDto,
  ): Promise<ApiResponse<MetaCtwaAdDetail>> {
    assertCanManageAnuncios(user);
    const data = await this.metaAdsService.updateDisplayName(
      user.area,
      id,
      body.display_name,
    );
    return { ok: true, data };
  }
}
