import {
  Body,
  Controller,
  Get,
  Logger,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProvisionedGuard } from '../auth/guards/provisioned.guard';
import { MasterGuard } from '../admin/guards/master.guard';
import { perfStore } from './perf-store';

@Controller('perf')
export class PerfController {
  private readonly logger = new Logger(PerfController.name);

  /** Baseline agregada (master). */
  @Get('snapshot')
  @UseGuards(JwtAuthGuard, MasterGuard)
  snapshot() {
    return perfStore.snapshot();
  }

  /**
   * Métrica de navegador: time-to-first-conversations (y similares).
   * Sin PII; solo duración y flags.
   */
  @Post('client-timing')
  @UseGuards(JwtAuthGuard, ProvisionedGuard)
  clientTiming(
    @Body()
    body: {
      metric?: string;
      durationMs?: number;
      cold?: boolean;
      navType?: string;
      path?: string;
    },
  ) {
    const metric = String(body?.metric || 'ttfc').slice(0, 64);
    const durationMs = Number(body?.durationMs);
    if (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > 600_000) {
      return { ok: false };
    }
    const cold = Boolean(body?.cold);
    const navType = String(body?.navType || 'unknown').slice(0, 16);
    const path = String(body?.path || '/').slice(0, 128);

    perfStore.record('ttfc', durationMs, cold ? 'cold' : 'warm');
    this.logger.log(
      JSON.stringify({
        msg: 'client_timing',
        metric,
        durationMs: Math.round(durationMs),
        cold,
        navType,
        path,
      }),
    );
    return { ok: true };
  }
}
