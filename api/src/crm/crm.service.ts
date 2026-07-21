import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BUSINESS_AREAS } from '../config/areas';
import {
  E164_NO_PLUS_REGEX,
  normalizePhone,
} from '../contacts/contacts-validation.utils';
import { PrismaService } from '../prisma/prisma.service';
import { CrmAudienceQueryDto } from './dto/crm-audience-query.dto';
import { CrmSyncContactDto } from './dto/crm-sync-contact.dto';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type CrmAudienceRecipient = {
  contact_id: number;
  email: string;
  name: string;
  last_name: string;
  phone: string;
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
  name: string;
  last_name: string;
  phone: string;
  email: string | null;
  opt_in: boolean;
  opt_in_email: boolean;
  active: boolean;
  segment_slugs: string[];
  attributes: Record<string, string>;
  created_at: string;
  updated_at: string;
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
  phone: string;
  email: string | null;
  created: boolean;
};

@Injectable()
export class CrmService {
  private readonly logger = new Logger(CrmService.name);

  constructor(private readonly prisma: PrismaService) {}

  async syncFromProduct(dto: CrmSyncContactDto): Promise<CrmSyncResult> {
    const area = this.normalizeArea(dto.area ?? 'pam');
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
    const opt_in = dto.opt_in ?? true;
    const opt_in_email = dto.opt_in_email ?? Boolean(email);
    const attributes = this.normalizeAttributes(dto.attributes);
    if (dto.external_id) {
      attributes.mali_one_id = String(dto.external_id).trim();
    }

    const existing = await this.prisma.contacts.findUnique({
      where: { area_phone: { area, phone } },
    });

    const contact = await this.prisma.$transaction(async (tx) => {
      const row = existing
        ? await tx.contacts.update({
            where: { id: existing.id },
            data: {
              name,
              last_name,
              email: email ?? existing.email,
              opt_in,
              opt_in_email,
              active: true,
              replaced_by_contact_id: null,
              replaced_at: null,
              replacement_reason: null,
              updated_at: new Date(),
            },
          })
        : await tx.contacts.create({
            data: {
              name,
              last_name,
              phone,
              email,
              area,
              opt_in,
              opt_in_email,
              active: true,
              segment: null,
            },
          });

      for (const [attr_key, attr_value] of Object.entries(attributes)) {
        await tx.contact_attributes.upsert({
          where: {
            contact_id_attr_key: { contact_id: row.id, attr_key },
          },
          create: { contact_id: row.id, attr_key, attr_value },
          update: { attr_value, updated_at: new Date() },
        });
      }

      await tx.conversations.updateMany({
        where: { area, phone },
        data: { contact_id: row.id, updated_at: new Date() },
      });

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
      created: !existing,
    };
  }

  async listAudience(query: CrmAudienceQueryDto): Promise<CrmAudienceResult> {
    const area = this.normalizeArea(query.area ?? 'pam');
    const page = query.page ?? 1;
    const limit = query.limit ?? 500;
    const offset = (page - 1) * limit;
    const requireOptInEmail = query.opt_in_email !== false;

    const where: Prisma.contactsWhereInput = {
      area,
      active: true,
      email: { not: null },
      OR: [{ replacement_reason: null }, { replacement_reason: '' }],
      replaced_by_contact_id: null,
    };

    if (requireOptInEmail) {
      where.opt_in_email = true;
    }

    if (query.segment) {
      where.contact_segments = {
        some: { area, segment_slug: query.segment.trim() },
      };
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
            select: { attr_key: true, attr_value: true },
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
          row.contact_attributes.map((a) => [a.attr_key, a.attr_value]),
        ),
      });
    }

    const pages = total > 0 ? Math.ceil(total / limit) : 0;
    return { area, items, total, page, limit, pages };
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
    const page = query.page ?? 1;
    const limit = query.limit ?? 100;
    const offset = (page - 1) * limit;

    const where: Prisma.contactsWhereInput = {
      area,
      active: true,
      OR: [{ replacement_reason: null }, { replacement_reason: '' }],
      replaced_by_contact_id: null,
    };

    if (query.has_email === true) {
      where.email = { not: null };
    }
    if (query.opt_in_email !== undefined) {
      where.opt_in_email = query.opt_in_email;
    }
    if (query.segment) {
      where.contact_segments = {
        some: { area, segment_slug: query.segment.trim() },
      };
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
    const q = String(query.q ?? '').trim();
    if (q) {
      where.AND = [
        {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { last_name: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q } },
            { email: { contains: q, mode: 'insensitive' } },
          ],
        },
      ];
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
            select: { attr_key: true, attr_value: true },
          },
          contact_segments: {
            select: { segment_slug: true },
            orderBy: { segment_slug: 'asc' },
          },
        },
      }),
    ]);

    const items: CrmContactRow[] = rows.map((row) => ({
      contact_id: row.id,
      name: row.name,
      last_name: row.last_name,
      phone: row.phone,
      email: this.softEmail(row.email),
      opt_in: row.opt_in,
      opt_in_email: row.opt_in_email,
      active: row.active,
      segment_slugs: row.contact_segments.map((s) => s.segment_slug),
      attributes: Object.fromEntries(
        row.contact_attributes.map((a) => [a.attr_key, a.attr_value]),
      ),
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    }));

    const pages = total > 0 ? Math.ceil(total / limit) : 0;
    return { area, items, total, page, limit, pages };
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
      out[k] = String(value ?? '').trim().slice(0, 500);
    }
    return out;
  }
}
