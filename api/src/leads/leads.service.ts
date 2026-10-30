import {
  Injectable,
  Logger,
  OnModuleInit,
  BadRequestException,
  ConflictException,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import {
  BUSINESS_AREAS,
  businessReadScope,
  normalizeArea,
  normalizeEmail,
  type BusinessArea,
} from '../config/areas';
import { programIdForCategory, programScopeWhere } from '../config/category-scope';
import {
  educationProgramOf,
  educationReadScope,
} from '../config/education-scope';
import {
  exactOpenCycleWhere,
  isEducationAttentionArea,
} from './education-lead-context.util';
import {
  E164_NO_PLUS_REGEX,
  normalizePhone,
} from '../contacts/contacts-validation.utils';
import { AuditEvent } from '../audit/audit-events';
import { auditActor } from '../audit/audit-actor.util';
import { AuditLogService } from '../audit/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { isWhatsAppBsuid } from '../conversations/whatsapp-recipient.util';
import { chooseWhatsAppIdentityMatch } from '../conversations/whatsapp-identity.util';
import { mergeComplementaryContacts } from '../contacts/merge-complementary-contacts.util';
import { PersonResolverService } from '../people/person-resolver.service';
import { EducationLeadWorkflowService } from './education-lead-workflow.service';
import { endLeadConversationLinks } from './education-lead-lifecycle.util';
import { MaliOneLinksCatalogService } from './mali-one-links-catalog.service';
import {
  cursoFromOriginPayload,
  payloadCursoPatch,
  payloadWithStandardCurso,
} from './lead-curso.util';
import { matchMaliOneWhatsappLink } from './mali-one-link-match.util';
import {
  type LeadChatEnrichInput,
  type ConversationHint,
  resolveLeadChatEnrichment,
} from './lead-origin.util';
import { formatExportDate } from '../campaigns/campaign-format.util';
import {
  buildLeadsOriginsExportBuffer,
  leadsOriginsExportFilename,
} from './leads-export.util';
import { syncEducationLeadStatuses, isEducationLeadArea } from './education-lead-statuses';
import {
  addDaysYmd,
  getReportDisplayTimeZone,
  isYmdDate,
} from '../reports/report-date-range.util';
import {
  DEFAULT_LEAD_STATUSES,
  type ContactIdentityInput,
  type LeadChannel,
  type UpsertOriginInput,
} from './leads.types';

/** Midnight of `ymd` in the report display TZ, as a UTC instant. */
function displayYmdMidnightUtc(ymd: string): Date {
  const timeZone = getReportDisplayTimeZone();
  const approx = new Date(`${ymd}T00:00:00.000Z`);
  const tzName =
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'longOffset',
    })
      .formatToParts(approx)
      .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const m = /GMT([+-]\d{2}):?(\d{2})?/.exec(tzName);
  if (!m) return approx;
  const sign = m[1].startsWith('-') ? -1 : 1;
  const hours = Math.abs(Number.parseInt(m[1], 10));
  const mins = m[2] ? Number.parseInt(m[2], 10) : 0;
  const offsetMin = sign * (hours * 60 + mins);
  return new Date(approx.getTime() - offsetMin * 60_000);
}

/** Inclusive YMD window on capture time `first_seen_at` (display calendar days). */
function originsFirstSeenFilter(
  fromRaw?: string,
  toRaw?: string,
): Prisma.DateTimeFilter | undefined {
  const from = isYmdDate(fromRaw) ? String(fromRaw).trim() : null;
  const to = isYmdDate(toRaw) ? String(toRaw).trim() : null;
  if (!from && !to) return undefined;
  const filter: Prisma.DateTimeFilter = {};
  if (from) filter.gte = displayYmdMidnightUtc(from);
  if (to) filter.lt = displayYmdMidnightUtc(addDaysYmd(to, 1));
  return filter;
}

function leadCategoryOf(item: {
  program?: { slug: string } | null;
  conversations?: {
    whatsapp_line?: {
      label?: string | null;
      display_phone_number?: string | null;
      program_key?: string | null;
      program?: { slug: string } | null;
    } | null;
  } | null;
}): { categoria: string; linea: string } {
  const line = item.conversations?.whatsapp_line;
  const slug = String(
    item.program?.slug || line?.program?.slug || line?.program_key || 'general',
  )
    .trim()
    .toLowerCase() || 'general';
  return {
    categoria: slug,
    linea: [line?.label, line?.display_phone_number].filter(Boolean).join(' · '),
  };
}

@Injectable()
export class LeadsService implements OnModuleInit {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly educationWorkflow: EducationLeadWorkflowService,
    private readonly auditLog: AuditLogService,
    @Optional() private readonly maliOneLinks?: MaliOneLinksCatalogService,
    @Optional() private readonly people?: PersonResolverService,
  ) {}

  onModuleInit(): void {
    void this.backfillFormCurso().catch((error) => {
      this.logger.warn(
        `Backfill de curso falló: ${error instanceof Error ? error.message : error}`,
      );
    });
  }

  /**
   * Escribe `payload.curso` en Instant Forms de Meta y TikTok que lo tienen vacío
   * y cuya pregunta de curso o programa ya está en el payload. Idempotente.
   */
  async backfillFormCurso(): Promise<{ scanned: number; updated: number }> {
    let cursor = 0;
    let scanned = 0;
    let updated = 0;
    for (;;) {
      const rows = await this.prisma.contact_origins.findMany({
        where: {
          id: { gt: cursor },
          channel: { in: ['meta_lead_form', 'tiktok'] },
        },
        select: { id: true, payload: true },
        orderBy: { id: 'asc' },
        take: 200,
      });
      if (!rows.length) break;
      cursor = rows[rows.length - 1].id;
      scanned += rows.length;
      for (const row of rows) {
        const next = payloadCursoPatch(row.payload);
        if (!next) continue;
        await this.prisma.contact_origins.update({
          where: { id: row.id },
          data: {
            payload: next as Prisma.InputJsonValue,
            updated_at: new Date(),
          },
        });
        updated += 1;
      }
    }
    this.logger.log(`Backfill de curso: scanned=${scanned}, updated=${updated}`);
    return { scanned, updated };
  }

  private educationAreas(area?: string): string[] {
    const allowed = ['educacion', 'educacion_ca', 'educacion_ep'];
    const selected = String(area ?? 'all').trim().toLowerCase() || 'all';
    if (selected !== 'all' && !allowed.includes(selected)) {
      throw new BadRequestException(`Área de educación inválida: ${area}`);
    }
    return selected === 'all' ? allowed : [selected];
  }

  private async educationProgramId(area: string): Promise<number | null> {
    const slug = educationProgramOf(area);
    if (!slug) return null;
    const program = await this.prisma.business_programs.findFirst({
      where: { slug, active: true, business_area: { slug: 'educacion' } },
      select: { id: true },
    });
    if (!program) throw new BadRequestException('Categoría no válida');
    return program.id;
  }

  private async attachEducationProgram(
    contactId: number | null,
    area: string,
  ): Promise<number | null> {
    const programId = await this.educationProgramId(area);
    if (!contactId || !programId) return programId;
    const program = { id: programId };
    await this.prisma.contact_programs.upsert({
      where: {
        contact_id_program_id: {
          contact_id: contactId,
          program_id: program.id,
        },
      },
      create: {
        contact_id: contactId,
        program_id: program.id,
        source: 'alias',
      },
      update: { last_seen_at: new Date() },
    });
    return programId;
  }

  async listEducationOrigins(params: {
    area?: string;
    channel?: string;
    q?: string;
    page?: number;
    limit?: number;
  }) {
    const scope = educationReadScope(params.area);
    if (
      params.area
      && params.area !== 'all'
      && !scope.areas.includes('educacion')
    ) {
      throw new BadRequestException(`Área de educación inválida: ${params.area}`);
    }
    const areas = scope.areas.includes('educacion') ? scope.areas : this.educationAreas(params.area);
    const program = scope.program;
    const page = params.page ?? 1;
    const limit = params.limit ?? 50;
    const q = String(params.q ?? '').trim();
    const usernameQ = q.replace(/^@/, '');
    const and: Prisma.contact_originsWhereInput[] = [];
    if (program) {
      const legacy = program === 'ca' ? 'educacion_ca' : program === 'ep' ? 'educacion_ep' : null;
      and.push({
        OR: [
          ...(legacy ? [{ area: legacy }] : []),
          { program: { slug: program } },
          {
            contacts: {
              is: {
                contact_programs: { some: { program: { slug: program } } },
              },
            },
          },
        ],
      });
    }
    if (q) {
      and.push({
        OR: [
          { phone: { contains: q } },
          { whatsapp_user_id: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
          { dni: { contains: q, mode: 'insensitive' } },
          { source_key: { contains: q, mode: 'insensitive' } },
          { source_label: { contains: q, mode: 'insensitive' } },
          { contacts: { is: { name: { contains: q, mode: 'insensitive' } } } },
          { contacts: { is: { last_name: { contains: q, mode: 'insensitive' } } } },
          { conversations: { is: { wa_username: { contains: usernameQ, mode: 'insensitive' } } } },
        ],
      });
    }
    const where: Prisma.contact_originsWhereInput = {
      area: { in: areas },
      ...(params.channel ? { channel: params.channel } : {}),
      ...(and.length ? { AND: and } : {}),
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.contact_origins.count({ where }),
      this.prisma.contact_origins.findMany({
        where,
        orderBy: [{ last_seen_at: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          area: true,
          channel: true,
          source_key: true,
          source_label: true,
          phone: true,
          email: true,
          contact_id: true,
          whatsapp_user_id: true,
          first_seen_at: true,
          last_seen_at: true,
          contacts: {
            select: {
              id: true,
              name: true,
              last_name: true,
              phone: true,
              whatsapp_user_id: true,
              email: true,
              lead_status: { select: { label: true } },
            },
          },
        },
      }),
    ]);
    return { items, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async recordEducationOrganicOrigin(input: {
    area: string;
    conversationId: number;
    contactId: number | null;
    phone: string | null;
    whatsappUserId: string | null;
    name?: string | null;
    seenAt: Date;
    messageId?: number;
  }): Promise<void> {
    if (!this.educationAreas().includes(input.area)) return;
    const conversation = await this.prisma.conversations.findFirst({
      where: { id: input.conversationId },
      select: { whatsapp_line: { select: { program: { select: { slug: true } } } } },
    });
    const attribution = await this.prisma.contact_origins.findFirst({
      where: {
        area: input.area,
        channel: { not: 'organic_wa' },
        OR: [
          { conversation_id: input.conversationId },
          ...(input.contactId ? [{ contact_id: input.contactId }] : []),
        ],
      },
      orderBy: { last_seen_at: 'desc' },
      select: { id: true, contact_id: true, channel: true,
        source_key: true, source_label: true, last_seen_at: true },
    });
    const firstInbound = await this.prisma.chat_messages.findFirst({
      where: { conversation_id: input.conversationId, direction: 'inbound' },
      orderBy: { created_at: 'asc' },
      select: { created_at: true },
    });
    const result = attribution ? null : await this.upsertOrigin({
      area: input.area,
      channel: 'organic_wa',
      external_id: `conversation:${input.conversationId}`,
      source_label: 'WhatsApp orgánico',
      conversation_id: input.conversationId,
      program_slug: conversation?.whatsapp_line?.program?.slug ?? null,
      first_seen_at: firstInbound?.created_at ?? input.seenAt,
      last_seen_at: input.seenAt,
      phone: input.phone,
      whatsapp_user_id: input.whatsappUserId,
      contact: {
        phone: input.phone,
        whatsapp_user_id: input.whatsappUserId,
        name: input.name,
      },
    });
    const message = input.messageId ? { id: input.messageId } : await this.prisma.chat_messages.findFirst({
      where: { conversation_id: input.conversationId, direction: 'inbound', created_at: input.seenAt },
      orderBy: { id: 'desc' }, select: { id: true },
    });
    const recentAttribution = attribution &&
      input.seenAt.getTime() - attribution.last_seen_at.getTime() < 24 * 60 * 60 * 1000
      ? attribution : null;
    if (message) await this.educationWorkflow.recordInbound({
      area: input.area, contactId: result?.contact_id ?? input.contactId ?? attribution?.contact_id ?? null,
      conversationId: input.conversationId, messageId: message.id,
      originId: result?.origin_id ?? recentAttribution?.id,
      channel: recentAttribution?.channel ?? 'organic_wa',
      sourceKey: recentAttribution?.source_key,
      sourceLabel: recentAttribution?.source_label,
      occurredAt: input.seenAt,
    });
  }

  /**
   * Pasa a mali_one_link los orígenes orgánicos cuyo primer inbound coincide
   * con el catálogo. No abre ciclos ni vuelve a consultar Prospectia.
   * Sin `apply` solo cuenta.
   */
  async backfillOrganicMaliOneLinks(opts?: { apply?: boolean }): Promise<{
    catalog: number;
    scanned: number;
    matched: number;
    ambiguous: number;
    updated: number;
    entries_updated: number;
    sample: Array<{ area: string; conversation_id: number; slug: string; source_label: string }>;
  }> {
    const apply = Boolean(opts?.apply);
    if (!this.maliOneLinks) {
      throw new BadRequestException('El catálogo de links MALI ONE no está disponible');
    }
    const catalog = await this.maliOneLinks.getCatalog();
    if (!catalog.length) {
      throw new BadRequestException('El catálogo de links MALI ONE está vacío');
    }
    const origins = await this.prisma.contact_origins.findMany({
      where: {
        channel: 'organic_wa',
        conversation_id: { not: null },
        area: { in: this.educationAreas() },
      },
      select: { id: true, area: true, conversation_id: true },
    });
    const byConversation = new Map<number, { id: number; body_text: string | null }>();
    const conversationIds = origins
      .map((row) => row.conversation_id)
      .filter((id): id is number => id != null);
    for (let i = 0; i < conversationIds.length; i += 400) {
      const chunk = conversationIds.slice(i, i + 400);
      const rows = await this.prisma.$queryRaw<Array<{
        conversation_id: number;
        id: number;
        body_text: string | null;
      }>>(Prisma.sql`
        SELECT DISTINCT ON (conversation_id) conversation_id, id, body_text
        FROM chat_messages
        WHERE direction = 'inbound'
          AND conversation_id IN (${Prisma.join(chunk)})
        ORDER BY conversation_id, created_at ASC, id ASC
      `);
      for (const row of rows) byConversation.set(row.conversation_id, row);
    }

    let matched = 0;
    let ambiguous = 0;
    let updated = 0;
    let entriesUpdated = 0;
    const sample: Array<{ area: string; conversation_id: number; slug: string; source_label: string }> = [];
    for (const origin of origins) {
      const conversationId = origin.conversation_id;
      if (conversationId == null) continue;
      const first = byConversation.get(conversationId);
      const hit = matchMaliOneWhatsappLink(first?.body_text ?? '', catalog);
      if (!hit) continue;
      if (hit.ambiguous) {
        ambiguous += 1;
        continue;
      }
      matched += 1;
      const sourceLabel = (hit.tags[0] || hit.slug).slice(0, 200);
      if (sample.length < 30) {
        sample.push({
          area: origin.area,
          conversation_id: conversationId,
          slug: hit.slug,
          source_label: sourceLabel,
        });
      }
      if (!apply) continue;
      const externalId = `${hit.slug}:${conversationId}`.slice(0, 128);
      const payload = {
        slug: hit.slug,
        tags: hit.tags,
        match: hit.match,
        ambiguous: false,
        backfill: true,
      };
      const entryData = {
        channel: 'mali_one_link',
        source_key: hit.slug,
        source_label: sourceLabel,
      };
      const moved = await this.prisma.$transaction(async (tx) => {
        const clash = await tx.contact_origins.findUnique({
          where: {
            area_channel_external_id: {
              area: origin.area,
              channel: 'mali_one_link',
              external_id: externalId,
            },
          },
          select: { id: true },
        });
        const originId = clash?.id ?? origin.id;
        if (!clash) {
          await tx.contact_origins.update({
            where: { id: origin.id },
            data: {
              channel: 'mali_one_link',
              external_id: externalId,
              source_key: hit.slug,
              source_label: sourceLabel,
              payload: payload as Prisma.InputJsonValue,
              updated_at: new Date(),
            },
          });
        }
        const entries = await tx.education_lead_entries.updateMany({
          where: { origin_id: origin.id, channel: 'organic_wa' },
          data: { ...entryData, ...(clash ? { origin_id: originId } : {}) },
        });
        let entryCount = entries.count;
        if (first?.id) {
          const loose = await tx.education_lead_entries.updateMany({
            where: {
              area: origin.area,
              channel: 'organic_wa',
              origin_id: null,
              event_key: `inbound:${first.id}`,
            },
            data: { ...entryData, origin_id: originId },
          });
          entryCount += loose.count;
        }
        if (clash && clash.id !== origin.id) {
          await tx.contact_origins.delete({ where: { id: origin.id } });
        }
        return entryCount;
      });
      updated += 1;
      entriesUpdated += moved;
    }
    return {
      catalog: catalog.length,
      scanned: origins.length,
      matched,
      ambiguous,
      updated: apply ? updated : 0,
      entries_updated: apply ? entriesUpdated : 0,
      sample,
    };
  }

  normalizeOptionalPhone(value: unknown): string | null {
    const phone = normalizePhone(value);
    if (!phone) return null;
    if (!E164_NO_PLUS_REGEX.test(phone)) {
      throw new BadRequestException('Teléfono inválido. Usa formato E.164 sin +');
    }
    return phone;
  }

  normalizeOptionalDni(value: unknown): string | null {
    const dni = String(value ?? '')
      .trim()
      .replace(/\s+/g, '');
    return dni || null;
  }

  normalizeOptionalEmail(value: unknown): string | null {
    const email = normalizeEmail(value);
    if (!email) return null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('Email inválido');
    }
    return email;
  }

  assertHasIdentity(input: ContactIdentityInput): void {
    const phone = input.phone ? normalizePhone(input.phone) : '';
    const userId = String(input.whatsapp_user_id ?? '').trim();
    if (userId && !isWhatsAppBsuid(userId)) {
      throw new BadRequestException('Identidad de WhatsApp inválida');
    }
    const dni = String(input.dni ?? '').trim();
    const email = normalizeEmail(input.email);
    if (!phone && !userId && !dni && !email) {
      throw new BadRequestException(
        'Se requiere al menos uno de: phone, BSUID, dni o email',
      );
    }
  }

  async ensureDefaultStatuses(area: BusinessArea): Promise<void> {
    if (isEducationLeadArea(area)) {
      await syncEducationLeadStatuses(this.prisma, area);
      return;
    }
    const count = await this.prisma.lead_status_definitions.count({
      where: { area },
    });
    if (count > 0) return;
    await this.prisma.lead_status_definitions.createMany({
      data: DEFAULT_LEAD_STATUSES.map((s) => ({
        area,
        slug: s.slug,
        label: s.label,
        sort_order: s.sort_order,
        is_default: s.is_default,
        is_terminal: s.is_terminal,
      })),
      skipDuplicates: true,
    });
  }

  async getDefaultStatusId(area: string): Promise<number | null> {
    const areaNorm = normalizeArea(area);
    await this.ensureDefaultStatuses(areaNorm);
    const row = await this.prisma.lead_status_definitions.findFirst({
      where: { area: areaNorm, is_default: true, active: true },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  /**
   * Resolve contact by BSUID → phone → dni → email within area. Creates if missing.
   * `overwriteName`: Instant Form / fuentes con nombre declarado pisan alias de WA.
   */
  async resolveContact(
    area: string,
    input: ContactIdentityInput,
    opts?: { overwriteName?: boolean },
  ): Promise<{ contact_id: number; created: boolean }> {
    const areaNorm = normalizeArea(area);
    this.assertHasIdentity(input);
    if (this.people) {
      const resolved = await this.people.resolve(this.prisma, {
        area: areaNorm,
        name: input.name,
        last_name: input.last_name,
        phone: input.phone,
        whatsapp_user_id: input.whatsapp_user_id,
        email: input.email,
        dni: input.dni,
        opt_in: input.opt_in,
        opt_in_email: input.opt_in_email,
        overwriteName: opts?.overwriteName,
      });
      const phone = input.phone ? this.normalizeOptionalPhone(input.phone) : null;
      const userId = String(input.whatsapp_user_id ?? '').trim() || null;
      await this.linkConversationsToContact(areaNorm, phone, userId, resolved.contact_id);
      return { contact_id: resolved.contact_id, created: resolved.created };
    }

    const phone = input.phone
      ? this.normalizeOptionalPhone(input.phone)
      : null;
    const userId = String(input.whatsapp_user_id ?? '').trim() || null;
    const dni = this.normalizeOptionalDni(input.dni);
    const email = input.email
      ? this.normalizeOptionalEmail(input.email)
      : null;

    const byUserId = userId
      ? await this.prisma.contacts.findFirst({
          where: { area: areaNorm, whatsapp_user_id: userId },
        })
      : null;
    const byPhone = phone
      ? await this.prisma.contacts.findFirst({
          where: { area: areaNorm, phone },
        })
      : null;

    let resolvedPair = chooseWhatsAppIdentityMatch(byUserId, byPhone, userId);
    if (
      resolvedPair.conflict === 'complementary' &&
      byUserId &&
      byPhone
    ) {
      const merged = await this.prisma.$transaction((tx) =>
        mergeComplementaryContacts(tx, areaNorm, byUserId, byPhone),
      );
      this.logger.log(
        `resolveContact: merge complementario keep=${merged.keepId} drop=${merged.dropId} area=${areaNorm}`,
      );
      const keep = await this.prisma.contacts.findFirst({
        where: { id: merged.keepId },
      });
      resolvedPair = { match: keep, conflict: 'none' };
    } else if (resolvedPair.conflict === 'hard') {
      throw new ConflictException(
        'El teléfono y la identidad de WhatsApp pertenecen a contactos distintos',
      );
    }
    if (
      !byUserId &&
      byPhone?.whatsapp_user_id &&
      userId &&
      byPhone.whatsapp_user_id !== userId
    ) {
      throw new ConflictException(
        'El teléfono pertenece a otra identidad de WhatsApp',
      );
    }

    const existing =
      resolvedPair.match ??
      (dni
        ? await this.prisma.contacts.findFirst({
            where: { area: areaNorm, dni },
          })
        : null) ??
      (email
        ? await this.prisma.contacts.findFirst({
            where: { area: areaNorm, email },
          })
        : null);

    const name =
      String(input.name ?? '').trim() ||
      (email ? email.split('@')[0] : '') ||
      '';
    const last_name = String(input.last_name ?? '').trim();
    const defaultStatusId = await this.getDefaultStatusId(areaNorm);

    if (existing) {
      const data: Prisma.contactsUpdateInput = {
        updated_at: new Date(),
      };
      if (!existing.phone && phone) data.phone = phone;
      if (!existing.whatsapp_user_id && userId) data.whatsapp_user_id = userId;
      if (!existing.dni && dni) data.dni = dni;
      if (!existing.email && email) data.email = email;
      const incomingName = String(input.name ?? '').trim();
      if (opts?.overwriteName && incomingName) {
        // Formulario / fuente explícita: gana sobre alias WA guardado en el contacto
        data.name = incomingName.slice(0, 150);
        if (last_name) data.last_name = last_name.slice(0, 150);
      } else if (!existing.name || existing.name === 'Lead') {
        // Vacío (o limpiar placeholder) para que Chats use wa_profile_name / teléfono
        data.name = incomingName || name || '';
        if (!existing.last_name && last_name) data.last_name = last_name;
      } else if (!existing.last_name && last_name) {
        data.last_name = last_name;
      }
      if (existing.lead_status_id == null && defaultStatusId) {
        data.lead_status = { connect: { id: defaultStatusId } };
        data.lead_status_updated_at = new Date();
      }
      if (input.opt_in !== undefined) data.opt_in = input.opt_in;
      if (input.opt_in_email !== undefined) data.opt_in_email = input.opt_in_email;

      await this.prisma.contacts.update({
        where: { id: existing.id },
        data,
      });
      await this.linkConversationsToContact(
        areaNorm,
        phone || existing.phone,
        userId || existing.whatsapp_user_id,
        existing.id,
      );
      return { contact_id: existing.id, created: false };
    }

    const created = await this.prisma.contacts.create({
      data: {
        area: areaNorm,
        name: name.slice(0, 150),
        last_name: last_name.slice(0, 150),
        phone,
        whatsapp_user_id: userId,
        dni,
        email,
        opt_in: input.opt_in ?? true,
        opt_in_email: input.opt_in_email ?? Boolean(email),
        lead_status_id: defaultStatusId,
        lead_status_updated_at: defaultStatusId ? new Date() : null,
        updated_at: new Date(),
      },
    });
    await this.linkConversationsToContact(areaNorm, phone, userId, created.id);
    return { contact_id: created.id, created: true };
  }

  /** Enlaza chats del área con la misma identidad que aún no tienen contacto. */
  private async linkConversationsToContact(
    area: string,
    phone: string | null,
    userId: string | null,
    contactId: number,
  ): Promise<void> {
    const or: Prisma.conversationsWhereInput[] = [];
    if (phone) or.push({ phone });
    if (userId) or.push({ whatsapp_user_id: userId });
    if (!or.length) return;
    await this.prisma.conversations.updateMany({
      where: { area, contact_id: null, OR: or },
      data: { contact_id: contactId, updated_at: new Date() },
    });
  }

  async upsertOrigin(input: UpsertOriginInput): Promise<{
    origin_id: number;
    contact_id: number | null;
    created: boolean;
  }> {
    const area = normalizeArea(input.area);
    const external_id = String(input.external_id ?? '').trim();
    if (!external_id) {
      throw new BadRequestException('external_id requerido');
    }

    const identity: ContactIdentityInput = {
      phone: input.contact?.phone ?? input.phone,
      whatsapp_user_id:
        input.contact?.whatsapp_user_id ?? input.whatsapp_user_id,
      dni: input.contact?.dni ?? input.dni,
      email: input.contact?.email ?? input.email,
      name: input.contact?.name,
      last_name: input.contact?.last_name,
      opt_in: input.contact?.opt_in,
      opt_in_email: input.contact?.opt_in_email,
    };

    let contact_id: number | null = null;
    let programId: number | null = null;
    try {
      this.assertHasIdentity(identity);
      const resolved = await this.resolveContact(area, identity, {
        // Instant Form trae nombre real; no dejar el alias WA que a veces se guardó en CTWA
        overwriteName:
          input.channel === 'meta_lead_form' || input.channel === 'tiktok',
      });
      contact_id = resolved.contact_id;
      programId = await this.attachEducationProgram(
        contact_id,
        input.program_slug || area,
      );
    } catch (err) {
      if (!(err instanceof BadRequestException)) throw err;
      // allow origin without contact only if truly no identity — still throw
      throw err;
    }

    const phone = identity.phone
      ? normalizePhone(identity.phone) || null
      : null;
    const whatsapp_user_id =
      String(identity.whatsapp_user_id ?? '').trim() || null;
    const dni = this.normalizeOptionalDni(identity.dni);
    const email = identity.email
      ? normalizeEmail(identity.email) || null
      : null;

    const existing = await this.prisma.contact_origins.findUnique({
      where: {
        area_channel_external_id: {
          area,
          channel: input.channel,
          external_id,
        },
      },
    });

    const payload =
      input.payload === undefined
        ? undefined
        : (input.payload as Prisma.InputJsonValue);

    if (existing) {
      const row = await this.prisma.contact_origins.update({
        where: { id: existing.id },
        data: {
          contact_id: contact_id ?? existing.contact_id,
          source_key: input.source_key ?? existing.source_key,
          source_label: input.source_label ?? existing.source_label,
          payload: payload ?? undefined,
          phone: phone ?? existing.phone,
          whatsapp_user_id:
            whatsapp_user_id ?? existing.whatsapp_user_id,
          dni: dni ?? existing.dni,
          email: email ?? existing.email,
          conversation_id:
            input.conversation_id ?? existing.conversation_id,
          program_id: programId ?? existing.program_id,
          first_seen_at: input.first_seen_at && input.first_seen_at < existing.first_seen_at
            ? input.first_seen_at : existing.first_seen_at,
          last_seen_at: input.last_seen_at ?? new Date(),
          updated_at: new Date(),
        },
      });
      if (input.channel !== 'organic_wa') {
        await this.educationWorkflow.recordOrigin(row.id);
      }
      return { origin_id: row.id, contact_id: row.contact_id, created: false };
    }

    const row = await this.prisma.contact_origins.create({
      data: {
        area,
        contact_id,
        channel: input.channel,
        external_id,
        source_key: input.source_key ?? null,
        source_label: input.source_label ?? null,
        payload: payload ?? Prisma.JsonNull,
        phone,
        whatsapp_user_id,
        dni,
        email,
        program_id: programId,
        conversation_id: input.conversation_id ?? null,
        ...(input.first_seen_at ? { first_seen_at: input.first_seen_at } : {}),
        ...(input.last_seen_at ? { last_seen_at: input.last_seen_at } : {}),
      },
    });
    if (input.channel !== 'organic_wa') {
      await this.educationWorkflow.recordOrigin(row.id);
    }
    return { origin_id: row.id, contact_id: row.contact_id, created: true };
  }

  async listStatuses(area: string, opts?: { includeInactive?: boolean }) {
    const areaNorm = normalizeArea(area);
    await this.ensureDefaultStatuses(areaNorm);
    return this.prisma.lead_status_definitions.findMany({
      where: { area: areaNorm, ...(opts?.includeInactive ? {} : { active: true }) },
      orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
    });
  }

  async createStatus(
    area: string,
    body: {
      slug: string;
      label: string;
      sort_order?: number;
      is_default?: boolean;
      is_terminal?: boolean;
    },
  ) {
    const areaNorm = normalizeArea(area);
    const slug = String(body.slug ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_');
    const label = String(body.label ?? '').trim();
    if (!slug || !label) {
      throw new BadRequestException('slug y label requeridos');
    }
    return this.prisma.$transaction(async (tx) => {
      if (body.is_default) {
        await tx.lead_status_definitions.updateMany({
          where: { area: areaNorm, is_default: true },
          data: { is_default: false, updated_at: new Date() },
        });
      }
      return tx.lead_status_definitions.create({
        data: {
          area: areaNorm,
          slug,
          label,
          sort_order: body.sort_order ?? 100,
          is_default: Boolean(body.is_default),
          is_terminal: Boolean(body.is_terminal),
        },
      });
    });
  }

  async updateStatus(
    area: string,
    id: number,
    body: {
      label?: string;
      sort_order?: number;
      is_default?: boolean;
      is_terminal?: boolean;
      active?: boolean;
    },
  ) {
    const areaNorm = normalizeArea(area);
    const existing = await this.prisma.lead_status_definitions.findFirst({
      where: { id, area: areaNorm },
    });
    if (!existing) throw new NotFoundException('Estado no encontrado');

    const label = body.label !== undefined ? String(body.label).trim() : undefined;
    if (label !== undefined && !label) {
      throw new BadRequestException('La etiqueta es requerida');
    }
    if (existing.is_default && body.is_default === false) {
      throw new BadRequestException(
        'Define otro estado inicial antes de quitar el actual',
      );
    }
    if (existing.is_default && body.active === false) {
      throw new BadRequestException(
        'Define otro estado inicial antes de desactivar el actual',
      );
    }
    if (
      body.is_default === true &&
      (body.active === false || (body.active === undefined && !existing.active))
    ) {
      throw new BadRequestException('El estado inicial debe estar activo');
    }

    return this.prisma.$transaction(async (tx) => {
      if (body.is_default === true) {
        await tx.lead_status_definitions.updateMany({
          where: { area: areaNorm, is_default: true, NOT: { id } },
          data: { is_default: false, updated_at: new Date() },
        });
      }

      return tx.lead_status_definitions.update({
        where: { id },
        data: {
          label,
          sort_order: body.sort_order,
          is_default: body.is_default,
          is_terminal: body.is_terminal,
          active: body.active,
          updated_at: new Date(),
        },
      });
    });
  }

  async setContactStatus(
    area: string,
    contactId: number,
    statusId: number,
    opts?: {
      leadId?: number | null;
      category?: string | null;
      conversationId?: number | null;
      user?: AuthUser;
    },
  ) {
    const areaNorm = normalizeArea(area);
    const contact = await this.prisma.contacts.findFirst({
      where: { id: contactId, area: areaNorm },
      include: { lead_status: { select: { id: true, label: true } } },
    });
    if (!contact) throw new NotFoundException('Contacto no encontrado');
    const previousStatus = contact.lead_status;
    const status = await this.prisma.lead_status_definitions.findFirst({
      where: { id: statusId, area: areaNorm, active: true },
    });
    if (!status) throw new NotFoundException('Estado no encontrado');
    const programId =
      opts?.category != null
        ? await programIdForCategory(
            (slug) =>
              this.prisma.business_programs.findFirst({
                where: {
                  slug,
                  active: true,
                  business_area: { slug: 'educacion' },
                },
                select: { id: true },
              }),
            opts.category,
          )
        : undefined;
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${contact.person_id}::integer, ${programId ?? opts?.leadId ?? 0}::integer)`;
      const row = await tx.contacts.update({
        where: { id: contactId },
        data: {
          lead_status_id: statusId,
          lead_status_updated_at: new Date(),
          updated_at: new Date(),
        },
        include: { lead_status: true },
      });
      if (isEducationAttentionArea(areaNorm)) {
        let cycle: {
          id: number;
          area: string;
          program_id: number | null;
          program: { slug: string } | null;
        } | null = null;
        if (opts?.leadId) {
          cycle = await tx.education_lead_cycles.findFirst({
            where: {
              id: opts.leadId,
              person_id: contact.person_id,
              closed_at: null,
            },
            select: {
              id: true,
              area: true,
              program_id: true,
              program: { select: { slug: true } },
            },
          });
          if (!cycle) {
            throw new BadRequestException(
              'Lead no encontrado o ya cerrado para este contacto',
            );
          }
        } else if (programId !== undefined) {
          cycle = await tx.education_lead_cycles.findFirst({
            where: exactOpenCycleWhere({
              personId: contact.person_id,
              area: areaNorm,
              programId,
            }),
            orderBy: [{ started_at: 'desc' }, { id: 'desc' }],
            select: {
              id: true,
              area: true,
              program_id: true,
              program: { select: { slug: true } },
            },
          });
        } else {
          const openCycles = await tx.education_lead_cycles.findMany({
            where: {
              person_id: contact.person_id,
              closed_at: null,
              area: { in: this.educationAreas() },
            },
            orderBy: [{ started_at: 'desc' }, { id: 'desc' }],
            take: 2,
            select: {
              id: true,
              area: true,
              program_id: true,
              program: { select: { slug: true } },
            },
          });
          if (openCycles.length > 1) {
            throw new BadRequestException(
              'Indica lead_id o category: hay más de una oportunidad abierta',
            );
          }
          cycle = openCycles[0] ?? null;
        }
        if (cycle && opts?.user && this.educationWorkflow) {
          this.educationWorkflow.assertCanAccessLeadContext(opts.user, cycle);
        }
        if (cycle) {
          const now = new Date();
          await tx.education_lead_cycles.update({
            where: { id: cycle.id },
            data: {
              lead_status_id: statusId,
              updated_at: now,
              ...(status.is_terminal
                ? {
                    closed_at: now,
                    close_reason:
                      status.slug === 'venta_exitosa' || status.slug === 'convertido'
                        ? 'sold'
                        : status.slug === 'perdido' || status.slug === 'no_interesado'
                          ? 'lost'
                          : 'terminal_status',
                  }
                : {}),
            },
          });
          if (status.is_terminal) await endLeadConversationLinks(tx, cycle.id, now);
        }
      }
      return row;
    });

    if (opts?.user && previousStatus?.id !== statusId) {
      await this.auditLog.write({
        event_type: AuditEvent.CONTACT_LEAD_STATUS,
        message: `Estado del lead → ${status.label} (contacto ${contactId})`,
        actor: auditActor(opts.user),
        meta: {
          contact_id: contactId,
          conversation_id: opts.conversationId ?? null,
          from_status_id: previousStatus?.id ?? null,
          from_status_label: previousStatus?.label ?? null,
          to_status_id: status.id,
          to_status_label: status.label,
        },
      });
    }

    return updated;
  }

  async channelSummary(area: string, categories: string[] | null = null) {
    const scope = businessReadScope(area);
    const programs = (categories ?? []).filter((slug) => slug !== 'general');
    const programIds = programs.length
      ? (
          await this.prisma.business_programs.findMany({
            where: {
              slug: { in: programs },
              business_area: { slug: 'educacion' },
            },
            select: { id: true },
          })
        ).map((row) => row.id)
      : [];
    const categoryOr = [
      ...(categories?.includes('general') ? [{ program_id: null }] : []),
      ...(programIds.length ? [{ program_id: { in: programIds } }] : []),
    ];
    const categoryWhere = !categories?.length
      ? {}
      : categoryOr.length
        ? { OR: categoryOr }
        : { id: -1 };
    const rows = await this.prisma.contact_origins.groupBy({
      by: ['channel'],
      where: { area: { in: scope.areas }, ...categoryWhere },
      _count: { _all: true },
      _max: { last_seen_at: true },
    });
    return rows.map((r) => ({
      channel: r.channel as LeadChannel,
      count: r._count._all,
      last_seen_at: r._max.last_seen_at,
    }));
  }

  async listOrigins(params: {
    area: string;
    channel?: string;
    q?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
    /** UI stays at 200; export may raise (hard cap 10_000). */
    maxLimit?: number;
    categories?: string[] | null;
  }) {
    const scope = businessReadScope(params.area);
    const maxLimit = Math.min(Math.max(params.maxLimit ?? 200, 1), 10_000);
    const take = Math.min(Math.max(params.limit ?? 50, 1), maxLimit);
    const skip = Math.max(params.offset ?? 0, 0);
    const q = String(params.q ?? '').trim();
    const usernameQ = q.replace(/^@/, '');
    const filters: Prisma.contact_originsWhereInput[] = [
      { area: { in: scope.areas } },
    ];
    const categoryWhere = programScopeWhere(params.categories ?? null);
    if (Object.keys(categoryWhere).length) filters.push(categoryWhere);
    if (params.channel) filters.push({ channel: params.channel });
    const firstSeen = originsFirstSeenFilter(params.from, params.to);
    if (firstSeen) filters.push({ first_seen_at: firstSeen });
    const where: Prisma.contact_originsWhereInput = {
      AND: [
        ...filters,
        ...(q
        ? [{
            OR: [
              { phone: { contains: q } },
              { whatsapp_user_id: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } },
              { dni: { contains: q, mode: 'insensitive' } },
              { source_label: { contains: q, mode: 'insensitive' } },
              { source_key: { contains: q, mode: 'insensitive' } },
              { external_id: { contains: q } },
              {
                contacts: {
                  name: { contains: q, mode: 'insensitive' },
                },
              },
              {
                contacts: {
                  last_name: { contains: q, mode: 'insensitive' },
                },
              },
              { contacts: { phone: { contains: q } } },
              { contacts: { whatsapp_user_id: { contains: q, mode: 'insensitive' } } },
              {
                conversations: {
                  wa_username: { contains: usernameQ, mode: 'insensitive' },
                },
              },
              {
                contacts: {
                  email: { contains: q, mode: 'insensitive' },
                },
              },
            ],
          } satisfies Prisma.contact_originsWhereInput]
        : []),
      ],
    };
    const [total, items] = await Promise.all([
      this.prisma.contact_origins.count({ where }),
      this.prisma.contact_origins.findMany({
        where,
        orderBy: [{ first_seen_at: 'desc' }, { id: 'desc' }],
        take,
        skip,
        include: {
          contacts: {
            select: {
              id: true,
              name: true,
              last_name: true,
              phone: true,
              whatsapp_user_id: true,
              email: true,
              dni: true,
              lead_status_id: true,
              lead_status: true,
            },
          },
          conversations: {
            select: {
              wa_username: true,
              whatsapp_line: {
                select: {
                  label: true,
                  display_phone_number: true,
                  program_key: true,
                  program: { select: { slug: true } },
                },
              },
            },
          },
          program: { select: { slug: true } },
        },
      }),
    ]);

    const enriched = await this.enrichLeadRowsWithChat(scope.canonicalArea, items);

    return {
      total,
      items: enriched.map((item) => ({
        ...item,
        ...leadCategoryOf(item),
        payload: payloadWithStandardCurso(item.payload),
      })),
      limit: take,
      offset: skip,
    };
  }

  async exportOrigins(params: {
    area: string;
    channel?: string;
    q?: string;
    from?: string;
    to?: string;
    categories?: string[] | null;
  }): Promise<{ buffer: Buffer; filename: string }> {
    const scope = businessReadScope(params.area);
    const listed = await this.listOrigins({
      area: params.area,
      channel: params.channel,
      q: params.q,
      from: params.from,
      to: params.to,
      categories: params.categories,
      limit: 10_000,
      maxLimit: 10_000,
      offset: 0,
    });

    // Primer inbound: conversación resuelta (origen o enrich por contacto/teléfono).
    // El widget casi nunca guarda conversation_id en el origen.
    const chatTargets = listed.items.flatMap((origin) => {
      const conversationId =
        origin.chat_conversation_id ?? origin.conversation_id;
      if (conversationId == null) return [];
      return [
        {
          originId: origin.id,
          conversationId,
          firstSeenAt: origin.first_seen_at,
        },
      ];
    });
    const firstChats = new Map<number, string>();
    if (chatTargets.length > 0) {
      const firstMessages = await this.prisma.$queryRaw<
        Array<{
          origin_id: number;
          body_text: string | null;
          message_type: string;
        }>
      >(Prisma.sql`
        WITH targets(origin_id, conversation_id, first_seen_at) AS (
          VALUES ${Prisma.join(
            chatTargets.map(
              (t) =>
                Prisma.sql`(${t.originId}::int, ${t.conversationId}::int, ${t.firstSeenAt}::timestamptz)`,
            ),
          )}
        )
        SELECT DISTINCT ON (t.origin_id)
          t.origin_id,
          cm.body_text,
          cm.message_type
        FROM targets t
        INNER JOIN chat_messages cm
          ON cm.conversation_id = t.conversation_id
         AND cm.direction = 'inbound'
         AND cm.created_at >= t.first_seen_at - INTERVAL '5 seconds'
        ORDER BY t.origin_id, cm.created_at ASC, cm.id ASC
      `);
      for (const message of firstMessages) {
        firstChats.set(
          message.origin_id,
          String(message.body_text ?? '').trim() ||
            `[${String(message.message_type || 'mensaje').trim()}]`,
        );
      }
    }

    const channelLabels: Record<string, string> = {
      widget: 'Widget web',
      meta_lead_form: 'Instant Forms',
      meta_ctwa: 'Click-to-WhatsApp',
      organic_wa: 'WhatsApp orgánico',
      mali_one_link: 'Links / QR MALI ONE',
      import: 'Importar',
      tiktok: 'TikTok',
      other: 'Otros',
    };

    const rows = listed.items.map((o) => {
      const payload =
        o.payload && typeof o.payload === 'object' && !Array.isArray(o.payload)
          ? (o.payload as Record<string, unknown>)
          : {};
      const contactName = o.contacts
        ? [o.contacts.name, o.contacts.last_name].filter(Boolean).join(' ')
        : '';
      const category = leadCategoryOf(o);
      const hasResolvedChat =
        (o.chat_conversation_id ?? o.conversation_id) != null;
      const firstMessage = firstChats.get(o.id) ?? '';
      // Igual que la UI: modalidad al captar. Meta/TikTok quedan "Solo contacto"
      // aunque luego abran chat (eso va en Tiene chat / Primer mensaje).
      const captura = o.came_with_inbound ? 'Con mensaje' : 'Solo contacto';
      return {
        channel: channelLabels[o.channel] || o.channel,
        categoria:
          category.categoria === 'general'
            ? 'General'
            : category.categoria === 'ca'
              ? 'Cursos de Arte'
              : category.categoria === 'ep'
                ? 'Extensión Profesional'
                : category.categoria.toUpperCase(),
        linea: category.linea,
        contact_name: contactName,
        username: o.conversations?.wa_username
          ? `@${o.conversations.wa_username.replace(/^@/, '')}`
          : '',
        phone: o.contacts?.phone || o.phone || '',
        email: o.contacts?.email || o.email || '',
        dni: o.contacts?.dni || o.dni || '',
        lead_status: o.contacts?.lead_status?.label || '',
        source_label: o.source_label || '',
        source_key: o.source_key || '',
        curso: cursoFromOriginPayload(payload),
        fuente: String(payload.fuente ?? '').trim(),
        programa: String(payload.programa ?? '').trim(),
        sede: String(payload.sede ?? '').trim(),
        captura,
        tiene_chat: hasResolvedChat ? 'Sí' : 'No',
        first_lead_chat: firstMessage,
        external_id: o.external_id,
        first_seen_at: formatExportDate(o.first_seen_at),
      };
    });

    return {
      buffer: buildLeadsOriginsExportBuffer(rows),
      filename: leadsOriginsExportFilename(scope.canonicalArea),
    };
  }

  /** Enriquece filas de leads con conversación para abrir chat e indicador de inbound al captar. */
  async enrichLeadRowsWithChat<T extends LeadChatEnrichInput>(
    area: string,
    rows: T[],
  ): Promise<Array<T & { chat_conversation_id: number | null; came_with_inbound: boolean }>> {
    const chatMaps = await this.loadConversationMaps(area, rows);
    return rows.map((row) => ({
      ...row,
      ...resolveLeadChatEnrichment(row, chatMaps),
    }));
  }

  /** Resuelve conversación WhatsApp vinculada al contacto/origen. */
  private async loadConversationMaps(
    area: string,
    rows: LeadChatEnrichInput[],
  ): Promise<{
    byId: Map<number, ConversationHint>;
    byContact: Map<number, ConversationHint>;
    byPhone: Map<string, ConversationHint>;
  }> {
    const convIds = new Set<number>();
    const contactIds = new Set<number>();
    const phones = new Set<string>();

    for (const row of rows) {
      if (row.conversation_id != null) convIds.add(row.conversation_id);
      const contactId = row.contact_id ?? row.contacts?.id;
      if (contactId) contactIds.add(contactId);
      const phone = row.contacts?.phone?.trim();
      if (phone) phones.add(phone);
    }

    const or: Prisma.conversationsWhereInput[] = [];
    if (convIds.size > 0) {
      or.push({ id: { in: [...convIds] } });
    }
    if (contactIds.size > 0) {
      or.push({ contact_id: { in: [...contactIds] } });
    }
    if (phones.size > 0) {
      or.push({ phone: { in: [...phones] } });
    }

    const empty = {
      byId: new Map<number, ConversationHint>(),
      byContact: new Map<number, ConversationHint>(),
      byPhone: new Map<string, ConversationHint>(),
    };
    if (or.length === 0) return empty;

    const scope = businessReadScope(area);
    const convs = await this.prisma.conversations.findMany({
      where: { area: { in: scope.areas }, OR: or },
      select: {
        id: true,
        contact_id: true,
        phone: true,
        last_user_message_at: true,
      },
      orderBy: { id: 'asc' },
    });

    const byId = new Map<number, ConversationHint>();
    const byContact = new Map<number, ConversationHint>();
    const byPhone = new Map<string, ConversationHint>();

    for (const conv of convs) {
      const entry: ConversationHint = {
        id: conv.id,
        has_inbound: conv.last_user_message_at != null,
      };
      byId.set(conv.id, entry);
      if (conv.contact_id && !byContact.has(conv.contact_id)) {
        byContact.set(conv.contact_id, entry);
      }
      if (conv.phone && !byPhone.has(conv.phone)) {
        byPhone.set(conv.phone, entry);
      }
    }

    return { byId, byContact, byPhone };
  }

  async seedAllAreas(): Promise<void> {
    for (const area of BUSINESS_AREAS) {
      await this.ensureDefaultStatuses(area);
    }
  }
}
