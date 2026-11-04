import * as XLSX from 'xlsx';
import type { PrismaClient } from '@prisma/client';
import { exportFilenameDateStamp } from '../campaigns/campaign-format.util';
import { programScopeWhere } from '../config/category-scope';
import { formatAdvisorLabel } from '../users/advisor-label.util';
import { loadEducationSlaConfig } from '../leads/education-sla-config.loader';
import { scheduleToDays } from '../leads/education-sla-config.util';
import {
  firstResponseBusinessMinutes,
  isSlaMet,
  roundMinutes,
} from '../leads/education-lead-sla.util';
import { resolveReportDateRange } from './report-date-range.util';

const DAY_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

export type EducationSlaAdvisorRow = {
  assigned_user_id: number | null;
  advisor_label: string;
  answered_count: number;
  met_count: number;
  sla_met_pct: number;
  avg_first_response_minutes: number;
};

export type EducationSlaReportResult = {
  summary: {
    answered_count: number;
    met_count: number;
    sla_met_pct: number;
    avg_first_response_minutes: number;
    unanswered_open_count: number;
    sla_minutes: number;
  };
  by_advisor: EducationSlaAdvisorRow[];
  area_label: string;
  filters: { from: string; to: string; category: string[] | null };
  note: string;
};

/** Lima 00:00 of YMD → UTC instant (Peru UTC−5). */
function limaDayStartUtc(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 5, 0, 0, 0));
}

function limaDayEndExclusiveUtc(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1, 5, 0, 0, 0));
}

function pct(met: number, answered: number): number {
  if (!answered) return 0;
  return roundMinutes((met / answered) * 100, 1);
}

function avg(minutes: number[]): number {
  if (!minutes.length) return 0;
  return roundMinutes(
    minutes.reduce((sum, n) => sum + n, 0) / minutes.length,
    1,
  );
}

export async function fetchEducationSlaReport(
  prisma: PrismaClient,
  opts: {
    from?: string;
    to?: string;
    categories?: string[] | null;
  },
): Promise<EducationSlaReportResult> {
  const { from, to } = resolveReportDateRange(opts.from, opts.to);
  const gte = limaDayStartUtc(from);
  const lt = limaDayEndExclusiveUtc(to);
  const programFilter = programScopeWhere(opts.categories ?? null);
  const slaConfig = await loadEducationSlaConfig(prisma);

  const cycles = await prisma.education_lead_cycles.findMany({
    where: {
      area: 'educacion',
      started_at: { gte, lt },
      ...programFilter,
    },
    select: {
      id: true,
      started_at: true,
      first_human_reply_at: true,
      closed_at: true,
      assigned_user_id: true,
      assigned_user: {
        select: {
          id: true,
          first_name: true,
          last_name: true,
          email: true,
        },
      },
    },
  });

  type Bucket = {
    assigned_user_id: number | null;
    advisor_label: string;
    minutes: number[];
    met: number;
  };

  const buckets = new Map<string, Bucket>();
  const allMinutes: number[] = [];
  let metTotal = 0;
  let unansweredOpen = 0;

  for (const cycle of cycles) {
    if (!cycle.first_human_reply_at) {
      if (!cycle.closed_at) unansweredOpen += 1;
      continue;
    }
    const minutes = firstResponseBusinessMinutes(
      cycle.started_at,
      cycle.first_human_reply_at,
      slaConfig,
    );
    const met = isSlaMet(
      cycle.started_at,
      cycle.first_human_reply_at,
      slaConfig,
    );
    allMinutes.push(minutes);
    if (met) metTotal += 1;

    const key =
      cycle.assigned_user_id != null ? String(cycle.assigned_user_id) : 'none';
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        assigned_user_id: cycle.assigned_user_id,
        advisor_label: cycle.assigned_user
          ? formatAdvisorLabel(cycle.assigned_user)
          : 'Sin asignar',
        minutes: [],
        met: 0,
      };
      buckets.set(key, bucket);
    }
    bucket.minutes.push(minutes);
    if (met) bucket.met += 1;
  }

  const by_advisor: EducationSlaAdvisorRow[] = [...buckets.values()]
    .map((bucket) => ({
      assigned_user_id: bucket.assigned_user_id,
      advisor_label: bucket.advisor_label,
      answered_count: bucket.minutes.length,
      met_count: bucket.met,
      sla_met_pct: pct(bucket.met, bucket.minutes.length),
      avg_first_response_minutes: avg(bucket.minutes),
    }))
    .sort((a, b) => a.advisor_label.localeCompare(b.advisor_label, 'es'));

  return {
    summary: {
      answered_count: allMinutes.length,
      met_count: metTotal,
      sla_met_pct: pct(metTotal, allMinutes.length),
      avg_first_response_minutes: avg(allMinutes),
      unanswered_open_count: unansweredOpen,
      sla_minutes: slaConfig.target_minutes,
    },
    by_advisor,
    area_label: 'Educación',
    filters: {
      from,
      to,
      category: opts.categories ?? null,
    },
    note: (() => {
      const days = scheduleToDays(slaConfig.schedule)
        .map((d) => `${DAY_SHORT[d.day]} ${d.from}–${d.to}`)
        .join(', ');
      return `Promedio y % sobre ciclos con primera respuesta humana. Minutos hábiles ${slaConfig.timezone} (${days}). Meta ${slaConfig.target_minutes} min.`;
    })(),
  };
}

export function buildEducationSlaXlsxBuffer(
  result: EducationSlaReportResult,
): Buffer {
  const summaryAoa: (string | number)[][] = [
    ['Métrica', 'Valor'],
    ['Promedio 1.ª respuesta (min)', result.summary.avg_first_response_minutes],
    ['% dentro de SLA', result.summary.sla_met_pct],
    ['Respondidos', result.summary.answered_count],
    ['Dentro de SLA', result.summary.met_count],
    ['Abiertos sin respuesta', result.summary.unanswered_open_count],
    ['Meta (min)', result.summary.sla_minutes],
    ['Desde', result.filters.from],
    ['Hasta', result.filters.to],
  ];
  const advisorAoa: (string | number)[][] = [
    [
      'Asesor',
      'Respondidos',
      'Dentro de SLA',
      '% SLA',
      'Promedio min',
    ],
    ...result.by_advisor.map((row) => [
      row.advisor_label,
      row.answered_count,
      row.met_count,
      row.sla_met_pct,
      row.avg_first_response_minutes,
    ]),
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(summaryAoa),
    'Resumen',
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(advisorAoa),
    'Por asesor',
  );
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export function educationSlaExportFilename(): string {
  return `sla-primera-respuesta-${exportFilenameDateStamp()}.xlsx`;
}
