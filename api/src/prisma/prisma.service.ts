import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PERF_SLOW_QUERY_MS, perfStore } from '../perf/perf-store';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly perfLogger = new Logger('PerfPrisma');

  constructor() {
    super({
      log: [{ emit: 'event', level: 'query' }],
    });
  }

  async onModuleInit(): Promise<void> {
    // Sin params: solo duración + fragmento de SQL (sin literales).
    // Cast: al extender PrismaClient, $on('query') tipa como never.
    (
      this as PrismaClient & {
        $on(
          event: 'query',
          cb: (e: { duration: number; query: string }) => void,
        ): void;
      }
    ).$on('query', (event) => {
      const durationMs = event.duration;
      if (durationMs < PERF_SLOW_QUERY_MS) return;
      perfStore.record('prisma_slow', durationMs);
      const sql = String(event.query || '')
        .replace(/'[^']*'/g, '?')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180);
      this.perfLogger.warn(
        JSON.stringify({
          msg: 'slow_query',
          durationMs,
          sql,
        }),
      );
    });
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
