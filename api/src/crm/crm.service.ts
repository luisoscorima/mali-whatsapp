import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AttributeDefinitionsService } from '../attribute-definitions/attribute-definitions.service';
import { BUSINESS_AREAS, type BusinessArea } from '../config/areas';
import {
  EDUCATION_AREA_SLUGS,
  educationProgramOf,
  educationReadScope,
  isEducationAreaSlug,
} from '../config/education-scope';
import {
  E164_NO_PLUS_REGEX,
  firstSegmentForLegacyColumn,
  normalizePhone,
} from '../contacts/contacts-validation.utils';
import { buildCampaignMessagePreview } from '../campaigns/campaign-message-preview.util';
import { persistCampaignChatMessage } from '../campaigns/campaign-chat-message.util';
import { upsertScopedAttribute } from '../contacts/contact-attribute.util';
import { PersonResolverService } from '../people/person-resolver.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildTemplateDefinition,
  buildWhatsappGraphComponents,
} from '../templates/template-definition.util';
import {
  getWhatsAppLineForArea,
  sendTemplateWithComponents,
} from '../templates/whatsapp-meta.util';
import { CrmAudienceQueryDto } from './dto/crm-audience-query.dto';
import type {
  CrmCreateAttributeDefinitionDto,
  CrmUpdateAttributeDefinitionDto,
} from './dto/crm-attribute-definition.dto';
import type { CrmPatchContactDto } from './dto/crm-patch-contact.dto';
import { CrmSyncContactDto } from './dto/crm-sync-contact.dto';
import type { CrmSendTemplateDto } from './dto/crm-send-template.dto';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type CrmAudienceRecipient = {
  contact_id: number;
  email: string;
  name: string;
  last_name: string;
  phone: string | null;
  attributes: Record<string, string>;
};

export type CrmAudienceResult = {
  area: string;
  items: CrmAudienceRecipient[];
  total: number;
  page: number;
  limit: number;
  pages: number;
};

export type CrmContactRow = {
  contact_id: number;
  person_id?: number | null;
  categorias?: string[];
  atributos_categoria?: Record<string, Record<string, string>>;
  area: string;
  name: string;
  last_name: string;
  phone: string | null;
  whatsapp_user_id: string | null;
  wa_username: string | null;
  email: string | null;
  dni: string | null;
  opt_in: boolean;
  opt_in_email: boolean;
  active: boolean;
  segment_slugs: string[];
  attributes: Record<string, string>;
  created_at: string;
  updated_at: string;
  assigned_user_id?: number | null;
  assigned_user_label?: string | null;
  requires_review?: boolean;
  lead_status_id?: number | null;
  lead_status_label?: string | null;
  prospectia_match?: string | null;
  prospectia_advisor_email?: string | null;
  prospectia_checked_at?: string | null;
};

export type CrmContactsResult = {
  area: string;
  items: CrmContactRow[];
  total: number;
  page: number;
  limit: number;
  pages: number;
};

export type CrmSyncResult = {
  contact_id: number;
  area: string;
  phone: string | null;
  email: string | null;
  created: boolean;
};

export type CrmSendTemplateResult = {
  skipped: boolean;
  reason?: string;
  message_id?: string | null;
  campaign_id?: number;
};

const PAM_WA_IDEMPOTENCY_ATTR = 'pam_wa_template_sent';

@Injectable()
export class CrmService {
  private readonly logger = new Logger(CrmService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly attributeDefinitions: AttributeDefinitionsService,
    @Optional() private readonly people?: PersonResolverService,
  ) {}

  async syncFromProduct(dto: CrmSyncContactDto): Promise<CrmSyncResult> {
    const requestedArea = this.normalizeArea(dto.area ?? 'pam');
    const program =
      educationProgramOf(dto.categoria) ||
      educationProgramOf(dto.programa) ||
      educationProgramOf(requestedArea);
    const area = isEducationAreaSlug(requestedArea) ? 'educacion' : requestedArea;
    const phone = normalizePhone(dto.phone);
    if (!E164_NO_PLUS_REGEX.test(phone)) {
      throw new BadRequestException(
        'Teléfono inválido. Usa formato E.164 sin +',
      );
    }

    const name = String(dto.name ?? '').trim();
    if (!name) {
      throw new BadRequestException('Nombre requerido');
    }
    const last_name = String(dto.last_name ?? '').trim();
    const email = this.normalizeEmail(dto.email);
    const attributes = this.normalizeAttributes(dto.attributes);
    const dni = this.normalizeOptionalDni(dto.dni ?? attributes.dni);
    const opt_in = dto.opt_in ?? true;
    const opt_in_email = dto.opt_in_email ?? Boolean(email);
    if (dto.external_id) {
      attributes.mali_one_id = String(dto.external_id).trim();
    }
    if (dni) {
      attributes.dni = dni;
    }

    const resolved = this.people
      ? await this.people.resolve(this.prisma, {
          area,
          name,
          last_name,
          phone,
          email,
          dni,
          opt_in,
          opt_in_email,
          overwriteName: true,
        })
      : null;
    const existing = resolved
      ? await this.prisma.contacts.findFirst({ where: { id: resolved.contact_id } })
      : await this.prisma.contacts.findFirst({
          where: {
            phone,
            area: {
              in: isEducationAreaSlug(requestedArea)
                ? [...EDUCATION_AREA_SLUGS]
                : [area],
            },
          },
          orderBy: { updated_at: 'desc' },
        });

    let segmentSlugs = dto.segment_slugs;
    if (segmentSlugs?.length) {
      segmentSlugs = await this.filterValidSegmentSlugs(area, segmentSlugs);
    }

    const contact = await this.prisma.$transaction(async (tx) => {
      const row = existing
        ? await tx.contacts.update({
            where: { id: existing.id },
            data: {
              name,
              last_name,
              email: email ?? existing.email,
              dni: dni ?? existing.dni,
              opt_in,
              opt_in_email,
              active: true,
              ...(segmentSlugs
                ? { segment: firstSegmentForLegacyColumn(segmentSlugs) }
                : {}),
              updated_at: new Date(),
            },
          })
        : await tx.contacts.create({
            data: {
              name,
              last_name,
              phone,
              email,
              dni,
              area,
              opt_in,
              opt_in_email,
              active: true,
              segment: segmentSlugs
                ? firstSegmentForLegacyColumn(segmentSlugs)
                : null,
            },
          });

      if (segmentSlugs) {
        await this.applyContactSegmentsTx(tx, row.id, area, segmentSlugs);
      }

      for (const [attr_key, attr_value] of Object.entries(attributes)) {
        await upsertScopedAttribute(tx, row.id, attr_key, attr_value, null);
      }
      const categoryAttributes = this.normalizeAttributes(dto.atributos_categoria);
      let categoryProgramId: number | null = null;
      if (program && Object.keys(categoryAttributes).length) {
        const programRow = await tx.business_programs.findFirst({
          where: { slug: program, active: true, business_area: { slug: 'educacion' } },
          select: { id: true },
        });
        categoryProgramId = programRow?.id ?? null;
        if (categoryProgramId) {
          for (const [attr_key, attr_value] of Object.entries(categoryAttributes)) {
            await upsertScopedAttribute(tx, row.id, attr_key, attr_value, categoryProgramId);
          }
        }
      }

      await tx.conversations.updateMany({
        where: {
          phone,
          area: {
            in: isEducationAreaSlug(requestedArea)
              ? [...EDUCATION_AREA_SLUGS]
              : [area],
          },
        },
        data: { contact_id: row.id, updated_at: new Date() },
      });

      if (program) {
        const programRow = await tx.business_programs.findFirst({
          where: {
            slug: program,
            active: true,
            business_area: { slug: 'educacion' },
          },
          select: { id: true },
        });
        if (programRow) {
          await tx.contact_programs.upsert({
            where: {
              contact_id_program_id: {
                contact_id: row.id,
                program_id: programRow.id,
              },
            },
            create: {
              contact_id: row.id,
              program_id: programRow.id,
              source: 'crm',
            },
            update: { last_seen_at: new Date() },
          });
        }
      }

      return row;
    });

    this.logger.log(
      `CRM sync ${existing ? 'update' : 'create'} contact ${contact.id} area=${area}`,
    );

    return {
      contact_id: contact.id,
      area,
      phone: contact.phone,
      email: contact.email,
      created: resolved ? resolved.created : !existing,
    };
  }

  /**
   * Envía plantilla WhatsApp aprobada (p. ej. bienvenida PAM desde MALI ONE).
   * Idempotente por `idempotency_key` (attr `pam_wa_template_sent` en contacto).
   */
  async sendProductTemplate(
    dto: CrmSendTemplateDto,
  ): Promise<CrmSendTemplateResult> {
    const area = this.normalizeArea(dto.area ?? 'pam');
    const phone = normalizePhone(dto.phone);
    if (!E164_NO_PLUS_REGEX.test(phone)) {
      throw new BadRequestException(
        'Teléfono inválido. Usa formato E.164 sin +',
      );
    }

    const templateName = String(dto.template_name ?? '').trim();
    if (!templateName) {
      throw new BadRequestException('template_name requerido');
    }

    const contact = await this.prisma.contacts.findFirst({
      where: { area, phone, active: true },
      select: { id: true, name: true, phone: true },
    });
    if (!contact?.phone) {
      throw new NotFoundException(
        'Contacto no encontrado para enviar plantilla',
      );
    }

    const idempotencyKey = String(dto.idempotency_key ?? '').trim();
    if (idempotencyKey) {
      const sent = await this.prisma.contact_attributes.findFirst({
        where: {
          contact_id: contact.id,
          attr_key: PAM_WA_IDEMPOTENCY_ATTR,
          attr_value: idempotencyKey,
        },
      });
      if (sent) {
        return { skipped: true, reason: 'already_sent' };
      }
    }

    const templateRow = await this.prisma.whatsapp_templates.findFirst({
      where: { area, name: templateName, status: 'APPROVED' },
      select: {
        id: true,
        name: true,
        language: true,
        category: true,
        status: true,
        components_json: true,
        placeholder_aliases_json: true,
      },
    });
    if (!templateRow) {
      throw new BadRequestException(
        `Plantilla "${templateName}" no encontrada o no aprobada en ${area}`,
      );
    }

    const def = buildTemplateDefinition(templateRow);
    const staticParams = {
      headerParams: (dto.header_params ?? []).map((v) => String(v).trim()),
      bodyParams: (dto.body_params ?? [contact.name]).map((v) =>
        String(v).trim(),
      ),
      buttonParams: [] as string[],
      headerMediaUrl: String(dto.header_media_url ?? '').trim(),
    };

    if (def.needsHeaderMedia && !staticParams.headerMediaUrl) {
      throw new BadRequestException(
        `La plantilla "${templateName}" requiere media en cabecera (header_media_url)`,
      );
    }
    if (
      def.needsHeaderText &&
      staticParams.headerParams.length < def.headerParamDefs.length
    ) {
      throw new BadRequestException(
        `La plantilla "${templateName}" requiere ${def.headerParamDefs.length} param(s) de cabecera; se enviaron ${staticParams.headerParams.length}`,
      );
    }
    if (
      def.needsBody &&
      staticParams.bodyParams.length < def.bodyParamDefs.length
    ) {
      throw new BadRequestException(
        `La plantilla "${templateName}" requiere ${def.bodyParamDefs.length} param(s) de cuerpo; se enviaron ${staticParams.bodyParams.length}`,
      );
    }

    const components = buildWhatsappGraphComponents(def, staticParams);
    const preview = buildCampaignMessagePreview(
      def,
      templateRow.components_json,
      staticParams,
    );
    const whatsappLine = getWhatsAppLineForArea(area);

    const campaign = await this.prisma.campaigns.create({
      data: {
        area,
        whatsapp_line_id: whatsappLine?.id ?? null,
        segment: 'product_automation',
        template_name: templateRow.name,
        message_text:
          preview.bodyText || preview.headerText || templateRow.name,
        status: 'sending',
        total_recipients: 1,
        send_mode: 'direct',
        campaign_payload: {
          source: 'crm_product_template',
          contact_id: contact.id,
          template_sync_id: templateRow.id,
          idempotency_key: idempotencyKey || null,
          staticParams,
          templateSnapshot: {
            id: templateRow.id,
            name: templateRow.name,
            language: templateRow.language,
            category: templateRow.category || '',
            components_json: templateRow.components_json,
            placeholder_aliases_json: templateRow.placeholder_aliases_json,
          },
        },
      },
      select: { id: true },
    });

    let messageId: string | null = null;
    let logStatus = 'failed';
    let apiResponse: unknown = null;
    let sendErrorMessage = '';

    try {
      const result = await sendTemplateWithComponents({
        to: phone,
        templateName: templateRow.name,
        languageCode: templateRow.language,
        components,
        area,
        phoneNumberId: whatsappLine?.phoneNumberId ?? null,
      });
      messageId = result.messages?.[0]?.id ?? null;
      logStatus = messageId ? 'sent' : 'failed';
      apiResponse = result;
      if (!messageId) {
        sendErrorMessage =
          'WhatsApp no devolvió un id de mensaje. Revisa credenciales/plantilla.';
      }
    } catch (error) {
      sendErrorMessage = error instanceof Error ? error.message : String(error);
      apiResponse = { error: sendErrorMessage };
    }

    await this.prisma.campaign_logs.create({
      data: {
        campaign_id: campaign.id,
        contact_id: contact.id,
        phone,
        whatsapp_message_id: messageId,
        status: logStatus,
        response: apiResponse as Prisma.InputJsonValue,
      },
    });

    await this.prisma.campaigns.update({
      where: { id: campaign.id },
      data: { status: logStatus === 'sent' ? 'completed' : 'failed' },
    });

    if (logStatus === 'sent') {
      await persistCampaignChatMessage(this.prisma, {
        area,
        campaignId: campaign.id,
        templateName: templateRow.name,
        contactId: contact.id,
        phone,
        waMessageId: messageId,
        preview,
        apiResponse,
        whatsappLineId: whatsappLine?.id ?? null,
        whatsappPhoneNumberId: whatsappLine?.phoneNumberId ?? null,
      });

      await this.prisma.conversations.updateMany({
        where: whatsappLine
          ? { whatsapp_line_id: whatsappLine.id, phone }
          : { area, phone },
        data: {
          contact_id: contact.id,
          status: 'human',
          updated_at: new Date(),
        },
      });

      if (idempotencyKey) {
        await this.prisma.$transaction((tx) =>
          upsertScopedAttribute(tx, contact.id, PAM_WA_IDEMPOTENCY_ATTR, idempotencyKey, null),
        );
      }

      return {
        skipped: false,
        message_id: messageId,
        campaign_id: campaign.id,
      };
    }

    this.logger.warn(
      `CRM send-template falló area=${area} template=${templateName} phone=${phone}: ${sendErrorMessage || 'sin detalle'}`,
    );
    throw new BadRequestException(
      sendErrorMessage
        ? `No se pudo enviar la plantilla WhatsApp: ${sendErrorMessage}`
        : 'No se pudo enviar la plantilla WhatsApp. Revisa logs de campaña.',
    );
  }

  async listAudience(
    query: CrmAudienceQueryDto & {
      segments?: string[];
      exclude_segments?: string[];
    },
  ): Promise<CrmAudienceResult> {
    const area = this.normalizeArea(query.area ?? 'pam');
    const page = query.page ?? 1;
    const limit = query.limit ?? 500;
    const offset = (page - 1) * limit;
    const requireOptInEmail = query.opt_in_email !== false;

    const includeSegments = this.normalizeSegmentList(
      query.segments?.length
        ? query.segments
        : query.segment
          ? [query.segment]
          : [],
    );
    const excludeSegments = this.normalizeSegmentList(
      query.exclude_segments ?? [],
    ).filter((s) => !includeSegments.includes(s));

    const where: Prisma.contactsWhereInput = {
      area,
      active: true,
      email: { not: null },
    };

    if (requireOptInEmail) {
      where.opt_in_email = true;
    }

    const segmentFilters: Prisma.contactsWhereInput[] = [];
    if (includeSegments.length === 1) {
      segmentFilters.push({
        contact_segments: {
          some: { area, segment_slug: includeSegments[0] },
        },
      });
    } else if (includeSegments.length > 1) {
      segmentFilters.push({
        contact_segments: {
          some: { area, segment_slug: { in: includeSegments } },
        },
      });
    }

    if (excludeSegments.length > 0) {
      segmentFilters.push({
        NOT: {
          contact_segments: {
            some: { area, segment_slug: { in: excludeSegments } },
          },
        },
      });
    }

    if (segmentFilters.length === 1) {
      Object.assign(where, segmentFilters[0]);
    } else if (segmentFilters.length > 1) {
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : []),
        ...segmentFilters,
      ];
    }

    if (query.attr_key) {
      where.contact_attributes = {
        some: {
          attr_key: query.attr_key.trim(),
          ...(query.attr_value !== undefined
            ? { attr_value: query.attr_value }
            : {}),
        },
      };
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.contacts.count({ where }),
      this.prisma.contacts.findMany({
        where,
        orderBy: { id: 'asc' },
        skip: offset,
        take: limit,
        include: {
          contact_attributes: {
            select: {
              attr_key: true,
              attr_value: true,
              program_id: true,
              program: { select: { slug: true } },
            },
          },
          contact_programs: {
            select: { program: { select: { slug: true } } },
          },
        },
      }),
    ]);

    const items: CrmAudienceRecipient[] = [];
    for (const row of rows) {
      const email = this.softEmail(row.email);
      if (!email) continue;
      items.push({
        contact_id: row.id,
        email,
        name: row.name,
        last_name: row.last_name,
        phone: row.phone,
        attributes: Object.fromEntries(
          row.contact_attributes
            .filter((attr) => attr.program_id == null)
            .map((attr) => [attr.attr_key, attr.attr_value]),
        ),
      });
    }

    const pages = total > 0 ? Math.ceil(total / limit) : 0;
    return { area, items, total, page, limit, pages };
  }

  private normalizeSegmentList(raw: string[]): string[] {
    return [...new Set(raw.map((s) => String(s ?? '').trim()).filter(Boolean))];
  }

  /** Full CRM contact list for MALI ONE CRM PAM (not only email audience). */
  async listContacts(query: {
    area?: string;
    q?: string;
    segment?: string;
    has_email?: boolean;
    opt_in_email?: boolean;
    attr_key?: string;
    attr_value?: string;
    page?: number;
    limit?: number;
  }): Promise<CrmContactsResult> {
    const area = this.normalizeArea(query.area ?? 'pam');
    return this.listContactsForAreas(query, [area], area);
  }

  async listEducationContacts(query: {
    area?: string;
    q?: string;
    segment?: string;
    has_email?: boolean;
    opt_in_email?: boolean;
    attr_key?: string;
    attr_value?: string;
    page?: number;
    limit?: number;
  }): Promise<CrmContactsResult> {
    const selected = query.area?.trim().toLowerCase() || 'all';
    if (
      selected !== 'all' &&
      selected !== 'educacion' &&
      !isEducationAreaSlug(selected) &&
      selected !== 'ca' &&
      selected !== 'ep'
    ) {
      throw new BadRequestException(
        `Área de educación inválida: ${query.area}`,
      );
    }
    const scope = educationReadScope(selected);
    return this.listContactsForAreas(
      query,
      scope.areas,
      selected,
      true,
      scope.program,
    );
  }

  private async listContactsForAreas(
    query: {
      q?: string;
      segment?: string;
      has_email?: boolean;
      opt_in_email?: boolean;
      attr_key?: string;
      attr_value?: string;
      page?: number;
      limit?: number;
    },
    areas: string[],
    resultArea: string,
    includeLatestProspectia = false,
    program: 'ca' | 'ep' | null = null,
  ): Promise<CrmContactsResult> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 100;
    const offset = (page - 1) * limit;

    const where: Prisma.contactsWhereInput = {
      area: { in: areas },
      active: true,
    };

    if (query.has_email === true) {
      where.email = { not: null };
    }
    if (query.opt_in_email !== undefined) {
      where.opt_in_email = query.opt_in_email;
    }
    if (query.segment) {
      where.contact_segments = {
        some: { area: { in: areas }, segment_slug: query.segment.trim() },
      };
    }

    const andFilters: Prisma.contactsWhereInput[] = [];

    if (program) {
      const legacy = program === 'ca' ? 'educacion_ca' : 'educacion_ep';
      andFilters.push({
        OR: [
          { area: legacy },
          { contact_programs: { some: { program: { slug: program } } } },
        ],
      });
    }

    if (query.attr_key) {
      const attrKey = query.attr_key.trim();
      const attrValue = String(query.attr_value ?? '').trim();
      andFilters.push({
        contact_attributes: {
          some: {
            attr_key: attrKey,
            ...(attrValue
              ? {
                  attr_value: {
                    contains: attrValue,
                    mode: 'insensitive',
                  },
                }
              : {}),
          },
        },
      });
    }

    const q = String(query.q ?? '').trim();
    if (q) {
      andFilters.push({
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { last_name: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q } },
          { whatsapp_user_id: { contains: q, mode: 'insensitive' } },
          {
            conversations: {
              some: {
                wa_username: {
                  contains: q.replace(/^@/, ''),
                  mode: 'insensitive',
                },
              },
            },
          },
          { email: { contains: q, mode: 'insensitive' } },
          { dni: { contains: q, mode: 'insensitive' } },
          {
            contact_attributes: {
              some: {
                attr_value: { contains: q, mode: 'insensitive' },
              },
            },
          },
          {
            contact_segments: {
              some: {
                area: { in: areas },
                segment_slug: { contains: q, mode: 'insensitive' },
              },
            },
          },
        ],
      });
    }

    if (andFilters.length > 0) {
      where.AND = andFilters;
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.contacts.count({ where }),
      this.prisma.contacts.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: offset,
        take: limit,
        include: {
          contact_attributes: {
            select: {
              attr_key: true,
              attr_value: true,
              program_id: true,
              program: { select: { slug: true } },
            },
          },
          contact_programs: {
            select: { program: { select: { slug: true } } },
          },
          contact_segments: {
            select: { segment_slug: true },
            orderBy: { segment_slug: 'asc' },
          },
          conversations: {
            where: { wa_username: { not: null } },
            orderBy: { updated_at: 'desc' },
            take: 1,
            select: { wa_username: true },
          },
          education_lead_cycles: {
            orderBy: [{ started_at: 'desc' }, { id: 'desc' }],
            take: 1,
            include: {
              assigned_user: {
                select: { first_name: true, last_name: true, email: true },
              },
              lead_status: { select: { label: true } },
            },
          },
          ...(includeLatestProspectia
            ? {
                education_lead_entries: {
                  orderBy: [
                    { occurred_at: 'desc' as const },
                    { id: 'desc' as const },
                  ],
                  take: 1,
                  select: {
                    prospectia_match: true,
                    prospectia_advisor_email: true,
                    prospectia_checked_at: true,
                  },
                },
              }
            : {}),
          lead_status: { select: { label: true } },
        },
      }),
    ]);

    const items: CrmContactRow[] = rows.map((row) => ({
      contact_id: row.id,
      person_id: row.person_id,
      categorias: (row.contact_programs ?? []).map((item) => item.program.slug),
      ...this.splitAttributes(row.contact_attributes),
      area: row.area,
      name: row.name,
      last_name: row.last_name,
      phone: row.phone,
      whatsapp_user_id: row.whatsapp_user_id,
      wa_username: row.conversations[0]?.wa_username ?? null,
      email: this.softEmail(row.email),
      dni: row.dni?.trim() || null,
      opt_in: row.opt_in,
      opt_in_email: row.opt_in_email,
      active: row.active,
      segment_slugs: row.contact_segments.map((s) => s.segment_slug),
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
      assigned_user_id: row.education_lead_cycles[0]?.assigned_user_id ?? null,
      requires_review: row.education_lead_cycles[0]?.requires_review ?? false,
      assigned_user_label: row.education_lead_cycles[0]?.assigned_user
        ? [
            row.education_lead_cycles[0].assigned_user.first_name,
            row.education_lead_cycles[0].assigned_user.last_name,
          ]
            .filter(Boolean)
            .join(' ') || row.education_lead_cycles[0].assigned_user.email
        : null,
      lead_status_id:
        row.education_lead_cycles[0]?.lead_status_id ?? row.lead_status_id,
      lead_status_label:
        row.education_lead_cycles[0]?.lead_status?.label ??
        row.lead_status?.label ??
        null,
      ...(includeLatestProspectia
        ? {
            prospectia_match:
              row.education_lead_entries[0]?.prospectia_match ?? null,
            prospectia_advisor_email:
              row.education_lead_entries[0]?.prospectia_advisor_email ?? null,
            prospectia_checked_at:
              row.education_lead_entries[0]?.prospectia_checked_at?.toISOString() ??
              null,
          }
        : {}),
    }));

    const pages = total > 0 ? Math.ceil(total / limit) : 0;
    return { area: resultArea, items, total, page, limit, pages };
  }

  async listAttributeDefinitions(areaRaw?: string) {
    const area = this.normalizeArea(areaRaw ?? 'pam') as BusinessArea;
    return this.attributeDefinitions.listAll(area);
  }

  async listSegments(areaRaw?: string) {
    const area = this.normalizeArea(areaRaw ?? 'pam');
    return this.prisma.segment_definitions.findMany({
      where: { area, active: true },
      orderBy: { sort_order: 'asc' },
      select: { slug: true, label: true, color_key: true },
    });
  }

  async createAttributeDefinition(dto: CrmCreateAttributeDefinitionDto) {
    const area = this.normalizeArea(dto.area ?? 'pam') as BusinessArea;
    return this.attributeDefinitions.create(area, dto);
  }

  async ensureAttributeDefinitions(dto: {
    area?: string;
    definitions: Array<{
      slug: string;
      label: string;
      field_type?: string;
      options?: string[];
      sort_order?: number;
    }>;
  }) {
    const area = this.normalizeArea(dto.area ?? 'pam') as BusinessArea;
    return this.attributeDefinitions.ensureAreaDefinitions(
      area,
      dto.definitions ?? [],
    );
  }

  async updateAttributeDefinition(
    id: number,
    areaRaw: string | undefined,
    dto: CrmUpdateAttributeDefinitionDto,
  ) {
    const area = this.normalizeArea(areaRaw ?? 'pam') as BusinessArea;
    return this.attributeDefinitions.update(area, id, dto);
  }

  async patchContact(
    id: number,
    areaRaw: string | undefined,
    dto: CrmPatchContactDto,
  ): Promise<CrmContactRow> {
    const area = this.normalizeArea(areaRaw ?? 'pam');
    const contact = await this.prisma.contacts.findFirst({
      where: { id, area },
    });
    if (!contact) {
      throw new NotFoundException('Contacto no encontrado');
    }

    const attributes = this.normalizeAttributes(dto.attributes);
    const dni =
      dto.dni !== undefined ? this.normalizeOptionalDni(dto.dni) : undefined;
    if (dni) attributes.dni = dni;
    if (dto.dni !== undefined && !dni) attributes.dni = '';

    const email =
      dto.email !== undefined ? this.normalizeEmail(dto.email) : undefined;

    let segmentSlugs = dto.segment_slugs;
    if (segmentSlugs) {
      segmentSlugs = await this.filterValidSegmentSlugs(area, segmentSlugs);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.contacts.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: String(dto.name).trim() } : {}),
          ...(dto.last_name !== undefined
            ? { last_name: String(dto.last_name).trim() }
            : {}),
          ...(email !== undefined ? { email } : {}),
          ...(dni !== undefined ? { dni } : {}),
          ...(dto.opt_in !== undefined ? { opt_in: dto.opt_in } : {}),
          ...(dto.opt_in_email !== undefined
            ? { opt_in_email: dto.opt_in_email }
            : {}),
          ...(segmentSlugs
            ? { segment: firstSegmentForLegacyColumn(segmentSlugs) }
            : {}),
          updated_at: new Date(),
        },
      });

      if (segmentSlugs) {
        await this.applyContactSegmentsTx(tx, id, area, segmentSlugs);
      }

      for (const [attr_key, attr_value] of Object.entries(attributes)) {
        await upsertScopedAttribute(tx, id, attr_key, attr_value, null);
      }
    });

    const updated = await this.prisma.contacts.findFirstOrThrow({
      where: { id },
      include: {
        contact_attributes: {
          select: {
            attr_key: true,
            attr_value: true,
            program_id: true,
            program: { select: { slug: true } },
          },
        },
        contact_programs: {
          select: { program: { select: { slug: true } } },
        },
        contact_segments: {
          select: { segment_slug: true },
          orderBy: { segment_slug: 'asc' },
        },
        conversations: {
          where: { wa_username: { not: null } },
          orderBy: { updated_at: 'desc' },
          take: 1,
          select: { wa_username: true },
        },
      },
    });

    return {
      contact_id: updated.id,
      person_id: updated.person_id,
      categorias: updated.contact_programs.map((item) => item.program.slug),
      ...this.splitAttributes(updated.contact_attributes),
      area: updated.area,
      name: updated.name,
      last_name: updated.last_name,
      phone: updated.phone,
      whatsapp_user_id: updated.whatsapp_user_id,
      wa_username: updated.conversations[0]?.wa_username ?? null,
      email: this.softEmail(updated.email),
      dni: updated.dni?.trim() || null,
      opt_in: updated.opt_in,
      opt_in_email: updated.opt_in_email,
      active: updated.active,
      segment_slugs: updated.contact_segments.map((s) => s.segment_slug),
      created_at: updated.created_at.toISOString(),
      updated_at: updated.updated_at.toISOString(),
    };
  }

  private splitAttributes(
    rows: { attr_key: string; attr_value: string; program_id: number | null; program: { slug: string } | null }[],
  ): { attributes: Record<string, string>; atributos_categoria: Record<string, Record<string, string>> } {
    const attributes: Record<string, string> = {};
    const atributos_categoria: Record<string, Record<string, string>> = {};
    for (const row of rows) {
      if (row.program_id == null || !row.program) {
        attributes[row.attr_key] = row.attr_value;
        continue;
      }
      const bucket = atributos_categoria[row.program.slug] ?? {};
      bucket[row.attr_key] = row.attr_value;
      atributos_categoria[row.program.slug] = bucket;
    }
    return { attributes, atributos_categoria };
  }

  private softEmail(value: unknown): string | null {
    const email = String(value ?? '')
      .trim()
      .toLowerCase();
    if (!email || !EMAIL_RE.test(email)) return null;
    return email;
  }

  private normalizeArea(raw: string): string {
    const area = String(raw ?? '')
      .trim()
      .toLowerCase();
    if (!(BUSINESS_AREAS as readonly string[]).includes(area)) {
      throw new BadRequestException(`Área inválida: ${raw}`);
    }
    return area;
  }

  private normalizeEmail(value: unknown): string | null {
    const email = String(value ?? '')
      .trim()
      .toLowerCase();
    if (!email) return null;
    if (!EMAIL_RE.test(email)) {
      throw new BadRequestException(`Email inválido: ${value}`);
    }
    return email;
  }

  private normalizeOptionalDni(value: unknown): string | null {
    const dni = String(value ?? '')
      .trim()
      .replace(/\s+/g, '');
    if (!dni) return null;
    return dni.slice(0, 32);
  }

  private normalizeAttributes(
    input: Record<string, string> | undefined,
  ): Record<string, string> {
    if (!input || typeof input !== 'object') return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(input)) {
      const k = String(key ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .slice(0, 64);
      if (!k) continue;
      out[k] = String(value ?? '')
        .trim()
        .slice(0, 500);
    }
    return out;
  }

  private async filterValidSegmentSlugs(
    area: string,
    segmentSlugs: string[],
  ): Promise<string[]> {
    const valid = await this.prisma.segment_definitions.findMany({
      where: { area, slug: { in: segmentSlugs } },
      select: { slug: true },
    });
    const validSet = new Set(valid.map((s) => s.slug));
    return segmentSlugs.filter((s) => validSet.has(s));
  }

  private async applyContactSegmentsTx(
    tx: Prisma.TransactionClient,
    contactId: number,
    area: string,
    segmentSlugs: string[],
  ): Promise<void> {
    await tx.contact_segments.deleteMany({ where: { contact_id: contactId } });
    if (segmentSlugs.length > 0) {
      await tx.contact_segments.createMany({
        data: segmentSlugs.map((segment_slug) => ({
          contact_id: contactId,
          area,
          segment_slug,
        })),
      });
    }
  }
}
