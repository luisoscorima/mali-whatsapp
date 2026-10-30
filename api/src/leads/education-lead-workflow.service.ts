import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import {
  classifyEducationIntake,
  EDUCATION_LEAD_WINDOW_MS,
  isTerminalEducationStatusSlug,
} from './education-lead-classification.util';
import {
  ATTENTION_V1_SETTING_KEY,
  categorySlugOfCycle,
  exactCategoryCycleWhere,
  exactOpenCycleWhere,
  inactivityDeadlineFrom,
  isCommercialLeadChannel,
  isEducationAttentionArea,
} from './education-lead-context.util';
import { syncEducationLeadStatuses } from './education-lead-statuses';
import { educationManagementArea, educationProgramOf } from '../config/education-scope';
import { userWorksArea } from '../users/area-membership.where';
import { ProspectiaAdvisorService } from './prospectia-advisor.service';
import { endLeadConversationLinks, projectLeadAssignee, withLeadCreateSavepoint } from './education-lead-lifecycle.util';
import { cursoFromOriginPayload } from './lead-curso.util';
import { formatAdvisorLabel } from '../users/advisor-label.util';

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
  );
}

const EDUCATION_AREAS = ['educacion', 'educacion_ca', 'educacion_ep'];
const SIXTY_DAYS_MS = EDUCATION_LEAD_WINDOW_MS;
const INBOUND_SESSION_MS = 24 * 60 * 60 * 1000;

function educationAreasOf(user: {
  area: string;
  user_areas: { area: string }[];
  memberships: {
    access_mode: string;
    include_general?: boolean;
    business_area: { slug: string };
    programs: { program: { slug: string; active: boolean } }[];
  }[];
}): string[] {
  const fromMembership = user.memberships.flatMap((membership) => {
    if (membership.business_area.slug !== 'educacion') return [];
    const granted = membership.programs
      .filter((grant) => grant.program.active)
      .map((grant) => grant.program.slug === 'ca'
        ? 'educacion_ca'
        : grant.program.slug === 'ep' ? 'educacion_ep' : grant.program.slug);
    if (membership.include_general) granted.unshift('educacion');
    if (membership.access_mode === 'all' && granted.length === 0) return [...EDUCATION_AREAS];
    return granted;
  });
  return [...new Set([user.area, ...user.user_areas.map((item) => item.area), ...fromMembership])]
    .filter((area) => EDUCATION_AREAS.includes(area) || /^[a-z][a-z0-9_]{0,9}$/.test(area));
}

@Injectable()
export class EducationLeadWorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly prospectia?: ProspectiaAdvisorService,
  ) {}

  private areas(area?: string): string[] {
    return this.leadScope(area).areas;
  }

  private leadScope(area?: string): { areas: string[]; program: string | null; onlyGeneral: boolean } {
    const selected = String(area ?? 'all').trim().toLowerCase() || 'all';
    if (selected === 'all') return { areas: [...EDUCATION_AREAS], program: null, onlyGeneral: false };
    if (selected === 'educacion') return { areas: ['educacion'], program: null, onlyGeneral: true };
    const program = educationProgramOf(selected);
    if (program) return { areas: [...EDUCATION_AREAS], program, onlyGeneral: false };
    throw new BadRequestException('Área de educación inválida');
  }

  private programOrLegacyFilter(program: string): Prisma.education_lead_entriesWhereInput {
    return {
      OR: [
        { program: { is: { slug: program } } },
        ...(program === 'ca' ? [{ program_id: null, area: 'educacion_ca' }] : []),
        ...(program === 'ep' ? [{ program_id: null, area: 'educacion_ep' }] : []),
      ],
    };
  }

  private programOrLegacyCycleFilter(program: string): Prisma.education_lead_cyclesWhereInput {
    return {
      OR: [
        { program: { is: { slug: program } } },
        ...(program === 'ca' ? [{ program_id: null, area: 'educacion_ca' as const }] : []),
        ...(program === 'ep' ? [{ program_id: null, area: 'educacion_ep' as const }] : []),
      ],
    };
  }

  async isAttentionV1Enabled(): Promise<boolean> {
    const row = await this.prisma.app_settings.findUnique({
      where: { area_key: { area: 'educacion', key: ATTENTION_V1_SETTING_KEY } },
      select: { value: true },
    });
    const value = String(row?.value ?? '').trim().toLowerCase();
    return value === '1' || value === 'true' || value === 'on';
  }

  /** Area + category (+ optional WhatsApp line) must match the caller's business access. */
  assertCanAccessLeadContext(
    user: AuthUser,
    cycle: {
      area: string;
      program_id?: number | null;
      program?: { slug?: string | null } | null;
    },
    lineId?: number | null,
  ): void {
    if (user.isMaster) return;
    const allowedAreas = new Set<string>([
      user.area,
      ...(user.allowedAreas ?? []),
    ]);
    if (!allowedAreas.has(cycle.area)) {
      throw new ForbiddenException('No autorizado para el área de este lead');
    }
    const access = user.businessAccess;
    if (access?.mode === 'restricted') {
      const category = categorySlugOfCycle(cycle);
      if (access.categorySlugs && !access.categorySlugs.includes(category)) {
        throw new ForbiddenException('No autorizado para esta categoría');
      }
      if (
        lineId != null &&
        access.lineIds.length > 0 &&
        !access.lineIds.includes(lineId)
      ) {
        throw new ForbiddenException('No autorizado para esta línea');
      }
    }
  }

  async recordOrigin(originId: number): Promise<void> {
    const origin = await this.prisma.contact_origins.findUnique({ where: { id: originId } });
    if (!origin || !origin.contact_id || !EDUCATION_AREAS.includes(origin.area)) return;
    await this.recordEntry({
      area: origin.area, contactId: origin.contact_id, originId,
      channel: origin.channel, sourceKey: origin.source_key, sourceLabel: origin.source_label,
      eventKey: `origin:${origin.id}`, occurredAt: origin.first_seen_at,
      programId: origin.program_id,
    });
  }

  async recordInbound(input: {
    area: string; contactId: number | null; conversationId: number; messageId: number;
    originId?: number | null; occurredAt: Date;
    channel?: string; sourceKey?: string | null; sourceLabel?: string | null;
  }): Promise<void> {
    if (!input.contactId || !EDUCATION_AREAS.includes(input.area)) return;
    const conversation = await this.prisma.conversations.findUnique({
      where: { id: input.conversationId },
      select: { whatsapp_line: { select: { program_id: true } } },
    });
    const programId = conversation?.whatsapp_line?.program_id ?? null;
    const contact = await this.prisma.contacts.findUnique({
      where: { id: input.contactId },
      select: { person_id: true },
    });
    if (!contact) return;
    const channel = input.channel ?? 'organic_wa';
    const openWhere = exactOpenCycleWhere({
      personId: contact.person_id,
      area: input.area,
      programId,
    });
    const historyWhere = exactCategoryCycleWhere({
      personId: contact.person_id,
      area: input.area,
      programId,
    });
    const latestEntry = await this.prisma.education_lead_entries.findFirst({
      where: {
        contact_id: input.contactId,
        ...(programId != null
          ? {
              OR: [
                { program_id: programId },
                ...(input.area === 'educacion_ca' || input.area === 'educacion_ep'
                  ? [{ program_id: null, area: input.area }]
                  : []),
              ],
            }
          : { program_id: null }),
      },
      orderBy: [{ occurred_at: 'desc' }, { id: 'desc' }],
      select: { occurred_at: true, classification: true },
    });
    const openCycle = await this.prisma.education_lead_cycles.findFirst({
      where: openWhere,
      orderBy: [{ started_at: 'desc' }, { id: 'desc' }],
      include: { lead_status: { select: { slug: true, is_terminal: true } } },
    });
    const historicalCycle = openCycle
      ? null
      : await this.prisma.education_lead_cycles.findFirst({
          where: historyWhere,
          orderBy: [{ started_at: 'desc' }, { id: 'desc' }],
          include: { lead_status: { select: { slug: true, is_terminal: true } } },
        });
    const previousClosed =
      !openCycle &&
      Boolean(historicalCycle) &&
      (Boolean(historicalCycle?.closed_at) ||
        Boolean(historicalCycle?.lead_status?.is_terminal) ||
        isTerminalEducationStatusSlug(historicalCycle?.lead_status?.slug));
    // Ambiguous/organic after close: keep chat; only explicit commercial channels reopen.
    if (previousClosed && !isCommercialLeadChannel(channel)) {
      if (historicalCycle && !historicalCycle.closed_at) {
        await this.prisma.$transaction(async (tx) => {
          await tx.education_lead_cycles.update({
            where: { id: historicalCycle.id },
            data: {
              closed_at: input.occurredAt,
              close_reason: historicalCycle.close_reason ?? 'terminal_status',
              updated_at: new Date(),
            },
          });
          await endLeadConversationLinks(tx, historicalCycle.id, input.occurredAt);
        });
      }
      return;
    }
    const previousInbound = await this.prisma.chat_messages.findFirst({
      where: { conversation_id: input.conversationId, direction: 'inbound',
        id: { lt: input.messageId } },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      select: { created_at: true },
    });
    // One inbound session is one capture. Further messages still move the 60-day clock.
    const sameSession = Boolean(previousInbound &&
      input.occurredAt.getTime() - previousInbound.created_at.getTime() < INBOUND_SESSION_MS);
    const sameCapture = Boolean(latestEntry &&
      input.occurredAt.getTime() - latestEntry.occurred_at.getTime() < INBOUND_SESSION_MS);
    if (sameSession || sameCapture) {
      if (latestEntry?.classification !== 'conflict' && openCycle &&
          input.occurredAt > openCycle.last_interaction_at) {
        await this.prisma.education_lead_cycles.update({
          where: { id: openCycle.id },
          data: {
            last_interaction_at: input.occurredAt,
            inactivity_deadline_at: inactivityDeadlineFrom(input.occurredAt),
            first_inbound_at: openCycle.first_inbound_at ?? input.occurredAt,
            updated_at: new Date(),
          },
        });
      }
      if (openCycle) {
        await this.linkConversation(openCycle.id, input.conversationId);
      }
      return;
    }
    await this.recordEntry({
      area: input.area, contactId: input.contactId, originId: input.originId ?? null,
      channel,
      sourceKey: input.sourceKey ?? null,
      sourceLabel: input.sourceLabel ?? 'WhatsApp orgánico',
      eventKey: `inbound:${input.messageId}`, occurredAt: input.occurredAt,
      programId,
      conversationId: input.conversationId,
    });
  }

  private async recordEntry(input: {
    area: string; contactId: number; originId: number | null;
    channel: string; sourceKey: string | null; sourceLabel: string | null;
    eventKey: string; occurredAt: Date; programId?: number | null;
    conversationId?: number | null;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const contact = await tx.contacts.findUnique({
        where: { id: input.contactId },
        select: {
          person_id: true, business_area_id: true,
          lead_status_id: true, lead_score: true,
        },
      });
      if (!contact) return null;
      const programKey = input.programId ?? 0;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${contact.person_id}::integer, ${programKey}::integer)`;
      const existing = await tx.education_lead_entries.findUnique({
        where: { area_event_key: { area: input.area, event_key: input.eventKey } },
      });
      if (existing) return null;
      const previous = await tx.education_lead_cycles.findFirst({
        where: {
          ...exactCategoryCycleWhere({
            personId: contact.person_id,
            area: input.area,
            programId: input.programId ?? null,
          }),
          started_at: { lte: input.occurredAt },
        },
        orderBy: [{ started_at: 'desc' }, { id: 'desc' }],
        include: {
          lead_status: true,
          assigned_user: { select: { first_name: true, last_name: true, email: true } },
        },
      });
      const { classification: intakeClass, assignmentRule, conflictReason } = classifyEducationIntake({
        occurredAt: input.occurredAt,
        previousInteractionAt: previous?.last_interaction_at,
        previousStatusSlug: previous?.lead_status?.slug,
        previousClosedAt: previous?.closed_at,
      });

      let cycleId = previous?.id ?? null;
      let classification = intakeClass;
      const attentionV1 = await this.isAttentionV1Enabled();
      // Flag off: never open a second concurrent opportunity; reuse the open cycle.
      if (
        classification === 'new' &&
        !attentionV1 &&
        previous &&
        !previous.closed_at
      ) {
        classification = 'duplicate';
      }
      // Forms without chat leave first_inbound_at null (response time N/A).
      const inboundEvidence = !isCommercialLeadChannel(input.channel);
      if (classification === 'new') {
        if (previous && !previous.closed_at) {
          await tx.education_lead_cycles.update({
            where: { id: previous.id },
            data: {
              closed_at: input.occurredAt,
              close_reason: previous.lead_status?.is_terminal ? 'terminal_status' : 'expired',
              updated_at: new Date(),
            },
          });
          await endLeadConversationLinks(tx, previous.id, input.occurredAt);
        }
        const status = await tx.lead_status_definitions.findFirst({
          where: { area: input.area, is_default: true, active: true },
          select: { id: true },
        });
        const existingConversation = !previous ? await tx.conversations.findFirst({
          where: { area: input.area, contact_id: input.contactId },
          orderBy: { id: 'desc' }, select: { assigned_user_id: true },
        }) : null;
        let cycle: { id: number } | null = null;
        try {
          cycle = await withLeadCreateSavepoint(tx, () => tx.education_lead_cycles.create({
            data: {
              area: input.area,
              contact_id: input.contactId,
              person_id: contact.person_id,
              business_area_id: contact.business_area_id,
              program_id: input.programId ?? null,
              started_at: input.occurredAt,
              last_interaction_at: input.occurredAt,
              // Forms without chat: first_inbound_at stays null (response time N/A).
              first_inbound_at: inboundEvidence ? input.occurredAt : null,
              inactivity_deadline_at: inactivityDeadlineFrom(input.occurredAt),
              lead_status_id: previous ? (status?.id ?? null) : (contact.lead_status_id ?? status?.id ?? null),
              lead_score: previous ? null : contact.lead_score,
              assigned_user_id: previous?.assigned_user_id ?? existingConversation?.assigned_user_id ?? null,
              first_assigned_at: (previous?.assigned_user_id ?? existingConversation?.assigned_user_id)
                ? input.occurredAt
                : null,
              requires_review: Boolean(previous),
            },
          }));
        } catch (error) {
          if (!isUniqueViolation(error)) throw error;
          // Concurrent create lost the race: attach to the winning open cycle.
          const winner = await tx.education_lead_cycles.findFirst({
            where: exactOpenCycleWhere({
              personId: contact.person_id,
              area: input.area,
              programId: input.programId ?? null,
            }),
            orderBy: [{ started_at: 'desc' }, { id: 'desc' }],
            select: { id: true, first_inbound_at: true, last_interaction_at: true },
          });
          if (!winner) throw error;
          classification = 'duplicate';
          cycleId = winner.id;
          if (input.occurredAt > winner.last_interaction_at) {
            await tx.education_lead_cycles.update({
              where: { id: winner.id },
              data: {
                last_interaction_at: input.occurredAt,
                inactivity_deadline_at: inactivityDeadlineFrom(input.occurredAt),
                ...(inboundEvidence
                  ? { first_inbound_at: winner.first_inbound_at ?? input.occurredAt }
                  : {}),
                updated_at: new Date(),
              },
            });
          }
        }
        if (cycle) {
          cycleId = cycle.id;
          if (attentionV1) {
            await tx.education_lead_alerts.create({
              data: {
                cycle_id: cycle.id,
                business_area_id: contact.business_area_id,
                program_id: input.programId ?? null,
                area: input.area,
                event_type: 'new_lead',
              },
            }).catch(() => undefined);
          }
          if (previous) {
            if (previous.assigned_user_id) {
              await projectLeadAssignee(tx, cycle.id, previous.assigned_user_id, new Date());
            }
            await tx.contacts.update({
              where: { id: input.contactId },
              data: {
                lead_status_id: status?.id ?? null,
                lead_status_updated_at: new Date(),
                lead_score: null,
              },
            });
          }
        }
      } else if (classification === 'duplicate' && previous &&
          input.occurredAt > previous.last_interaction_at) {
        await tx.education_lead_cycles.update({
          where: { id: previous.id },
          data: {
            last_interaction_at: input.occurredAt,
            inactivity_deadline_at: inactivityDeadlineFrom(input.occurredAt),
            // Only real inbound evidence may fill first_inbound_at.
            ...(inboundEvidence
              ? { first_inbound_at: previous.first_inbound_at ?? input.occurredAt }
              : {}),
            updated_at: new Date(),
          },
        });
      }
      await tx.education_lead_entries.create({
        data: {
          area: input.area, contact_id: input.contactId, program_id: input.programId ?? null,
          origin_id: input.originId, cycle_id: cycleId,
          channel: input.channel, source_key: input.sourceKey, source_label: input.sourceLabel,
          event_key: input.eventKey, occurred_at: input.occurredAt,
          classification, assignment_rule: assignmentRule, conflict_reason: conflictReason,
          previous_assigned_user_id: previous?.assigned_user_id ?? null,
          previous_advisor_label: previous?.assigned_user ? formatAdvisorLabel(previous.assigned_user) : null,
          previous_status_label: previous?.lead_status?.label ?? null,
          previous_interaction_at: previous?.last_interaction_at ?? null,
        },
      });
      if (cycleId && input.conversationId) {
        const openLink = await tx.education_lead_conversation_links.findFirst({
          where: {
            cycle_id: cycleId,
            conversation_id: input.conversationId,
            unlinked_at: null,
          },
          select: { id: true },
        });
        if (!openLink) {
          await tx.education_lead_conversation_links.create({
            data: { cycle_id: cycleId, conversation_id: input.conversationId },
          });
        }
      }
      return classification === 'new' && !previous ? cycleId : null;
    });
    if (this.prospectia) await this.captureProspectia(input.area, input.eventKey);
  }

  private async captureProspectia(area: string, eventKey: string): Promise<void> {
    const entry = await this.prisma.education_lead_entries.findUnique({
      where: { area_event_key: { area, event_key: eventKey } },
      select: {
        id: true, contact_id: true, area: true,
        contact: { select: {
          phone: true, whatsapp_user_id: true,
          conversations: { where: { wa_username: { not: null } },
            orderBy: { updated_at: 'desc' }, take: 1, select: { wa_username: true } },
        } },
      },
    });
    if (!entry) return;
    const result = await this.prospectia!.lookup({
      key: String(entry.id),
      phone: entry.contact.phone,
      username: entry.contact.conversations[0]?.wa_username,
      whatsapp_user_id: entry.contact.whatsapp_user_id,
    });
    await this.applyProspectiaSnapshot(entry.id, entry.contact_id, entry.area, result);
  }

  async applyProspectiaSnapshot(
    entryId: number, contactId: number, area: string,
    result: { match: 'exists' | 'missing' | 'unverified'; advisorEmail: string | null },
  ): Promise<void> {
    await this.prisma.education_lead_entries.update({
      where: { id: entryId },
      data: {
        prospectia_match: result.match,
        prospectia_advisor_email: result.advisorEmail,
        prospectia_checked_at: new Date(),
      },
    });
    if (!result.advisorEmail) return;
    const current = await this.prisma.education_lead_cycles.findFirst({
      where: { contact_id: contactId, area },
      orderBy: [{ started_at: 'desc' }, { id: 'desc' }],
      select: { id: true, assigned_user_id: true, requires_review: true },
    });
    if (!current || current.assigned_user_id || current.requires_review) return;
    await this.assignKnownAdvisor(contactId, area, current.id, result.advisorEmail);
  }

  private async assignKnownAdvisor(contactId: number, area: string, cycleId: number, email: string): Promise<void> {
    const advisor = await this.prisma.users.findFirst({
      where: { email: { equals: email, mode: 'insensitive' }, is_provisioned: true,
        OR: [{ area }, { is_master: true }, { user_areas: { some: { area } } }, userWorksArea(area)],
      }, select: { id: true },
    });
    if (!advisor) return;
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(20260924::integer, ${contactId}::integer)`;
      const latest = await tx.education_lead_cycles.findFirst({
        where: { contact_id: contactId, area },
        orderBy: [{ started_at: 'desc' }, { id: 'desc' }],
        select: { id: true },
      });
      if (latest?.id !== cycleId) return;
      const updated = await tx.education_lead_cycles.updateMany({
        where: {
          id: cycleId,
          assigned_user_id: null,
          requires_review: false,
          closed_at: null,
        },
        data: {
          assigned_user_id: advisor.id,
          first_assigned_at: new Date(),
          updated_at: new Date(),
        },
      });
      if (!updated.count) return;
      await projectLeadAssignee(tx, cycleId, advisor.id, new Date(), true);
      await tx.audit_logs.create({ data: {
        event_type: 'education.lead.prospectia_assigned',
        message: `Lead ${cycleId} asignado según Prospectia`,
        actor_email: 'prospectia@system', area,
        meta: { contact_id: contactId, cycle_id: cycleId, assigned_user_id: advisor.id },
      } });
    });
  }

  prospectiaLatestCheckedAt() {
    return this.prisma.education_lead_entries.findFirst({
      where: { area: { in: EDUCATION_AREAS }, prospectia_checked_at: { not: null } },
      orderBy: { prospectia_checked_at: 'desc' },
      select: { prospectia_checked_at: true },
    }).then((row) => row?.prospectia_checked_at ?? null);
  }

  prospectiaSyncCount(mode: 'pending' | 'all') {
    return this.prisma.education_lead_entries.count({
      where: {
        area: { in: EDUCATION_AREAS },
        ...(mode === 'pending' ? { prospectia_checked_at: null } : {}),
      },
    });
  }

  async prospectiaSyncBatch(mode: 'pending' | 'all', cursorId: number) {
    const rows = await this.prisma.education_lead_entries.findMany({
      where: {
        area: { in: EDUCATION_AREAS },
        ...(mode === 'pending' ? { prospectia_checked_at: null } : { id: { gt: cursorId } }),
      },
      orderBy: [{ id: 'asc' }],
      take: 40,
      select: {
        id: true, area: true, contact_id: true,
        contact: { select: {
          phone: true, whatsapp_user_id: true,
          conversations: { where: { wa_username: { not: null } },
            orderBy: { updated_at: 'desc' }, take: 1, select: { wa_username: true } },
        } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      area: row.area,
      contactId: row.contact_id,
      phone: row.contact.phone,
      username: row.contact.conversations[0]?.wa_username ?? null,
      whatsappUserId: row.contact.whatsapp_user_id,
    }));
  }

  async listEntries(params: {
    area?: string; channel?: string; q?: string; view?: string;
    unassigned?: boolean; page?: number; limit?: number;
  }) {
    const scope = this.leadScope(params.area);
    const areas = scope.areas;
    const view = params.view || 'recent';
    if (!['recent', 'new_number', 'duplicate', 'reassignable', 'conflict', 'in_progress', 'all'].includes(view)) {
      throw new BadRequestException('Vista de leads inválida');
    }
    const cutoff = new Date(Date.now() - SIXTY_DAYS_MS);
    const q = String(params.q ?? '').trim();
    const and: Prisma.education_lead_entriesWhereInput[] = [];
    if (scope.onlyGeneral) and.push({ program_id: null });
    else if (scope.program) and.push(this.programOrLegacyFilter(scope.program));
    if (q) {
      and.push({ OR: [
        { contact: { is: { name: { contains: q, mode: 'insensitive' } } } },
        { contact: { is: { last_name: { contains: q, mode: 'insensitive' } } } },
        { contact: { is: { phone: { contains: q } } } },
        { contact: { is: { whatsapp_user_id: { contains: q, mode: 'insensitive' } } } },
        { contact: { is: { conversations: { some: { wa_username: { contains: q.replace(/^@/, ''), mode: 'insensitive' } } } } } },
        { origin: { is: { whatsapp_user_id: { contains: q, mode: 'insensitive' } } } },
        { source_label: { contains: q, mode: 'insensitive' } },
      ] });
    }
    const base: Prisma.education_lead_entriesWhereInput = {
      area: { in: areas },
      ...(view === 'conflict' ? {} : { occurred_at: { gte: cutoff } }),
      classification: { not: 'dismissed' },
      ...(params.channel ? { channel: params.channel } : {}),
      ...(and.length ? { AND: and } : {}),
    };
    const where: Prisma.education_lead_entriesWhereInput = {
      ...base,
      ...(view === 'duplicate' ? { classification: 'duplicate' } : {}),
      ...(view === 'new_number' ? { assignment_rule: 'new_number' } : {}),
      ...(view === 'reassignable' ? { assignment_rule: 'reassignable' } : {}),
      ...(view === 'conflict' ? { classification: 'conflict', reviewed_at: null } : {}),
      ...(view === 'in_progress' ? { cycle: { is: { assigned_user_id: { not: null } } } } : {}),
      ...(params.unassigned ? { cycle: { is: { assigned_user_id: null } } } : {}),
      ...(view === 'all' ? { occurred_at: undefined, classification: undefined } : {}),
    };
    const page = params.page ?? 1;
    const limit = params.limit ?? 50;
    const [total, items, recent, newNumbers, duplicates, reassignable, conflicts, inProgress, unassigned, eligibleEntries] = await this.prisma.$transaction([
      this.prisma.education_lead_entries.count({ where }),
      this.prisma.education_lead_entries.findMany({
        where, orderBy: [{ occurred_at: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit, take: limit,
        include: {
          program: { select: { slug: true } },
          contact: { select: { id: true, person_id: true, name: true, last_name: true, phone: true,
            whatsapp_user_id: true, email: true,
            conversations: { where: { wa_username: { not: null } },
              orderBy: { updated_at: 'desc' }, take: 1, select: { wa_username: true } },
            education_lead_cycles: { orderBy: [{ started_at: 'desc' }, { id: 'desc' }],
              take: 1, select: { id: true } },
          } },
          origin: { select: { whatsapp_user_id: true,
            conversations: { select: { wa_username: true } } } },
          cycle: { include: {
            assigned_user: { select: { id: true, first_name: true, last_name: true, email: true } },
            lead_status: { select: { id: true, label: true } },
          } },
        },
      }),
      this.prisma.education_lead_entries.count({ where: base }),
      this.prisma.education_lead_entries.count({ where: { ...base, assignment_rule: 'new_number' } }),
      this.prisma.education_lead_entries.count({ where: { ...base, classification: 'duplicate' } }),
      this.prisma.education_lead_entries.count({ where: { ...base, assignment_rule: 'reassignable' } }),
      this.prisma.education_lead_entries.count({
        where: {
          ...base,
          occurred_at: undefined,
          classification: 'conflict',
          reviewed_at: null,
        },
      }),
      this.prisma.education_lead_entries.count({ where: { ...base, cycle: { is: { assigned_user_id: { not: null } } } } }),
      this.prisma.education_lead_entries.count({ where: { ...base, cycle: { is: { assigned_user_id: null } } } }),
      this.prisma.education_lead_entries.findMany({ where: {
        ...base, assignment_rule: 'new_number', cycle: { is: { assigned_user_id: null } },
      }, select: { contact_id: true, cycle_id: true } }),
    ]);
    const latestCycles = eligibleEntries.length ? await this.prisma.education_lead_cycles.findMany({
      where: { contact_id: { in: [...new Set(eligibleEntries.map((entry) => entry.contact_id))] } },
      orderBy: [{ started_at: 'desc' }, { id: 'desc' }],
      select: { id: true, contact_id: true },
    }) : [];
    const latestByContact = new Map<number, number>();
    for (const cycle of latestCycles) {
      if (!latestByContact.has(cycle.contact_id)) latestByContact.set(cycle.contact_id, cycle.id);
    }
    const eligible = eligibleEntries.filter((entry) =>
      entry.cycle_id !== null && latestByContact.get(entry.contact_id) === entry.cycle_id).length;
    return {
      items: items.map((item) => ({
        id: item.id, area: item.area, contact_id: item.contact_id,
        person_id: item.contact.person_id,
        categoria: item.program?.slug ?? educationProgramOf(item.area),
        channel: item.channel,
        source_key: item.source_key,
        source_label: item.source_label,
        phone: item.contact.phone, email: item.contact.email,
        whatsapp_user_id: item.contact.whatsapp_user_id ?? item.origin?.whatsapp_user_id ?? null,
        wa_username: item.origin?.conversations?.wa_username
          ?? item.contact.conversations[0]?.wa_username ?? null,
        first_seen_at: item.occurred_at, last_seen_at: item.cycle?.last_interaction_at ?? item.occurred_at,
        classification: item.classification, assignment_rule: item.assignment_rule,
        conflict_reason: item.conflict_reason,
        previous_assigned_user_id: item.previous_assigned_user_id,
        previous_advisor_label: item.previous_advisor_label,
        previous_status_label: item.previous_status_label,
        previous_interaction_at: item.previous_interaction_at,
        reviewed_at: item.reviewed_at, cycle_id: item.cycle_id,
        prospectia_match: item.prospectia_match,
        prospectia_advisor_email: item.prospectia_advisor_email,
        prospectia_checked_at: item.prospectia_checked_at,
        assigned_user_id: item.cycle?.assigned_user_id ?? null,
        requires_review: item.cycle?.requires_review ?? false,
        is_current_cycle: item.cycle_id !== null &&
          item.cycle_id === item.contact.education_lead_cycles[0]?.id,
        assigned_user_label: item.cycle?.assigned_user ? formatAdvisorLabel(item.cycle.assigned_user) : null,
        lead_status_id: item.cycle?.lead_status_id ?? null,
        contacts: { id: item.contact.id, name: item.contact.name,
          last_name: item.contact.last_name, phone: item.contact.phone,
          whatsapp_user_id: item.contact.whatsapp_user_id,
          wa_username: item.contact.conversations[0]?.wa_username ?? null,
          email: item.contact.email, lead_status: item.cycle?.lead_status ?? null },
      })),
      counts: { recent, new_number: newNumbers, duplicate: duplicates,
        reassignable, conflict: conflicts,
        in_progress: inProgress, unassigned, eligible },
      total, page, limit, pages: Math.ceil(total / limit),
    };
  }

  async catalogs() {
    for (const area of EDUCATION_AREAS) {
      await syncEducationLeadStatuses(this.prisma, area);
    }
    const [users, statuses] = await Promise.all([
      this.prisma.users.findMany({
        where: { is_provisioned: true,
          OR: [{ area: { in: EDUCATION_AREAS } }, { is_master: true },
            { user_areas: { some: { area: { in: EDUCATION_AREAS } } } },
            userWorksArea('educacion')],
        },
        select: { id: true, email: true, first_name: true, last_name: true, area: true, is_master: true,
          user_areas: { select: { area: true } },
          memberships: { where: { active: true }, include: {
            business_area: { select: { slug: true } },
            programs: { include: { program: { select: { slug: true, active: true } } } },
          } } },
        orderBy: { id: 'asc' },
      }),
      this.prisma.lead_status_definitions.findMany({
        where: { area: { in: EDUCATION_AREAS }, active: true },
        orderBy: [{ area: 'asc' }, { sort_order: 'asc' }],
        select: { id: true, area: true, label: true, slug: true, is_default: true },
      }),
    ]);
    return { advisors: users.map((user) => ({
      id: user.id, label: formatAdvisorLabel(user),
      areas: user.is_master ? EDUCATION_AREAS : educationAreasOf(user),
    })), statuses };
  }

  async updateManagement(contactId: number, area: string, changes: {
    assigned_user_id?: number | null; lead_status_id?: number | null; actor_email?: string;
    lead_id?: number;
  }) {
    this.areas(area);
    const contact = await this.prisma.contacts.findFirst({
      where: { id: contactId, area: { in: EDUCATION_AREAS } },
    });
    if (!contact) throw new NotFoundException('Contacto no encontrado');
    if (changes.assigned_user_id === null) {
      throw new BadRequestException('Para reasignar, selecciona otro asesor');
    }

    let managementArea = area;
    let preloadedCycle: {
      id: number;
      contact_id: number;
      area: string;
      closed_at: Date | null;
      assigned_user_id: number | null;
      first_assigned_at: Date | null;
      lead_status_id: number | null;
      program?: { slug: string } | null;
    } | null = null;
    if (changes.lead_id) {
      preloadedCycle = await this.prisma.education_lead_cycles.findFirst({
        where: {
          id: changes.lead_id,
          contact_id: contactId,
          area: { in: EDUCATION_AREAS },
        },
        include: { program: { select: { slug: true } } },
      });
      if (!preloadedCycle) throw new NotFoundException('Oportunidad no encontrada');
      managementArea = educationManagementArea({
        area: preloadedCycle.area,
        programSlug: preloadedCycle.program?.slug,
      });
    }

    if (changes.assigned_user_id !== undefined && changes.assigned_user_id !== null) {
      const advisor = await this.prisma.users.findFirst({
        where: { id: changes.assigned_user_id, is_provisioned: true,
          OR: [
            { area: managementArea },
            { is_master: true },
            { user_areas: { some: { area: managementArea } } },
            userWorksArea(managementArea),
          ],
        }, select: { id: true },
      });
      if (!advisor) throw new BadRequestException('Asesor no habilitado para este número');
    }
    let nextStatus: { id: number; is_terminal: boolean; slug: string } | null = null;
    if (changes.lead_status_id !== undefined && changes.lead_status_id !== null) {
      nextStatus = await this.prisma.lead_status_definitions.findFirst({
        where: { id: changes.lead_status_id, area: managementArea, active: true },
        select: { id: true, is_terminal: true, slug: true },
      });
      if (!nextStatus) throw new BadRequestException('Estado no disponible para este número');
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(20260924::integer, ${contactId}::integer)`;
      let cycle = preloadedCycle
        ? await tx.education_lead_cycles.findFirst({
            where: { id: preloadedCycle.id, contact_id: contactId },
          })
        : await tx.education_lead_cycles.findFirst({
            where: { contact_id: contactId, area, closed_at: null },
            orderBy: [{ started_at: 'desc' }, { id: 'desc' }],
          });
      if (!cycle && !changes.lead_id) {
        cycle = await tx.education_lead_cycles.findFirst({
          where: { contact_id: contactId, area },
          orderBy: [{ started_at: 'desc' }, { id: 'desc' }],
        });
      }
      if (!cycle && changes.lead_id) {
        throw new NotFoundException('Oportunidad no encontrada');
      }
      if (!cycle) {
        cycle = await tx.education_lead_cycles.create({ data: {
          contact_id: contactId,
          person_id: contact.person_id,
          area: managementArea,
          started_at: contact.created_at,
          last_interaction_at: contact.created_at,
          inactivity_deadline_at: inactivityDeadlineFrom(contact.created_at),
          lead_status_id: contact.lead_status_id,
          lead_score: contact.lead_score,
        } });
        await tx.education_lead_alerts.create({
          data: {
            cycle_id: cycle.id,
            business_area_id: contact.business_area_id,
            area: managementArea,
            event_type: 'new_lead',
          },
        }).catch(() => undefined);
      }
      if (cycle.closed_at && changes.lead_status_id === undefined && changes.assigned_user_id === undefined) {
        return cycle;
      }
      if (cycle.closed_at && (changes.assigned_user_id !== undefined || changes.lead_status_id !== undefined)) {
        throw new BadRequestException('El lead está cerrado; inicia una nueva atención');
      }
      const previousAssigneeId = cycle.assigned_user_id;
      const previousStatusId = cycle.lead_status_id;
      const now = new Date();
      const closing = Boolean(nextStatus?.is_terminal || isTerminalEducationStatusSlug(nextStatus?.slug));
      cycle = await tx.education_lead_cycles.update({
        where: { id: cycle.id },
        data: {
          ...(changes.assigned_user_id !== undefined ? {
            assigned_user_id: changes.assigned_user_id,
            requires_review: false,
            first_assigned_at: cycle.first_assigned_at ?? now,
          } : {}),
          ...(changes.lead_status_id !== undefined ? { lead_status_id: changes.lead_status_id } : {}),
          ...(closing ? {
            closed_at: now,
            close_reason: nextStatus?.slug === 'venta_exitosa' || nextStatus?.slug === 'convertido'
              ? 'sold'
              : nextStatus?.slug === 'perdido' || nextStatus?.slug === 'no_interesado'
                ? 'lost'
                : 'terminal_status',
          } : {}),
          updated_at: now,
        },
      });
      if (changes.assigned_user_id !== undefined) {
        await projectLeadAssignee(tx, cycle.id, changes.assigned_user_id!, now);
      }
      if (closing) await endLeadConversationLinks(tx, cycle.id, now);
      if (changes.lead_status_id !== undefined) {
        await tx.contacts.update({ where: { id: contactId }, data: {
          lead_status_id: changes.lead_status_id, lead_status_updated_at: now, updated_at: now,
        } });
      }
      if (changes.assigned_user_id !== undefined || changes.lead_status_id !== undefined) {
        await tx.audit_logs.create({ data: {
          event_type: 'education.lead.management',
          message: `Gestión del lead de contacto ${contactId}`,
          actor_email: changes.actor_email ?? 'mali-one@system', area: managementArea,
          meta: {
            contact_id: contactId, cycle_id: cycle.id, management_area: managementArea,
            from_assigned_user_id: previousAssigneeId,
            to_assigned_user_id: changes.assigned_user_id === undefined
              ? previousAssigneeId : changes.assigned_user_id,
            from_lead_status_id: previousStatusId,
            to_lead_status_id: changes.lead_status_id === undefined
              ? previousStatusId : changes.lead_status_id,
            closed_at: cycle.closed_at,
          },
        } });
      }
      return cycle;
    });
  }

  private async distributeCategory(
    program: string,
    params: { channel?: string; q?: string; actor_email?: string },
  ) {
    const programRow = await this.prisma.business_programs.findFirst({
      where: { slug: program, active: true, business_area: { slug: 'educacion' } },
      select: { id: true },
    });
    if (!programRow) throw new BadRequestException('Categoría no válida');
    const cutoff = new Date(Date.now() - SIXTY_DAYS_MS);
    const q = String(params.q ?? '').trim();
    const legacy = program === 'ca' ? 'educacion_ca' : program === 'ep' ? 'educacion_ep' : null;
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(20260924::bigint)`;
      const advisors = await tx.users.findMany({
        where: {
          is_provisioned: true,
          role_slug: 'asesor_comercial',
          OR: [
            { memberships: { some: {
              active: true,
              business_area: { slug: 'educacion' },
              programs: { some: { program: { slug: program, active: true } } },
            } } },
            ...(legacy ? [{ area: legacy }, { user_areas: { some: { area: legacy } } }] : []),
          ],
        },
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      const workload = new Map(advisors.map((advisor) => [advisor.id, 0]));
      if (advisors.length) {
        const assignedCycles = await tx.$queryRaw<Array<{ assigned_user_id: number; workload: bigint }>>(Prisma.sql`
          SELECT cycle.assigned_user_id, COUNT(*)::bigint AS workload
          FROM education_lead_cycles cycle
          LEFT JOIN lead_status_definitions status ON status.id = cycle.lead_status_id
          WHERE cycle.program_id = ${programRow.id}
            AND cycle.assigned_user_id IN (${Prisma.join(advisors.map((advisor) => advisor.id))})
            AND cycle.last_interaction_at >= ${cutoff}
            AND status.is_terminal IS DISTINCT FROM TRUE
            AND cycle.id = (
              SELECT latest.id FROM education_lead_cycles latest
              WHERE latest.contact_id = cycle.contact_id
              ORDER BY latest.started_at DESC, latest.id DESC LIMIT 1
            )
          GROUP BY cycle.assigned_user_id
        `);
        for (const row of assignedCycles) workload.set(row.assigned_user_id, Number(row.workload));
      }
      const entries = await tx.education_lead_entries.findMany({
        where: {
          area: { in: [...EDUCATION_AREAS] },
          assignment_rule: 'new_number',
          occurred_at: { gte: cutoff },
          cycle: { is: { assigned_user_id: null } },
          OR: [
            { program_id: programRow.id },
            ...(legacy ? [{ program_id: null, area: legacy }] : []),
          ],
          ...(params.channel ? { channel: params.channel } : {}),
          ...(q ? { AND: [{ OR: [
            { contact: { is: { name: { contains: q, mode: 'insensitive' } } } },
            { contact: { is: { phone: { contains: q } } } },
            { source_label: { contains: q, mode: 'insensitive' } },
          ] }] } : {}),
        },
        orderBy: [{ occurred_at: 'asc' }, { id: 'asc' }],
        select: { cycle_id: true, contact_id: true },
      });
      let assigned = 0;
      for (const entry of entries) {
        if (!entry.cycle_id || !advisors.length) break;
        const latest = await tx.education_lead_cycles.findFirst({
          where: { contact_id: entry.contact_id, program_id: programRow.id },
          orderBy: [{ started_at: 'desc' }, { id: 'desc' }],
          select: { id: true },
        });
        if (latest?.id !== entry.cycle_id) continue;
        const advisor = [...advisors].sort((a, b) =>
          (workload.get(a.id) ?? 0) - (workload.get(b.id) ?? 0) || a.id - b.id)[0];
        const updated = await tx.education_lead_cycles.updateMany({
          where: { id: entry.cycle_id, assigned_user_id: null, closed_at: null },
          data: { assigned_user_id: advisor.id, first_assigned_at: new Date(), requires_review: false, updated_at: new Date() },
        });
        if (!updated.count) continue;
        await projectLeadAssignee(tx, entry.cycle_id, advisor.id, new Date());
        await tx.audit_logs.create({ data: {
          event_type: 'education.lead.distributed',
          message: `Lead ${entry.cycle_id} distribuido al asesor ${advisor.id}`,
          actor_email: params.actor_email ?? 'mali-one@system', area: 'educacion',
          meta: { contact_id: entry.contact_id, cycle_id: entry.cycle_id,
            assigned_user_id: advisor.id, category: program, source: 'mali_one_batch' },
        } });
        workload.set(advisor.id, (workload.get(advisor.id) ?? 0) + 1);
        assigned += 1;
      }
      return { assigned, by_area: [{ area: program, assigned }] };
    }, { timeout: 30000 });
  }

  async distribute(params: { area?: string; channel?: string; q?: string; actor_email?: string }) {
    const scope = this.leadScope(params.area);
    if (scope.program) {
      return this.distributeCategory(scope.program, params);
    }
    const areas = scope.onlyGeneral ? ['educacion'] : scope.areas;
    const cutoff = new Date(Date.now() - SIXTY_DAYS_MS);
    const q = String(params.q ?? '').trim();
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(20260924::bigint)`;
      const result: Array<{ area: string; assigned: number }> = [];
      for (const currentArea of areas) {
        const advisors = await tx.users.findMany({
          where: { is_provisioned: true, role_slug: 'asesor_comercial',
            OR: [{ area: currentArea }, { user_areas: { some: { area: currentArea } } }, userWorksArea(currentArea)],
          }, select: { id: true }, orderBy: { id: 'asc' },
        });
        const workload = new Map(advisors.map((advisor) => [advisor.id, 0]));
        if (advisors.length) {
          const assignedCycles = await tx.$queryRaw<Array<{
            assigned_user_id: number; workload: bigint;
          }>>(Prisma.sql`
            SELECT cycle.assigned_user_id, COUNT(*)::bigint AS workload
            FROM education_lead_cycles cycle
            LEFT JOIN lead_status_definitions status ON status.id = cycle.lead_status_id
            WHERE cycle.area = ${currentArea}
              AND cycle.assigned_user_id IN (${Prisma.join(advisors.map((advisor) => advisor.id))})
              AND cycle.last_interaction_at >= ${cutoff}
              AND status.is_terminal IS DISTINCT FROM TRUE
              AND cycle.id = (
                SELECT latest.id FROM education_lead_cycles latest
                WHERE latest.contact_id = cycle.contact_id
                ORDER BY latest.started_at DESC, latest.id DESC LIMIT 1
              )
            GROUP BY cycle.assigned_user_id
          `);
          for (const row of assignedCycles) {
            workload.set(row.assigned_user_id, Number(row.workload));
          }
        }
        const entries = await tx.education_lead_entries.findMany({
          where: { area: currentArea, ...(scope.onlyGeneral ? { program_id: null } : {}),
            assignment_rule: 'new_number', occurred_at: { gte: cutoff },
            ...(params.channel ? { channel: params.channel } : {}),
            ...(q ? { OR: [
              { contact: { is: { name: { contains: q, mode: 'insensitive' } } } },
              { contact: { is: { last_name: { contains: q, mode: 'insensitive' } } } },
              { contact: { is: { phone: { contains: q } } } },
              { contact: { is: { whatsapp_user_id: { contains: q, mode: 'insensitive' } } } },
              { contact: { is: { conversations: { some: { wa_username: { contains: q.replace(/^@/, ''), mode: 'insensitive' } } } } } },
              { source_label: { contains: q, mode: 'insensitive' } },
            ] } : {}),
            cycle: { is: { assigned_user_id: null } } },
          orderBy: [{ occurred_at: 'asc' }, { id: 'asc' }],
          select: { cycle_id: true, contact_id: true },
        });
        let assigned = 0;
        for (const entry of entries) {
          if (!entry.cycle_id || !advisors.length) break;
          const latest = await tx.education_lead_cycles.findFirst({
            where: { contact_id: entry.contact_id }, orderBy: [{ started_at: 'desc' }, { id: 'desc' }],
            select: { id: true },
          });
          if (latest?.id !== entry.cycle_id) continue;
          const advisor = [...advisors].sort((a, b) =>
            (workload.get(a.id) ?? 0) - (workload.get(b.id) ?? 0) || a.id - b.id)[0];
          const updated = await tx.education_lead_cycles.updateMany({
            where: { id: entry.cycle_id, assigned_user_id: null, closed_at: null },
            data: { assigned_user_id: advisor.id, first_assigned_at: new Date(), requires_review: false, updated_at: new Date() },
          });
          if (!updated.count) continue;
          await projectLeadAssignee(tx, entry.cycle_id, advisor.id, new Date());
          await tx.audit_logs.create({ data: {
            event_type: 'education.lead.distributed',
            message: `Lead ${entry.cycle_id} distribuido al asesor ${advisor.id}`,
            actor_email: params.actor_email ?? 'mali-one@system', area: currentArea,
            meta: { contact_id: entry.contact_id, cycle_id: entry.cycle_id,
              assigned_user_id: advisor.id, source: 'mali_one_batch' },
          } });
          workload.set(advisor.id, (workload.get(advisor.id) ?? 0) + 1);
          assigned += 1;
        }
        result.push({ area: currentArea, assigned });
      }
      return { assigned: result.reduce((sum, row) => sum + row.assigned, 0), by_area: result };
    }, { timeout: 30000 });
  }

  async reviewEntry(id: number, area: string, action: 'open_new' | 'keep_existing' | 'dismiss',
    actorEmail?: string) {
    this.areas(area);
    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.education_lead_entries.findFirst({ where: { id, area } });
      if (!entry) throw new NotFoundException('Entrada no encontrada');
      if (entry.classification !== 'conflict') throw new BadRequestException('La entrada no tiene conflicto');
      if (entry.reviewed_at) throw new BadRequestException('El conflicto ya fue revisado');
      const contact = await tx.contacts.findUnique({
        where: { id: entry.contact_id },
        select: { person_id: true, business_area_id: true },
      });
      if (!contact) throw new NotFoundException('Contacto no encontrado');
      const programKey = entry.program_id ?? 0;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${contact.person_id}::integer, ${programKey}::integer)`;
      const latestCycle = await tx.education_lead_cycles.findFirst({
        where: {
          ...exactCategoryCycleWhere({
            personId: contact.person_id,
            area,
            programId: entry.program_id,
          }),
        },
        orderBy: [{ started_at: 'desc' }, { id: 'desc' }],
      });
      if (action !== 'dismiss' && latestCycle && latestCycle.started_at > entry.occurred_at) {
        throw new BadRequestException('Hay un ciclo posterior; revisa esta entrada con el historial actualizado');
      }
      let cycleId = entry.cycle_id;
      if (action === 'open_new') {
        const status = await tx.lead_status_definitions.findFirst({
          where: { area, active: true, is_default: true }, select: { id: true },
        });
        if (latestCycle && !latestCycle.closed_at) {
          await tx.education_lead_cycles.update({
            where: { id: latestCycle.id },
            data: {
              closed_at: entry.occurred_at,
              close_reason: 'superseded_review',
              updated_at: new Date(),
            },
          });
          await endLeadConversationLinks(tx, latestCycle.id, entry.occurred_at);
        }
        const cycle = await tx.education_lead_cycles.create({ data: {
          area, contact_id: entry.contact_id, person_id: contact.person_id,
          business_area_id: contact.business_area_id,
          program_id: entry.program_id ?? null,
          started_at: entry.occurred_at,
          last_interaction_at: entry.occurred_at,
          first_inbound_at: isCommercialLeadChannel(entry.channel) ? null : entry.occurred_at,
          inactivity_deadline_at: inactivityDeadlineFrom(entry.occurred_at),
          lead_status_id: status?.id ?? null,
          assigned_user_id: latestCycle?.assigned_user_id ?? null,
          first_assigned_at: latestCycle?.assigned_user_id ? entry.occurred_at : null,
          requires_review: true,
        } });
        cycleId = cycle.id;
        await tx.education_lead_alerts.create({
          data: {
            cycle_id: cycle.id,
            business_area_id: contact.business_area_id,
            area,
            event_type: 'new_lead',
          },
        }).catch(() => undefined);
        await tx.contacts.update({ where: { id: entry.contact_id }, data: {
          lead_status_id: status?.id ?? null, lead_status_updated_at: new Date(), lead_score: null,
        } });
      } else if (action === 'keep_existing' && cycleId) {
        await tx.education_lead_cycles.update({ where: { id: cycleId }, data: {
          last_interaction_at: latestCycle && latestCycle.last_interaction_at > entry.occurred_at
            ? latestCycle.last_interaction_at : entry.occurred_at,
          updated_at: new Date(),
        } });
      }
      const reviewed = await tx.education_lead_entries.update({ where: { id }, data: {
        cycle_id: action === 'dismiss' ? null : cycleId,
        classification: action === 'open_new' ? 'new' : action === 'keep_existing' ? 'duplicate' : 'dismissed',
        assignment_rule: action === 'open_new' ? 'reassignable'
          : action === 'keep_existing' ? 'same_advisor' : 'conflict',
        reviewed_at: new Date(), conflict_reason: null,
      } });
      await tx.audit_logs.create({ data: {
        event_type: 'education.lead.conflict_reviewed',
        message: `Conflicto de lead ${id} resuelto: ${action}`,
        actor_email: actorEmail ?? 'mali-one@system', area,
        meta: { entry_id: id, contact_id: entry.contact_id, action, cycle_id: cycleId },
      } });
      return reviewed;
    });
  }

  /** Atomically claim an open lead before sending a human reply. */
  async reserveClaim(input: {
    leadId: number;
    userId: number;
    conversationId?: number;
    actorEmail?: string;
  }): Promise<{ claimed: boolean; leadId: number; assignedUserId: number | null }> {
    if (!(await this.isAttentionV1Enabled())) {
      return { claimed: false, leadId: input.leadId, assignedUserId: null };
    }
    return this.prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM education_lead_cycles WHERE id = ${input.leadId} FOR UPDATE`;
    const cycle = await tx.education_lead_cycles.findUnique({
      where: { id: input.leadId },
      select: {
        id: true, area: true, contact_id: true, assigned_user_id: true,
        requires_review: true, closed_at: true,
      },
    });
    if (!cycle) throw new NotFoundException('Lead no encontrado');
    if (cycle.closed_at) throw new BadRequestException('El lead está cerrado');
    if (cycle.requires_review && !cycle.assigned_user_id) {
      throw new BadRequestException('El lead requiere revisión antes de reclamarlo');
    }
    if (cycle.assigned_user_id && cycle.assigned_user_id !== input.userId) {
      return {
        claimed: false,
        leadId: cycle.id,
        assignedUserId: cycle.assigned_user_id,
      };
    }
    if (cycle.assigned_user_id === input.userId) {
      if (input.conversationId) await this.linkConversationInTransaction(tx, cycle.id, input.conversationId);
      return { claimed: true, leadId: cycle.id, assignedUserId: input.userId };
    }
    const now = new Date();
    const updated = await tx.education_lead_cycles.updateMany({
      where: {
        id: cycle.id,
        assigned_user_id: null,
        requires_review: false,
        closed_at: null,
      },
      data: {
        assigned_user_id: input.userId,
        first_assigned_at: now,
        updated_at: now,
      },
    });
    if (!updated.count) {
      const latest = await tx.education_lead_cycles.findUnique({
        where: { id: cycle.id },
        select: { assigned_user_id: true },
      });
      return {
        claimed: latest?.assigned_user_id === input.userId,
        leadId: cycle.id,
        assignedUserId: latest?.assigned_user_id ?? null,
      };
    }
    await projectLeadAssignee(tx, cycle.id, input.userId, now);
    if (input.conversationId) await this.linkConversationInTransaction(tx, cycle.id, input.conversationId);
    await tx.audit_logs.create({
      data: {
        event_type: 'education.lead.claim_reserved',
        message: `Lead ${cycle.id} reservado por asesor ${input.userId}`,
        actor_email: input.actorEmail ?? 'system@mali',
        area: cycle.area,
        meta: {
          cycle_id: cycle.id,
          contact_id: cycle.contact_id,
          assigned_user_id: input.userId,
          conversation_id: input.conversationId ?? null,
        },
      },
    });
    return { claimed: true, leadId: cycle.id, assignedUserId: input.userId };
    });
  }

  async markFirstHumanReply(leadId: number, at = new Date()): Promise<void> {
    await this.prisma.education_lead_cycles.updateMany({
      where: { id: leadId, first_human_reply_at: null, closed_at: null },
      data: { first_human_reply_at: at, updated_at: at },
    });
  }

  async linkConversation(cycleId: number, conversationId: number): Promise<void> {
    if (!cycleId || !conversationId) return;
    await this.prisma.$transaction((tx) => this.linkConversationInTransaction(tx, cycleId, conversationId));
  }

  private async linkConversationInTransaction(tx: Prisma.TransactionClient, cycleId: number, conversationId: number): Promise<void> {
    // Serialize against closure: no new live link may appear after closed_at is set.
    const rows = await tx.$queryRaw<Array<{ closed_at: Date | null }>>`
      SELECT closed_at FROM education_lead_cycles WHERE id = ${cycleId} FOR UPDATE`;
    if (!rows.length || rows[0].closed_at) throw new BadRequestException('El lead está cerrado o no existe');
    const inserted = await tx.$executeRaw`
      INSERT INTO education_lead_conversation_links (cycle_id, conversation_id)
      SELECT lead.id, c.id FROM education_lead_cycles lead
      JOIN conversations c ON c.id = ${conversationId} AND c.business_area_id = lead.business_area_id
      JOIN contacts ct ON ct.id = c.contact_id AND ct.person_id = lead.person_id
      LEFT JOIN whatsapp_lines line ON line.id = c.whatsapp_line_id
      WHERE lead.id = ${cycleId} AND line.program_id IS NOT DISTINCT FROM lead.program_id
      ON CONFLICT (cycle_id, conversation_id) WHERE unlinked_at IS NULL DO NOTHING`;
    if (!inserted) {
      const existing = await tx.education_lead_conversation_links.findFirst({
        where: { cycle_id: cycleId, conversation_id: conversationId, unlinked_at: null },
        select: { id: true },
      });
      if (!existing) throw new BadRequestException('La conversación no pertenece al contexto del lead');
    }
  }

  async findOpenLeadForConversation(conversationId: number, area: string) {
    if (!isEducationAttentionArea(area)) return null;
    const conversation = await this.prisma.conversations.findFirst({
      where: { id: conversationId, area },
      select: {
        id: true,
        contact_id: true,
        whatsapp_line: { select: { program_id: true } },
        contacts: { select: { person_id: true } },
      },
    });
    if (!conversation?.contact_id || !conversation.contacts) return null;
    const programId = conversation.whatsapp_line?.program_id ?? null;
    const linked = await this.prisma.education_lead_conversation_links.findFirst({
      where: {
        conversation_id: conversationId,
        unlinked_at: null,
        cycle: exactOpenCycleWhere({
          personId: conversation.contacts.person_id,
          area,
          programId,
        }),
      },
      orderBy: [{ linked_at: 'desc' }, { id: 'desc' }],
      include: { cycle: true },
    });
    if (linked?.cycle) return linked.cycle;
    return this.prisma.education_lead_cycles.findFirst({
      where: exactOpenCycleWhere({
        personId: conversation.contacts.person_id,
        area,
        programId,
      }),
      orderBy: [{ started_at: 'desc' }, { id: 'desc' }],
    });
  }

  async getAttentionForContext(input: {
    contactId: number;
    area: string;
    conversationId?: number | null;
    programId?: number | null;
    user?: AuthUser;
  }) {
    this.areas(input.area);
    const contact = await this.prisma.contacts.findFirst({
      where: { id: input.contactId, area: input.area },
      select: { id: true, person_id: true },
    });
    if (!contact) throw new NotFoundException('Contacto no encontrado');
    let programId = input.programId ?? null;
    let lineId: number | null = null;
    if (input.conversationId) {
      const conversation = await this.prisma.conversations.findFirst({
        where: { id: input.conversationId, area: input.area },
        select: {
          contact_id: true,
          whatsapp_line_id: true,
          whatsapp_line: { select: { program_id: true } },
        },
      });
      if (!conversation || conversation.contact_id !== contact.id) {
        throw new BadRequestException('La conversación no pertenece a este contacto');
      }
      programId = conversation.whatsapp_line?.program_id ?? null;
      lineId = conversation.whatsapp_line_id ?? null;
    }
    const cycle = await this.prisma.education_lead_cycles.findFirst({
      where: exactOpenCycleWhere({
        personId: contact.person_id,
        area: input.area,
        programId,
      }),
      orderBy: [{ started_at: 'desc' }, { id: 'desc' }],
      include: {
        program: { select: { slug: true } },
        lead_status: { select: { id: true, label: true, slug: true } },
        assigned_user: {
          select: { id: true, first_name: true, last_name: true, email: true },
        },
      },
    });
    if (!cycle) return null;
    if (input.user) {
      this.assertCanAccessLeadContext(input.user, cycle, lineId);
    }
    return {
      id: cycle.id,
      contact_id: cycle.contact_id,
      person_id: cycle.person_id,
      program_id: cycle.program_id,
      area: cycle.area,
      closed_at: cycle.closed_at,
      assigned_user_id: cycle.assigned_user_id,
      assigned_user_label: cycle.assigned_user ? formatAdvisorLabel(cycle.assigned_user) : null,
      lead_status: cycle.lead_status,
      requires_review: cycle.requires_review,
    };
  }

  /** Explicit CTA after close / ambiguous inbound: open a fresh opportunity. */
  async startAttention(input: {
    contactId: number;
    area: string;
    programId?: number | null;
    actorEmail?: string;
    conversationId?: number | null;
    user?: AuthUser;
  }) {
    this.areas(input.area);
    if (!(await this.isAttentionV1Enabled())) {
      throw new BadRequestException('Atención v1 no está activada en este entorno');
    }
    return this.prisma.$transaction(async (tx) => {
      const contact = await tx.contacts.findFirst({
        where: { id: input.contactId, area: input.area },
        select: { id: true, person_id: true, business_area_id: true, created_at: true },
      });
      if (!contact) throw new NotFoundException('Contacto no encontrado');
      let programId = input.programId ?? null;
      let lineId: number | null = null;
      if (input.conversationId) {
        const conversation = await tx.conversations.findFirst({
          where: { id: input.conversationId, area: input.area },
          select: {
            contact_id: true,
            whatsapp_line_id: true,
            whatsapp_line: { select: { program_id: true } },
          },
        });
        if (!conversation || conversation.contact_id !== contact.id) {
          throw new BadRequestException('La conversación no pertenece a este contacto');
        }
        programId = conversation.whatsapp_line?.program_id ?? null;
        lineId = conversation.whatsapp_line_id ?? null;
      }
      let programSlug: string | null = null;
      if (programId != null) {
        const program = await tx.business_programs.findUnique({
          where: { id: programId },
          select: { slug: true },
        });
        programSlug = program?.slug ?? null;
      }
      if (input.user) {
        this.assertCanAccessLeadContext(
          input.user,
          {
            area: input.area,
            program_id: programId,
            program: { slug: programSlug },
          },
          lineId,
        );
      }
      const programKey = programId ?? 0;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${contact.person_id}::integer, ${programKey}::integer)`;
      const open = await tx.education_lead_cycles.findFirst({
        where: exactOpenCycleWhere({
          personId: contact.person_id,
          area: input.area,
          programId,
        }),
        orderBy: [{ started_at: 'desc' }, { id: 'desc' }],
      });
      if (open) {
        if (input.conversationId) {
          const existing = await tx.education_lead_conversation_links.findFirst({
            where: {
              cycle_id: open.id,
              conversation_id: input.conversationId,
              unlinked_at: null,
            },
          });
          if (!existing) {
            await tx.education_lead_conversation_links.create({
              data: { cycle_id: open.id, conversation_id: input.conversationId },
            });
          }
        }
        return open;
      }
      const status = await tx.lead_status_definitions.findFirst({
        where: { area: input.area, is_default: true, active: true },
        select: { id: true },
      });
      const now = new Date();
      const cycle = await tx.education_lead_cycles.create({
        data: {
          area: input.area,
          contact_id: contact.id,
          person_id: contact.person_id,
          program_id: programId,
          started_at: now,
          last_interaction_at: now,
          // Explicit CTA without inbound evidence: leave first_inbound_at null.
          first_inbound_at: null,
          inactivity_deadline_at: inactivityDeadlineFrom(now),
          lead_status_id: status?.id ?? null,
          requires_review: false,
        },
      });
      await tx.education_lead_alerts.create({
        data: {
          cycle_id: cycle.id,
          business_area_id: contact.business_area_id,
          program_id: programId,
          area: input.area,
          event_type: 'new_lead',
        },
      });
      if (input.conversationId) {
        await tx.education_lead_conversation_links.create({
          data: { cycle_id: cycle.id, conversation_id: input.conversationId },
        });
      }
      await tx.audit_logs.create({
        data: {
          event_type: 'education.lead.attention_started',
          message: `Nueva atención iniciada para contacto ${contact.id}`,
          actor_email: input.actorEmail ?? 'system@mali',
          area: input.area,
          meta: { contact_id: contact.id, cycle_id: cycle.id, program_id: programId },
        },
      });
      return cycle;
    });
  }

  async listCycles(params: {
    area?: string; channel?: string; q?: string;
    view?: 'open' | 'closed' | 'review' | 'unassigned';
    page?: number; limit?: number;
  }) {
    const scope = this.leadScope(params.area);
    const page = params.page ?? 1;
    const limit = params.limit ?? 50;
    const view = params.view ?? 'open';
    const q = String(params.q ?? '').trim();
    const scoped: Prisma.education_lead_cyclesWhereInput[] = [];
    if (scope.onlyGeneral) scoped.push({ program_id: null, area: 'educacion' });
    else if (scope.program) scoped.push(this.programOrLegacyCycleFilter(scope.program));
    else scoped.push({ area: { in: scope.areas } });
    if (params.channel) scoped.push({ entries: { some: { channel: params.channel } } });
    if (q) {
      scoped.push({
        OR: [
          { contact: { is: { name: { contains: q, mode: 'insensitive' } } } },
          { contact: { is: { last_name: { contains: q, mode: 'insensitive' } } } },
          { contact: { is: { phone: { contains: q } } } },
          { contact: { is: { whatsapp_user_id: { contains: q, mode: 'insensitive' } } } },
          { contact: { is: { conversations: { some: {
            wa_username: { contains: q.replace(/^@/, ''), mode: 'insensitive' },
          } } } } },
          { contact: { is: { email: { contains: q, mode: 'insensitive' } } } },
          { entries: { some: { source_label: { contains: q, mode: 'insensitive' } } } },
        ],
      });
    }
    const stateWhere: Record<typeof view, Prisma.education_lead_cyclesWhereInput> = {
      open: { closed_at: null },
      closed: { closed_at: { not: null } },
      review: { closed_at: null, requires_review: true },
      unassigned: { closed_at: null, assigned_user_id: null },
    };
    const baseWhere: Prisma.education_lead_cyclesWhereInput = scoped.length ? { AND: scoped } : {};
    const where: Prisma.education_lead_cyclesWhereInput = {
      AND: [baseWhere, stateWhere[view]],
    };
    const [total, items, open, closed, review, unassigned] = await this.prisma.$transaction([
      this.prisma.education_lead_cycles.count({ where }),
      this.prisma.education_lead_cycles.findMany({
        where,
        orderBy: [{ started_at: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          program: { select: { slug: true, label: true } },
          lead_status: { select: { id: true, label: true, slug: true } },
          assigned_user: {
            select: { id: true, first_name: true, last_name: true, email: true },
          },
          contact: {
            select: {
              id: true, person_id: true, name: true, last_name: true,
              phone: true, email: true, whatsapp_user_id: true,
              conversations: {
                where: { wa_username: { not: null } },
                orderBy: { updated_at: 'desc' }, take: 1,
                select: { wa_username: true },
              },
            },
          },
          conversation_links: {
            where: { unlinked_at: null },
            orderBy: { linked_at: 'desc' },
            take: 1,
            select: { conversation_id: true },
          },
          entries: {
            orderBy: [{ occurred_at: 'desc' }, { id: 'desc' }],
            take: 20,
            select: {
              channel: true, source_label: true, assignment_rule: true,
              classification: true, occurred_at: true,
              origin: { select: { payload: true } },
            },
          },
        },
      }),
      this.prisma.education_lead_cycles.count({ where: { AND: [baseWhere, stateWhere.open] } }),
      this.prisma.education_lead_cycles.count({ where: { AND: [baseWhere, stateWhere.closed] } }),
      this.prisma.education_lead_cycles.count({ where: { AND: [baseWhere, stateWhere.review] } }),
      this.prisma.education_lead_cycles.count({ where: { AND: [baseWhere, stateWhere.unassigned] } }),
    ]);
    return {
      items: items.map((item) => {
        const latestEntry = item.entries[0];
        const cursoEntry = item.entries.find((entry) =>
          Boolean(cursoFromOriginPayload(entry.origin?.payload)));
        return {
          id: item.id,
          area: item.area,
          contact_id: item.contact_id,
          person_id: item.person_id,
          categoria: item.program?.slug ?? educationProgramOf(item.area),
          categoria_label: item.program?.label ?? null,
          curso_interes: cursoFromOriginPayload(cursoEntry?.origin?.payload),
          channel: latestEntry?.channel ?? null,
          source_label: latestEntry?.source_label ?? null,
          assignment_rule: latestEntry?.assignment_rule ?? null,
          classification: latestEntry?.classification ?? null,
          latest_capture_at: latestEntry?.occurred_at ?? null,
          started_at: item.started_at,
          last_interaction_at: item.last_interaction_at,
          closed_at: item.closed_at,
          assigned_user_id: item.assigned_user_id,
          assigned_user_label: item.assigned_user ? formatAdvisorLabel(item.assigned_user) : null,
          lead_status_id: item.lead_status_id,
          lead_status: item.lead_status,
          lead_score: item.lead_score,
          requires_review: item.requires_review,
          conversation_id: item.conversation_links[0]?.conversation_id ?? null,
          contacts: {
            id: item.contact.id,
            person_id: item.contact.person_id,
            name: item.contact.name,
            last_name: item.contact.last_name,
            phone: item.contact.phone,
            email: item.contact.email,
            whatsapp_user_id: item.contact.whatsapp_user_id,
            wa_username: item.contact.conversations[0]?.wa_username ?? null,
          },
        };
      }),
      counts: { open, closed, review, unassigned },
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    };
  }

  async listAlertsForUser(user: {
    id: number;
    area: string;
    is_master?: boolean;
    email?: string;
    businessAccess?: {
      mode: 'all' | 'restricted';
      programIds: number[];
      categorySlugs: string[] | null;
      canonicalArea?: string;
    };
    allowedAreas?: string[];
  }, params?: { limit?: number }) {
    if (!(await this.isAttentionV1Enabled())) return { items: [] };
    const allowed = new Set(
      (user.allowedAreas ?? []).filter((area) => EDUCATION_AREAS.includes(area)),
    );
    if (user.is_master) EDUCATION_AREAS.forEach((area) => allowed.add(area));
    if (isEducationAttentionArea(user.area)) allowed.add(user.area);
    // Never expand to all educación* for PAM/other areas.
    if (!user.is_master && !isEducationAttentionArea(user.area) && allowed.size === 0) {
      return { items: [] };
    }
    const areas = user.is_master ? [...EDUCATION_AREAS] : [...allowed];
    if (!areas.length) return { items: [] };

    const access = user.businessAccess;
    const categoryFilter: Prisma.education_lead_alertsWhereInput =
      user.is_master || !access || access.mode === 'all'
        ? {}
        : {
            OR: [
              ...(access.programIds.length
                ? [{ program_id: { in: access.programIds } }]
                : []),
              ...(access.categorySlugs?.includes('general')
                ? [{ program_id: null }]
                : []),
            ],
          };
    if (
      !user.is_master &&
      access?.mode === 'restricted' &&
      !access.programIds.length &&
      !access.categorySlugs?.includes('general')
    ) {
      return { items: [] };
    }

    const limit = Math.min(Math.max(params?.limit ?? 30, 1), 100);
    const alerts = await this.prisma.education_lead_alerts.findMany({
      where: {
        area: { in: areas },
        event_type: 'new_lead',
        reads: { none: { user_id: user.id } },
        cycle: { closed_at: null },
        ...categoryFilter,
      },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: limit,
      include: {
        cycle: {
          select: {
            id: true,
            area: true,
            contact_id: true,
            program_id: true,
            assigned_user_id: true,
            contact: {
              select: { id: true, name: true, last_name: true, phone: true },
            },
          },
        },
      },
    });
    return {
      items: alerts.map((alert) => ({
        id: alert.id,
        cycle_id: alert.cycle_id,
        area: alert.area,
        program_id: alert.program_id,
        created_at: alert.created_at,
        contact_id: alert.cycle.contact_id,
        contact_name: [alert.cycle.contact.name, alert.cycle.contact.last_name]
          .filter(Boolean).join(' '),
        phone: alert.cycle.contact.phone,
        assigned_user_id: alert.cycle.assigned_user_id,
      })),
    };
  }

  async markAlertRead(alertId: number, userId: number) {
    await this.prisma.education_lead_alert_reads.upsert({
      where: { alert_id_user_id: { alert_id: alertId, user_id: userId } },
      create: { alert_id: alertId, user_id: userId },
      update: { read_at: new Date() },
    });
    return { ok: true };
  }

  async setLeadAttributes(
    cycleId: number,
    values: Record<string, string>,
    actorEmail?: string,
    user?: AuthUser,
  ) {
    if (!(await this.isAttentionV1Enabled())) {
      throw new BadRequestException('Atención v1 no está activada en este entorno');
    }
    const cycle = await this.prisma.education_lead_cycles.findUnique({
      where: { id: cycleId },
      select: {
        id: true,
        area: true,
        closed_at: true,
        program_id: true,
        program: { select: { slug: true } },
      },
    });
    if (!cycle) throw new NotFoundException('Lead no encontrado');
    if (cycle.closed_at) throw new BadRequestException('No se editan atributos de un lead cerrado');
    if (user) this.assertCanAccessLeadContext(user, cycle);
    const keys = Object.keys(values);
    if (!keys.length) return [];
    const defs = await this.prisma.contact_attribute_definitions.findMany({
      where: {
        area: cycle.area,
        owner_kind: 'lead',
        active: true,
        slug: { in: keys },
        ...(cycle.program_id != null
          ? { OR: [{ program_id: cycle.program_id }, { program_id: null }] }
          : { program_id: null }),
      },
    });
    const bySlug = new Map(defs.map((def) => [def.slug, def]));
    await this.prisma.$transaction(async (tx) => {
      for (const [slug, raw] of Object.entries(values)) {
        const def = bySlug.get(slug);
        if (!def) continue;
        if (def.program_id != null && def.program_id !== cycle.program_id) continue;
        await tx.education_lead_attributes.upsert({
          where: {
            cycle_id_definition_id: { cycle_id: cycleId, definition_id: def.id },
          },
          create: {
            cycle_id: cycleId,
            definition_id: def.id,
            attr_key: def.slug,
            attr_value: String(raw ?? ''),
          },
          update: { attr_value: String(raw ?? ''), updated_at: new Date() },
        });
      }
      await tx.audit_logs.create({
        data: {
          event_type: 'education.lead.attributes',
          message: `Atributos de lead ${cycleId} actualizados`,
          actor_email: actorEmail ?? user?.email ?? 'system@mali',
          area: cycle.area,
          meta: { cycle_id: cycleId, keys },
        },
      });
    });
    return this.prisma.education_lead_attributes.findMany({
      where: { cycle_id: cycleId },
      select: { attr_key: true, attr_value: true, definition_id: true },
    });
  }

  /**
   * Auto-expire only cycles that already have inactivity_deadline_at
   * (set by post-activation writers). Historical opens with NULL deadline
   * are excluded; close them via the reviewable historical batch script.
   */
  async expireDueCycles(limit = 200) {
    if (!(await this.isAttentionV1Enabled())) return { expired: 0 };
    const now = new Date();
    const due = await this.prisma.education_lead_cycles.findMany({
      where: {
        closed_at: null,
        inactivity_deadline_at: { not: null, lte: now },
      },
      orderBy: { inactivity_deadline_at: 'asc' },
      take: limit,
      select: { id: true, inactivity_deadline_at: true },
    });
    let expired = 0;
    for (const row of due) {
      const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.education_lead_cycles.updateMany({
        where: {
          id: row.id,
          closed_at: null,
          // Re-check so a concurrent renewal does not get closed.
          inactivity_deadline_at: { not: null, lte: now },
        },
        data: {
          closed_at: now,
          close_reason: 'expired',
          updated_at: now,
        },
      });
      if (result.count) await endLeadConversationLinks(tx, row.id, now);
      return result;
      });
      expired += updated.count;
    }
    return { expired };
  }

  /** Route lead-owned attribute writes from contact save onto the open cycle. */
  async writeLeadAttributesFromContactSave(
    contactId: number,
    area: string,
    programId: number | null,
    values: Record<string, string>,
    actorEmail?: string,
  ) {
    const contact = await this.prisma.contacts.findFirst({
      where: { id: contactId, area },
      select: { person_id: true },
    });
    if (!contact) return [];
    const cycle = await this.prisma.education_lead_cycles.findFirst({
      where: exactOpenCycleWhere({
        personId: contact.person_id,
        area,
        programId,
      }),
      orderBy: [{ started_at: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    if (!cycle) return [];
    return this.setLeadAttributes(cycle.id, values, actorEmail);
  }

  assertClaimAvailable(assignedUserId: number | null | undefined, actorId: number) {
    if (assignedUserId != null && assignedUserId !== actorId) {
      throw new ConflictException('Lead ya asignado a otro asesor');
    }
  }
}
