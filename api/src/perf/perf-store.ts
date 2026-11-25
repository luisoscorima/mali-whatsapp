/**
 * Agregados in-memory para baseline p95 (single-instance).
 * Sin parámetros ni PII en logs.
 */

export type PerfBucket =
  | 'http'
  | 'auth'
  | 'prisma_slow'
  | 'event_loop_lag'
  | 'export'
  | 'ttfc';

type SampleRing = {
  values: number[];
  max: number;
  count: number;
  sum: number;
};

function envInt(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function newRing(max: number): SampleRing {
  return { values: [], max, count: 0, sum: 0 };
}

function pushSample(ring: SampleRing, value: number): void {
  if (!Number.isFinite(value) || value < 0) return;
  ring.count += 1;
  ring.sum += value;
  if (ring.values.length < ring.max) {
    ring.values.push(value);
    return;
  }
  // Reservoir sampling simple
  const idx = Math.floor(Math.random() * ring.count);
  if (idx < ring.max) ring.values[idx] = value;
}

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank] ?? null;
}

function summary(ring: SampleRing) {
  const sorted = [...ring.values].sort((a, b) => a - b);
  return {
    samples: ring.values.length,
    observed: ring.count,
    meanMs:
      ring.values.length > 0
        ? Math.round((ring.sum / Math.max(ring.count, 1)) * 100) / 100
        : null,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    p99Ms: percentile(sorted, 99),
    maxMs: sorted.length ? sorted[sorted.length - 1]! : null,
  };
}

const RING_SIZE = envInt('PERF_SAMPLE_RING', 500);

class PerfStore {
  private readonly rings = new Map<string, SampleRing>();
  private readonly exportMarks: Array<{
    kind: string;
    startedAt: string;
    endedAt: string;
    durationMs: number;
    rows?: number;
  }> = [];
  private readonly maxExportMarks = 40;

  record(bucket: PerfBucket | string, durationMs: number, label?: string): void {
    const key = label ? `${bucket}:${label}` : bucket;
    let ring = this.rings.get(key);
    if (!ring) {
      ring = newRing(RING_SIZE);
      this.rings.set(key, ring);
    }
    pushSample(ring, durationMs);
  }

  markExportStart(kind: string): { kind: string; t0: number } {
    return { kind, t0: Date.now() };
  }

  markExportEnd(
    handle: { kind: string; t0: number },
    opts?: { rows?: number },
  ): number {
    const durationMs = Date.now() - handle.t0;
    const entry = {
      kind: handle.kind,
      startedAt: new Date(handle.t0).toISOString(),
      endedAt: new Date().toISOString(),
      durationMs,
      ...(opts?.rows != null ? { rows: opts.rows } : {}),
    };
    this.exportMarks.push(entry);
    if (this.exportMarks.length > this.maxExportMarks) {
      this.exportMarks.splice(0, this.exportMarks.length - this.maxExportMarks);
    }
    this.record('export', durationMs, handle.kind);
    return durationMs;
  }

  snapshot() {
    const buckets: Record<string, ReturnType<typeof summary>> = {};
    for (const [key, ring] of this.rings) {
      buckets[key] = summary(ring);
    }
    return {
      at: new Date().toISOString(),
      buckets,
      recentExports: [...this.exportMarks],
    };
  }
}

export const perfStore = new PerfStore();

export const PERF_SLOW_HTTP_MS = envInt('PERF_SLOW_HTTP_MS', 500);
export const PERF_SLOW_QUERY_MS = envInt('PERF_SLOW_QUERY_MS', 200);
export const PERF_HTTP_SAMPLE_RATE = Math.min(
  1,
  Math.max(0, Number(process.env.PERF_HTTP_SAMPLE_RATE ?? '1') || 0),
);
export const PERF_EVENT_LOOP_INTERVAL_MS = envInt(
  'PERF_EVENT_LOOP_INTERVAL_MS',
  5000,
);
