import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EducationLeadWorkflowService } from './education-lead-workflow.service';
import { ProspectiaAdvisorService, type ProspectiaSubject } from './prospectia-advisor.service';

const LOOKUP_GAP_MS = 500;
const FINISHED_AT_KEY = 'prospectia_sync_finished_at';

function subjectKey(phone: string | null, username: string | null, userId: string | null): string {
  return `${phone ?? ''}|${username?.replace(/^@+/, '').toLowerCase() ?? ''}|${userId?.toLowerCase() ?? ''}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type ProspectiaSyncStatus = {
  running: boolean;
  processed: number;
  total: number;
  finished_at: string | null;
};

@Injectable()
export class ProspectiaSyncService implements OnModuleInit {
  private readonly logger = new Logger(ProspectiaSyncService.name);
  private current: Promise<void> | null = null;
  private processed = 0;
  private total = 0;
  private finishedAt: string | null = null;

  constructor(
    private readonly workflow: EducationLeadWorkflowService,
    private readonly prospectia: ProspectiaAdvisorService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const row = await this.prisma.app_settings.findUnique({
        where: { area_key: { area: 'educacion', key: FINISHED_AT_KEY } },
        select: { value: true },
      });
      this.finishedAt = row?.value || null;
      if (!this.finishedAt) {
        const latest = await this.workflow.prospectiaLatestCheckedAt();
        this.finishedAt = latest?.toISOString() ?? null;
      }
    } catch (error) {
      this.logger.warn(`No se pudo leer la última sincronización de Prospectia: ${error instanceof Error ? error.message : error}`);
    }
    this.start('pending');
  }

  status(): ProspectiaSyncStatus {
    return {
      running: this.current !== null,
      processed: this.processed,
      total: this.total,
      finished_at: this.finishedAt,
    };
  }

  start(mode: 'pending' | 'all'): { started: boolean } {
    if (this.current) return { started: false };
    this.current = this.run(mode).finally(() => { this.current = null; });
    return { started: true };
  }

  private async run(mode: 'pending' | 'all'): Promise<void> {
    const cache = new Map<string, { match: 'exists' | 'missing' | 'unverified'; advisorEmail: string | null }>();
    let lastLookupAt = 0;
    try {
      this.processed = 0;
      this.total = await this.workflow.prospectiaSyncCount(mode);
      let cursorId = 0;
      for (;;) {
        const entries = await this.workflow.prospectiaSyncBatch(mode, cursorId);
        if (!entries.length) break;
        if (mode === 'all') cursorId = entries[entries.length - 1].id;
        const groups = new Map<string, typeof entries>();
        for (const entry of entries) {
          const key = subjectKey(entry.phone, entry.username, entry.whatsappUserId);
          const group = groups.get(key) ?? [];
          group.push(entry);
          groups.set(key, group);
        }
        for (const [key, group] of groups) {
          let result = cache.get(key);
          if (!result) {
            const sample = group[0];
            const subject: ProspectiaSubject = {
              key, phone: sample.phone, username: sample.username, whatsapp_user_id: sample.whatsappUserId,
            };
            if (key !== '||') {
              const wait = LOOKUP_GAP_MS - (Date.now() - lastLookupAt);
              if (lastLookupAt && wait > 0) await sleep(wait);
              result = await this.prospectia.lookup(subject);
              lastLookupAt = Date.now();
            } else {
              result = { match: 'unverified', advisorEmail: null };
            }
            cache.set(key, result);
          }
          for (const entry of group) {
            await this.workflow.applyProspectiaSnapshot(
              entry.id, entry.contactId, entry.area, result,
            );
            this.processed += 1;
          }
        }
      }
      if (this.processed > 0) await this.rememberFinish();
    } catch (error) {
      this.logger.warn(`Sincronización Prospectia interrumpida: ${error instanceof Error ? error.message : error}`);
    }
  }

  private async rememberFinish(): Promise<void> {
    const value = new Date().toISOString();
    this.finishedAt = value;
    await this.prisma.app_settings.upsert({
      where: { area_key: { area: 'educacion', key: FINISHED_AT_KEY } },
      create: { area: 'educacion', key: FINISHED_AT_KEY, value },
      update: { value, updated_at: new Date() },
    });
  }
}
