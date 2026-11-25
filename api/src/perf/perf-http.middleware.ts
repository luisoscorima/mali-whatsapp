import type { NextFunction, Request, Response } from 'express';
import { Logger } from '@nestjs/common';
import {
  PERF_HTTP_SAMPLE_RATE,
  PERF_SLOW_HTTP_MS,
  perfStore,
} from './perf-store';

const logger = new Logger('PerfHttp');

export type PerfRequest = Request & {
  perfAuthMs?: number;
  user?: { id?: number };
};

function normalizePath(url: string): string {
  const pathOnly = url.split('?')[0] || '/';
  return pathOnly
    .replace(/\/\d+/g, '/:id')
    .replace(
      /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      '/:uuid',
    );
}

/** Middleware Express: tiempo total (incluye guards). Auth se anota en req.perfAuthMs. */
export function perfHttpMiddleware(
  req: PerfRequest,
  res: Response,
  next: NextFunction,
): void {
  const t0 = Date.now();
  res.on('finish', () => {
    const durationMs = Date.now() - t0;
    const path = normalizePath(req.originalUrl || req.url || '/');
    const authMs = req.perfAuthMs;
    const sample = PERF_HTTP_SAMPLE_RATE >= 1 || Math.random() < PERF_HTTP_SAMPLE_RATE;

    if (sample) {
      perfStore.record('http', durationMs, `${req.method} ${path}`);
    }

    if (durationMs >= PERF_SLOW_HTTP_MS || (authMs != null && authMs >= PERF_SLOW_HTTP_MS)) {
      logger.warn(
        JSON.stringify({
          msg: 'slow_http',
          method: req.method,
          path,
          status: res.statusCode,
          durationMs,
          authDurationMs: authMs ?? null,
          userId: req.user?.id ?? null,
        }),
      );
    }
  });
  next();
}
