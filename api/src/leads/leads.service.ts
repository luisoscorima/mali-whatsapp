import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  BUSINESS_AREAS,
  normalizeArea,
  normalizeEmail,
  type BusinessArea,
} from '../config/areas';
import {
  E164_NO_PLUS_REGEX,
  normalizePhone,
} from '../contacts/contacts-validation.utils';
import { PrismaService } from '../prisma/prisma.service';
import {
  DEFAULT_LEAD_STATUSES,
  type ContactIdentityInput,
  type LeadChannel,
  type UpsertOriginInput,
} from './leads.types';

@Injectable()
export class LeadsService {
  constructor(private readonly prisma: PrismaService) {}

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
    const dni = String(input.dni ?? '').trim();
    const email = normalizeEmail(input.email);
    if (!phone && !dni && !email) {
      throw new BadRequestException(
        'Se requiere al menos uno de: phone, dni o email',
      );
    }
  }

  async ensureDefaultStatuses(area: BusinessArea): Promise<void> {
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
   * Resolve contact by phone → dni → email within area. Creates if missing.
   */
  async resolveContact(
    area: string,
    input: ContactIdentityInput,
  ): Promise<{ contact_id: number; created: boolean }> {
    const areaNorm = normalizeArea(area);
    this.assertHasIdentity(input);

    const phone = input.phone
      ? this.normalizeOptionalPhone(input.phone)
      : null;
    const dni = this.normalizeOptionalDni(input.dni);
    const email = input.email
      ? this.normalizeOptionalEmail(input.email)
      : null;

    let existing =
      (phone
        ? await this.prisma.contacts.findFirst({
            where: { area: areaNorm, phone, replaced_at: null },
          })
        : null) ??
      (dni
        ? await this.prisma.contacts.findFirst({
            where: { area: areaNorm, dni, replaced_at: null },
          })
        : null) ??
      (email
        ? await this.prisma.contacts.findFirst({
            where: { area: areaNorm, email, replaced_at: null },
          })
        : null);

    const name =
      String(input.name ?? '').trim() ||
      (email ? email.split('@')[0] : '') ||
      'Lead';
    const last_name = String(input.last_name ?? '').trim();
    const defaultStatusId = await this.getDefaultStatusId(areaNorm);

    if (existing) {
      const data: Prisma.contactsUpdateInput = {
        updated_at: new Date(),
      };
      if (!existing.phone && phone) data.phone = phone;
      if (!existing.dni && dni) data.dni = dni;
      if (!existing.email && email) data.email = email;
      if (
        (!existing.name || existing.name === 'Lead') &&
        input.name &&
        String(input.name).trim()
      ) {
        data.name = String(input.name).trim();
      }
      if (!existing.last_name && last_name) data.last_name = last_name;
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
      return { contact_id: existing.id, created: false };
    }

    const created = await this.prisma.contacts.create({
      data: {
        area: areaNorm,
        name: name.slice(0, 150),
        last_name: last_name.slice(0, 150),
        phone,
        dni,
        email,
        opt_in: input.opt_in ?? true,
        opt_in_email: input.opt_in_email ?? Boolean(email),
        lead_status_id: defaultStatusId,
        lead_status_updated_at: defaultStatusId ? new Date() : null,
        updated_at: new Date(),
      },
    });
    return { contact_id: created.id, created: true };
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
      dni: input.contact?.dni ?? input.dni,
      email: input.contact?.email ?? input.email,
      name: input.contact?.name,
      last_name: input.contact?.last_name,
      opt_in: input.contact?.opt_in,
      opt_in_email: input.contact?.opt_in_email,
    };

    let contact_id: number | null = null;
    try {
      this.assertHasIdentity(identity);
      const resolved = await this.resolveContact(area, identity);
      contact_id = resolved.contact_id;
    } catch (err) {
      if (!(err instanceof BadRequestException)) throw err;
      // allow origin without contact only if truly no identity — still throw
      throw err;
    }

    const phone = identity.phone
      ? normalizePhone(identity.phone) || null
      : null;
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
          dni: dni ?? existing.dni,
          email: email ?? existing.email,
          conversation_id:
            input.conversation_id ?? existing.conversation_id,
          last_seen_at: new Date(),
          updated_at: new Date(),
        },
      });
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
        dni,
        email,
        conversation_id: input.conversation_id ?? null,
      },
    });
    return { origin_id: row.id, contact_id: row.contact_id, created: true };
  }

  async listStatuses(area: string) {
    const areaNorm = normalizeArea(area);
    await this.ensureDefaultStatuses(areaNorm);
    return this.prisma.lead_status_definitions.findMany({
      where: { area: areaNorm },
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
    if (body.is_default) {
      await this.prisma.lead_status_definitions.updateMany({
        where: { area: areaNorm, is_default: true },
        data: { is_default: false, updated_at: new Date() },
      });
    }
    return this.prisma.lead_status_definitions.create({
      data: {
        area: areaNorm,
        slug,
        label,
        sort_order: body.sort_order ?? 100,
        is_default: Boolean(body.is_default),
        is_terminal: Boolean(body.is_terminal),
      },
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

    if (body.is_default === true) {
      await this.prisma.lead_status_definitions.updateMany({
        where: { area: areaNorm, is_default: true, NOT: { id } },
        data: { is_default: false, updated_at: new Date() },
      });
    }

    return this.prisma.lead_status_definitions.update({
      where: { id },
      data: {
        label: body.label !== undefined ? String(body.label).trim() : undefined,
        sort_order: body.sort_order,
        is_default: body.is_default,
        is_terminal: body.is_terminal,
        active: body.active,
        updated_at: new Date(),
      },
    });
  }

  async setContactStatus(area: string, contactId: number, statusId: number) {
    const areaNorm = normalizeArea(area);
    const contact = await this.prisma.contacts.findFirst({
      where: { id: contactId, area: areaNorm },
    });
    if (!contact) throw new NotFoundException('Contacto no encontrado');
    const status = await this.prisma.lead_status_definitions.findFirst({
      where: { id: statusId, area: areaNorm, active: true },
    });
    if (!status) throw new NotFoundException('Estado no encontrado');
    return this.prisma.contacts.update({
      where: { id: contactId },
      data: {
        lead_status_id: statusId,
        lead_status_updated_at: new Date(),
        updated_at: new Date(),
      },
      include: { lead_status: true },
    });
  }

  async channelSummary(area: string) {
    const areaNorm = normalizeArea(area);
    const rows = await this.prisma.contact_origins.groupBy({
      by: ['channel'],
      where: { area: areaNorm },
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
    limit?: number;
    offset?: number;
  }) {
    const areaNorm = normalizeArea(params.area);
    const take = Math.min(Math.max(params.limit ?? 50, 1), 200);
    const skip = Math.max(params.offset ?? 0, 0);
    const where: Prisma.contact_originsWhereInput = {
      area: areaNorm,
      ...(params.channel ? { channel: params.channel } : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.contact_origins.count({ where }),
      this.prisma.contact_origins.findMany({
        where,
        orderBy: { last_seen_at: 'desc' },
        take,
        skip,
        include: {
          contacts: {
            select: {
              id: true,
              name: true,
              last_name: true,
              phone: true,
              email: true,
              dni: true,
              lead_status_id: true,
              lead_status: true,
            },
          },
        },
      }),
    ]);
    return { total, items, limit: take, offset: skip };
  }

  async seedAllAreas(): Promise<void> {
    for (const area of BUSINESS_AREAS) {
      await this.ensureDefaultStatuses(area);
    }
  }
}
