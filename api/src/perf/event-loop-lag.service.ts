import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  PERF_EVENT_LOOP_INTERVAL_MS,
  PERF_SLOW_HTTP_MS,
  perfStore,
} from './perf-store';

@Injectable()
export class EventLoopLagService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventLoopLagService.name);
  private timer: NodeJS.Timeout | null = null;
  private expectedAt = 0;

  onModuleInit(): void {
    const interval = PERF_EVENT_LOOP_INTERVAL_MS;
    this.expectedAt = Date.now() + interval;
    this.timer = setInterval(() => {
      const now = Date.now();
      const lagMs = Math.max(0, now - this.expectedAt);
      this.expectedAt = now + interval;
      perfStore.record('event_loop_lag', lagMs);
      if (lagMs >= PERF_SLOW_HTTP_MS) {
        this.logger.warn(
          JSON.stringify({ msg: 'event_loop_lag', lagMs, intervalMs: interval }),
        );
      }
    }, interval);
    // No impedir apagado limpio
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
