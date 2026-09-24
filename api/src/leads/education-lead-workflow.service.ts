import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { classifyEducationIntake, EDUCATION_LEAD_WINDOW_MS } from './education-lead-classification.util';

const EDUCATION_AREAS = ['educacion', 'educacion_ca', 'educacion_ep'];
const SIXTY_DAYS_MS = EDUCATION_LEAD_WINDOW_MS;
const INBOUND_SESSION_MS = 24 * 60 * 60 * 1000;

function advisorLabel(user: { first_name: string | null; last_name: string | null; email: string }) {
  return [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email;
}

@Injectable()
export class EducationLeadWorkflowService {
  constructor(private readonly prisma: PrismaService) {}

  private areas(area?: string): string[] {
    const selected = String(area ?? 'all').trim().toLowerCase() || 'all';
    if (selected !== 'all' && !EDUCATION_AREAS.includes(selected)) {
      throw new BadRequestException('Área de educación inválida');
    }
    return selected === 'all' ? EDUCATION_AREAS : [selected];
  }

  async recordOrigin(originId: number): Promise<void> {
    const origin = await this.prisma.contact_origins.findUnique({ where: { id: originId } });
    if (!origin || !origin.contact_id || !EDUCATION_AREAS.includes(origin.area)) return;
    await this.recordEntry({
      area: origin.area, contactId: origin.contact_id, originId,
      channel: origin.channel, sourceKey: origin.source_key, sourceLabel: origin.source_label,
      eventKey: `origin:${origin.id}`, occurredAt: origin.first_seen_at,
    });
  }

  async recordInbound(input: {
    area: string; contactId: number | null; conversationId: number; messageId: number;
    originId?: number | null; occurredAt: Date;
    channel?: string; sourceKey?: string | null; sourceLabel?: string | null;
  }): Promise<void> {
    if (!input.contactId || !EDUCATION_AREAS.includes(input.area)) return;
    const latestEntry = await this.prisma.education_lead_entries.findFirst({
      where: { area: input.area, contact_id: input.contactId },
      orderBy: [{ occurred_at: 'desc' }, { id: 'desc' }],
      select: { occurred_at: true, classification: true },
    });
    const latestCycle = await this.prisma.education_lead_cycles.findFirst({
      where: { area: input.area, contact_id: input.contactId },
      orderBy: [{ started_at: 'desc' }, { id: 'desc' }],
    });
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
      if (latestEntry?.classification !== 'conflict' && latestCycle &&
          input.occurredAt > latestCycle.last_interaction_at) {
        await this.prisma.education_lead_cycles.update({
          where: { id: latestCycle.id },
          data: { last_interaction_at: input.occurredAt, updated_at: new Date() },
        });
      }
      return;
    }
    await this.recordEntry({
      area: input.area, contactId: input.contactId, originId: input.originId ?? null,
      channel: input.channel ?? 'organic_wa',
      sourceKey: input.sourceKey ?? null,
      sourceLabel: input.sourceLabel ?? 'WhatsApp orgánico',
      eventKey: `inbound:${input.messageId}`, occurredAt: input.occurredAt,
    });
  }

  private async recordEntry(input: {
    area: string; contactId: number; originId: number | null;
    channel: string; sourceKey: string | null; sourceLabel: string | null;
    eventKey: string; occurredAt: Date;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(20260924::integer, ${input.contactId}::integer)`;
      const existing = await tx.education_lead_entries.findUnique({
        where: { area_event_key: { area: input.area, event_key: input.eventKey } },
      });
      if (existing) return;
      const previous = await tx.education_lead_cycles.findFirst({
        where: { area: input.area, contact_id: input.contactId, started_at: { lte: input.occurredAt } },
        orderBy: [{ started_at: 'desc' }, { id: 'desc' }],
        include: { lead_status: true,
          assigned_user: { select: { first_name: true, last_name: true, email: true } } },
      });
      const { classification: intakeClass, assignmentRule, conflictReason } = classifyEducationIntake({
        occurredAt: input.occurredAt,
        previousInteractionAt: previous?.last_interaction_at,
        previousStatusSlug: previous?.lead_status?.slug,
      });

      let cycleId = previous?.id ?? null;
      const classification = intakeClass;
      if (classification === 'new') {
        const status = await tx.lead_status_definitions.findFirst({
          where: { area: input.area, is_default: true, active: true },
          select: { id: true },
        });
        const contactSnapshot = !previous ? await tx.contacts.findUnique({
          where: { id: input.contactId }, select: { lead_status_id: true, lead_score: true },
        }) : null;
        const existingConversation = !previous ? await tx.conversations.findFirst({
          where: { area: input.area, contact_id: input.contactId },
          orderBy: { id: 'desc' }, select: { assigned_user_id: true },
        }) : null;
        const cycle = await tx.education_lead_cycles.create({
          data: {
            area: input.area, contact_id: input.contactId,
            started_at: input.occurredAt, last_interaction_at: input.occurredAt,
            lead_status_id: contactSnapshot?.lead_status_id ?? status?.id ?? null,
            lead_score: contactSnapshot?.lead_score ?? null,
            assigned_user_id: previous?.assigned_user_id ?? existingConversation?.assigned_user_id ?? null,
            requires_review: Boolean(previous),
          },
        });
        cycleId = cycle.id;
        if (previous) {
          // Keep the previous advisor until a person confirms or changes ownership.
          if (previous.assigned_user_id) {
            await tx.conversations.updateMany({
              where: { area: input.area, contact_id: input.contactId,
                assigned_user_id: { not: previous.assigned_user_id } },
              data: { assigned_user_id: previous.assigned_user_id,
                assigned_at: new Date(), updated_at: new Date() },
            });
          }
          await tx.contacts.update({
            where: { id: input.contactId },
            data: { lead_status_id: status?.id ?? null, lead_status_updated_at: new Date(), lead_score: null },
          });
        }
      } else if (classification === 'duplicate' && previous &&
          input.occurredAt > previous.last_interaction_at) {
        await tx.education_lead_cycles.update({
          where: { id: previous.id },
          data: { last_interaction_at: input.occurredAt, updated_at: new Date() },
        });
      }
      await tx.education_lead_entries.create({
        data: {
          area: input.area, contact_id: input.contactId,
          origin_id: input.originId, cycle_id: cycleId,
          channel: input.channel, source_key: input.sourceKey, source_label: input.sourceLabel,
          event_key: input.eventKey, occurred_at: input.occurredAt,
          classification, assignment_rule: assignmentRule, conflict_reason: conflictReason,
          previous_assigned_user_id: previous?.assigned_user_id ?? null,
          previous_advisor_label: previous?.assigned_user ? advisorLabel(previous.assigned_user) : null,
          previous_status_label: previous?.lead_status?.label ?? null,
          previous_interaction_at: previous?.last_interaction_at ?? null,
        },
      });
    });
  }

  async listEntries(params: {
    area?: string; channel?: string; q?: string; view?: string;
    unassigned?: boolean; page?: number; limit?: number;
  }) {
    const areas = this.areas(params.area);
    const view = params.view || 'recent';
    if (!['recent', 'new_number', 'duplicate', 'reassignable', 'conflict', 'in_progress', 'all'].includes(view)) {
      throw new BadRequestException('Vista de leads inválida');
    }
    const cutoff = new Date(Date.now() - SIXTY_DAYS_MS);
    const q = String(params.q ?? '').trim();
    const base: Prisma.education_lead_entriesWhereInput = {
      area: { in: areas }, occurred_at: { gte: cutoff },
      classification: { not: 'dismissed' },
      ...(params.channel ? { channel: params.channel } : {}),
      ...(q ? { OR: [
        { contact: { is: { name: { contains: q, mode: 'insensitive' } } } },
        { contact: { is: { last_name: { contains: q, mode: 'insensitive' } } } },
        { contact: { is: { phone: { contains: q } } } },
        { contact: { is: { whatsapp_user_id: { contains: q, mode: 'insensitive' } } } },
        { contact: { is: { conversations: { some: { wa_username: { contains: q.replace(/^@/, ''), mode: 'insensitive' } } } } } },
        { origin: { is: { whatsapp_user_id: { contains: q, mode: 'insensitive' } } } },
        { source_label: { contains: q, mode: 'insensitive' } },
      ] } : {}),
    };
    const where: Prisma.education_lead_entriesWhereInput = {
      ...base,
      ...(view === 'duplicate' ? { classification: 'duplicate' } : {}),
      ...(view === 'new_number' ? { assignment_rule: 'new_number' } : {}),
      ...(view === 'reassignable' ? { assignment_rule: 'reassignable' } : {}),
      ...(view === 'conflict' ? { classification: 'conflict' } : {}),
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
          contact: { select: { id: true, name: true, last_name: true, phone: true,
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
      this.prisma.education_lead_entries.count({ where: { ...base, classification: 'conflict' } }),
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
        assigned_user_id: item.cycle?.assigned_user_id ?? null,
        requires_review: item.cycle?.requires_review ?? false,
        is_current_cycle: item.cycle_id !== null &&
          item.cycle_id === item.contact.education_lead_cycles[0]?.id,
        assigned_user_label: item.cycle?.assigned_user ? advisorLabel(item.cycle.assigned_user) : null,
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
    const [users, statuses] = await Promise.all([
      this.prisma.users.findMany({
        where: { is_provisioned: true,
          OR: [{ area: { in: EDUCATION_AREAS } }, { is_master: true },
            { user_areas: { some: { area: { in: EDUCATION_AREAS } } } }],
        },
        select: { id: true, email: true, first_name: true, last_name: true, area: true, is_master: true,
          user_areas: { select: { area: true } } },
        orderBy: { id: 'asc' },
      }),
      this.prisma.lead_status_definitions.findMany({
        where: { area: { in: EDUCATION_AREAS }, active: true },
        orderBy: [{ area: 'asc' }, { sort_order: 'asc' }],
        select: { id: true, area: true, label: true, slug: true, is_default: true },
      }),
    ]);
    return { advisors: users.map((user) => ({
      id: user.id, label: advisorLabel(user),
      areas: user.is_master ? EDUCATION_AREAS
        : [...new Set([user.area, ...user.user_areas.map((item) => item.area)])]
          .filter((area) => EDUCATION_AREAS.includes(area)),
    })), statuses };
  }

  async updateManagement(contactId: number, area: string, changes: {
    assigned_user_id?: number | null; lead_status_id?: number | null; actor_email?: string;
  }) {
    this.areas(area);
    const contact = await this.prisma.contacts.findFirst({ where: { id: contactId, area } });
    if (!contact) throw new NotFoundException('Contacto no encontrado');
    if (changes.assigned_user_id === null) {
      throw new BadRequestException('Para reasignar, selecciona otro asesor');
    }
    if (changes.assigned_user_id !== undefined && changes.assigned_user_id !== null) {
      const advisor = await this.prisma.users.findFirst({
        where: { id: changes.assigned_user_id, is_provisioned: true,
          OR: [{ area }, { is_master: true }, { user_areas: { some: { area } } }],
        }, select: { id: true },
      });
      if (!advisor) throw new BadRequestException('Asesor no habilitado para este número');
    }
    if (changes.lead_status_id !== undefined && changes.lead_status_id !== null) {
      const status = await this.prisma.lead_status_definitions.findFirst({
        where: { id: changes.lead_status_id, area, active: true }, select: { id: true },
      });
      if (!status) throw new BadRequestException('Estado no disponible para este número');
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(20260924::integer, ${contactId}::integer)`;
      let cycle = await tx.education_lead_cycles.findFirst({
        where: { contact_id: contactId, area }, orderBy: [{ started_at: 'desc' }, { id: 'desc' }],
      });
      if (!cycle) {
        cycle = await tx.education_lead_cycles.create({ data: {
          contact_id: contactId, area, started_at: contact.created_at,
          last_interaction_at: contact.created_at, lead_status_id: contact.lead_status_id,
          lead_score: contact.lead_score,
        } });
      }
      const previousAssigneeId = cycle.assigned_user_id;
      const previousStatusId = cycle.lead_status_id;
      cycle = await tx.education_lead_cycles.update({
        where: { id: cycle.id },
        data: {
          ...(changes.assigned_user_id !== undefined ? {
            assigned_user_id: changes.assigned_user_id,
            requires_review: false,
          } : {}),
          ...(changes.lead_status_id !== undefined ? { lead_status_id: changes.lead_status_id } : {}),
          updated_at: new Date(),
        },
      });
      if (changes.assigned_user_id !== undefined) {
        await tx.conversations.updateMany({
          where: { area, contact_id: contactId },
          data: { assigned_user_id: changes.assigned_user_id,
            assigned_at: new Date(), updated_at: new Date() },
        });
      }
      if (changes.lead_status_id !== undefined) {
        await tx.contacts.update({ where: { id: contactId }, data: {
          lead_status_id: changes.lead_status_id, lead_status_updated_at: new Date(), updated_at: new Date(),
        } });
      }
      if (changes.assigned_user_id !== undefined || changes.lead_status_id !== undefined) {
        await tx.audit_logs.create({ data: {
          event_type: 'education.lead.management',
          message: `Gestión del lead de contacto ${contactId}`,
          actor_email: changes.actor_email ?? 'mali-one@system', area,
          meta: {
            contact_id: contactId, cycle_id: cycle.id,
            from_assigned_user_id: previousAssigneeId,
            to_assigned_user_id: changes.assigned_user_id === undefined
              ? previousAssigneeId : changes.assigned_user_id,
            from_lead_status_id: previousStatusId,
            to_lead_status_id: changes.lead_status_id === undefined
              ? previousStatusId : changes.lead_status_id,
          },
        } });
      }
      return cycle;
    });
  }

  async distribute(params: { area?: string; channel?: string; q?: string; actor_email?: string }) {
    const areas = this.areas(params.area);
    const cutoff = new Date(Date.now() - SIXTY_DAYS_MS);
    const q = String(params.q ?? '').trim();
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(20260924::bigint)`;
      const result: Array<{ area: string; assigned: number }> = [];
      for (const currentArea of areas) {
        const advisors = await tx.users.findMany({
          where: { is_provisioned: true, role_slug: 'asesor_comercial',
            OR: [{ area: currentArea }, { user_areas: { some: { area: currentArea } } }],
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
          where: { area: currentArea, assignment_rule: 'new_number', occurred_at: { gte: cutoff },
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
            where: { id: entry.cycle_id, assigned_user_id: null },
            data: { assigned_user_id: advisor.id, requires_review: false, updated_at: new Date() },
          });
          if (!updated.count) continue;
          await tx.conversations.updateMany({
            where: { area: currentArea, contact_id: entry.contact_id },
            data: { assigned_user_id: advisor.id, assigned_at: new Date(), updated_at: new Date() },
          });
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
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(20260924::integer, ${entry.contact_id}::integer)`;
      const latestCycle = await tx.education_lead_cycles.findFirst({
        where: { contact_id: entry.contact_id, area },
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
        const cycle = await tx.education_lead_cycles.create({ data: {
          area, contact_id: entry.contact_id, started_at: entry.occurred_at,
          last_interaction_at: entry.occurred_at,
          lead_status_id: status?.id ?? null,
          assigned_user_id: latestCycle?.assigned_user_id ?? null,
          requires_review: true,
        } });
        cycleId = cycle.id;
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
}
