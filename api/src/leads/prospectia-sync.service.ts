import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EducationLeadWorkflowService } from './education-lead-workflow.service';
import { ProspectiaAdvisorService, type ProspectiaSubject } from './prospectia-advisor.service';

function subjectKey(phone: string | null, username: string | null, userId: string | null): string {
  return `${phone ?? ''}|${username?.replace(/^@+/, '').toLowerCase() ?? ''}|${userId?.toLowerCase() ?? ''}`;
}

@Injectable()
export class ProspectiaSyncService implements OnModuleInit {
  private readonly logger = new Logger(ProspectiaSyncService.name);
  private current: Promise<void> | null = null;

  constructor(
    private readonly workflow: EducationLeadWorkflowService,
    private readonly prospectia: ProspectiaAdvisorService,
  ) {}

  onModuleInit(): void {
    this.start('pending');
  }

  get running(): boolean {
    return this.current !== null;
  }

  start(mode: 'pending' | 'all'): { started: boolean } {
    if (this.current) return { started: false };
    this.current = this.run(mode).finally(() => { this.current = null; });
    return { started: true };
  }

  private async run(mode: 'pending' | 'all'): Promise<void> {
    const cache = new Map<string, { match: 'exists' | 'missing' | 'unverified'; advisorEmail: string | null }>();
    try {
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
            result = key === '||'
              ? { match: 'unverified', advisorEmail: null }
              : await this.prospectia.lookup(subject);
            cache.set(key, result);
          }
          for (const entry of group) {
            await this.workflow.applyProspectiaSnapshot(
              entry.id, entry.contactId, entry.area, result,
            );
          }
        }
      }
    } catch (error) {
      this.logger.warn(`Sincronización Prospectia interrumpida: ${error instanceof Error ? error.message : error}`);
    }
  }
}
