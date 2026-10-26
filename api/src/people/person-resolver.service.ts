import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { canonicalBusinessArea } from '../config/areas';
import {
  normalizePhone,
} from '../contacts/contacts-validation.utils';
import { PrismaService } from '../prisma/prisma.service';

type Db = PrismaService | Prisma.TransactionClient;

export type PersonResolveInput = {
  area: string;
  name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  whatsapp_user_id?: string | null;
  email?: string | null;
  dni?: string | null;
  birth_date?: Date | null;
  opt_in?: boolean;
  opt_in_email?: boolean;
  overwriteName?: boolean;
};

export type ResolvedProfile = {
  person_id: number;
  contact_id: number;
  created: boolean;
  conflict: boolean;
};

type PersonSnap = {
  id: number;
  name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  dni: string | null;
  whatsapp_user_id: string | null;
  birth_date?: Date | null;
};

function digits(value: string | null | undefined): string | null {
  const clean = String(value ?? '').replace(/\D/g, '');
  return clean.length >= 8 ? clean : null;
}

function emailOf(value: string | null | undefined): string | null {
  const email = String(value ?? '').trim().toLowerCase();
  return email || null;
}

@Injectable()
export class PersonResolverService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(db: Db, input: PersonResolveInput): Promise<ResolvedProfile> {
    const canonical = canonicalBusinessArea(input.area);
    const phone = input.phone ? normalizePhone(input.phone) || null : null;
    const whatsappUserId = String(input.whatsapp_user_id ?? '').trim() || null;
    const dni = digits(input.dni);
    const email = emailOf(input.email);
    const name = String(input.name ?? '').trim().slice(0, 150);
    const lastName = String(input.last_name ?? '').trim().slice(0, 150);

    const [byWuid, byPhone, byDni, byEmail] = await Promise.all([
      whatsappUserId
        ? db.people.findMany({ where: { whatsapp_user_id: whatsappUserId }, take: 5 })
        : Promise.resolve([]),
      phone ? db.people.findMany({ where: { phone }, take: 5 }) : Promise.resolve([]),
      dni ? db.people.findMany({ where: { dni }, take: 5 }) : Promise.resolve([]),
      email ? db.people.findMany({ where: { email }, take: 5 }) : Promise.resolve([]),
    ]);

    const chosen = await this.choose(db, canonical, {
      wuid: byWuid,
      phone: byPhone,
      dni: byDni,
      email: byEmail,
    }, { whatsappUserId, dni });

    const areaRow = await db.business_areas.findFirst({
      where: { slug: canonical },
      select: { id: true },
    });

    if (!chosen.person) {
      const person = await db.people.create({
        data: {
          name: name || '',
          last_name: lastName,
          phone,
          email,
          dni,
          whatsapp_user_id: whatsappUserId,
          birth_date: input.birth_date ?? null,
        },
      });
      const contact = await db.contacts.create({
        data: {
          person_id: person.id,
          area: canonical,
          name: name || '',
          last_name: lastName,
          phone,
          email,
          dni,
          whatsapp_user_id: whatsappUserId,
          opt_in: input.opt_in ?? true,
          opt_in_email: input.opt_in_email ?? Boolean(email),
          active: true,
        },
      });
      return {
        person_id: person.id,
        contact_id: contact.id,
        created: true,
        conflict: false,
      };
    }

    if (chosen.conflict && chosen.reason) {
      await db.person_identity_reviews.create({
        data: {
          person_id: chosen.person.id,
          business_area_id: areaRow?.id ?? null,
          reason: chosen.reason,
          phone,
          whatsapp_user_id: whatsappUserId,
          dni,
          email,
          detail: { area: input.area, canonical },
        },
      });
    } else {
      await this.fillGaps(db, chosen.person, {
        name,
        lastName,
        phone,
        email,
        dni,
        whatsappUserId,
        birthDate: input.birth_date ?? null,
        overwriteName: input.overwriteName,
      });
    }

    const profiles = await db.contacts.findMany({
      where: {
        person_id: chosen.person.id,
        active: true,
        business_area: { slug: canonical },
      },
      orderBy: { updated_at: 'desc' },
    });
    const profile = profiles.find((row) => row.area === canonical) ?? profiles[0];
    if (profile) {
      return {
        person_id: chosen.person.id,
        contact_id: profile.id,
        created: false,
        conflict: chosen.conflict,
      };
    }

    const fresh = await db.people.findUniqueOrThrow({ where: { id: chosen.person.id } });
    const contact = await db.contacts.create({
      data: {
        person_id: fresh.id,
        area: canonical,
        name: fresh.name,
        last_name: fresh.last_name,
        phone: fresh.phone,
        email: fresh.email,
        dni: fresh.dni,
        whatsapp_user_id: fresh.whatsapp_user_id,
        opt_in: input.opt_in ?? true,
        opt_in_email: input.opt_in_email ?? Boolean(fresh.email),
        active: true,
      },
    });
    return {
      person_id: fresh.id,
      contact_id: contact.id,
      created: true,
      conflict: chosen.conflict,
    };
  }

  private async choose(
    db: Db,
    canonical: string,
    groups: {
      wuid: PersonSnap[];
      phone: PersonSnap[];
      dni: PersonSnap[];
      email: PersonSnap[];
    },
    incoming: { whatsappUserId: string | null; dni: string | null },
  ): Promise<{ person: PersonSnap | null; conflict: boolean; reason: string | null }> {
    const ordered = [groups.wuid, groups.phone, groups.dni, groups.email];
    const ids = [...new Set(ordered.flat().map((row) => row.id))];
    if (!ids.length) return { person: null, conflict: false, reason: null };

    const duplicatedKey = ordered.some((rows) => new Set(rows.map((row) => row.id)).size > 1);
    let personId = ordered.find((rows) => rows.length)?.[0]?.id ?? ids[0];
    if (duplicatedKey || ids.length > 1) {
      const profile = await db.contacts.findFirst({
        where: {
          person_id: { in: ids },
          active: true,
          business_area: { slug: canonical },
        },
        orderBy: { updated_at: 'desc' },
        select: { person_id: true },
      });
      personId = profile?.person_id ?? Math.min(...ids);
    }
    const person = ordered.flat().find((row) => row.id === personId) ?? null;
    if (!person) return { person: null, conflict: false, reason: null };
    if (duplicatedKey || ids.length > 1) {
      return { person, conflict: true, reason: 'identidades_distintas' };
    }
    if (
      incoming.whatsappUserId &&
      person.whatsapp_user_id &&
      person.whatsapp_user_id !== incoming.whatsappUserId
    ) {
      return { person, conflict: true, reason: 'whatsapp_user_id' };
    }
    if (incoming.dni && digits(person.dni) && digits(person.dni) !== incoming.dni) {
      return { person, conflict: true, reason: 'dni' };
    }
    return { person, conflict: false, reason: null };
  }

  private async fillGaps(
    db: Db,
    person: PersonSnap,
    incoming: {
      name: string;
      lastName: string;
      phone: string | null;
      email: string | null;
      dni: string | null;
      whatsappUserId: string | null;
      birthDate: Date | null;
      overwriteName?: boolean;
    },
  ): Promise<void> {
    const data: Prisma.peopleUpdateInput = {};
    if (incoming.overwriteName && incoming.name) data.name = incoming.name;
    else if ((!person.name || person.name === 'Lead') && incoming.name) data.name = incoming.name;
    if (!person.last_name && incoming.lastName) data.last_name = incoming.lastName;
    if (!person.phone && incoming.phone) data.phone = incoming.phone;
    if (!person.email && incoming.email) data.email = incoming.email;
    if (!person.dni && incoming.dni) data.dni = incoming.dni;
    if (!person.whatsapp_user_id && incoming.whatsappUserId) {
      data.whatsapp_user_id = incoming.whatsappUserId;
    }
    if (incoming.birthDate && !person.birth_date) data.birth_date = incoming.birthDate;
    if (!Object.keys(data).length) return;
    data.updated_at = new Date();
    await db.people.update({ where: { id: person.id }, data });
  }
}
