import { Logger } from '@nestjs/common';
import { perfStore } from './perf-store';

const logger = new Logger('PerfExport');

/** Envuelve generación XLSX/export: marca start/end para correlacionar con event-loop lag. */
export async function withExportTiming<T>(
  kind: string,
  run: () => Promise<T>,
  rowsOf?: (result: T) => number | undefined,
): Promise<T> {
  const handle = perfStore.markExportStart(kind);
  logger.log(JSON.stringify({ msg: 'export_start', kind }));
  try {
    const result = await run();
    const rows = rowsOf?.(result);
    const durationMs = perfStore.markExportEnd(handle, {
      ...(rows != null ? { rows } : {}),
    });
    logger.log(
      JSON.stringify({
        msg: 'export_end',
        kind,
        durationMs,
        rows: rows ?? null,
      }),
    );
    return result;
  } catch (err) {
    const durationMs = perfStore.markExportEnd(handle);
    logger.warn(
      JSON.stringify({
        msg: 'export_failed',
        kind,
        durationMs,
      }),
    );
    throw err;
  }
}
