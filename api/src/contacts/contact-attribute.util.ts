import { Prisma } from '@prisma/client';
import {
  ATTENTION_V1_SETTING_KEY,
  exactOpenCycleWhere,
  isEducationAttentionArea,
} from '../leads/education-lead-context.util';

export async function upsertScopedAttribute(
  tx: Prisma.TransactionClient,
  contactId: number,
  attrKey: string,
  attrValue: string,
  programId: number | null = null,
): Promise<void> {
  const existing = await tx.contact_attributes.findFirst({
    where: { contact_id: contactId, attr_key: attrKey, program_id: programId },
    select: { id: true },
  });
  if (existing) {
    await tx.contact_attributes.update({
      where: { id: existing.id },
      data: { attr_value: attrValue, updated_at: new Date() },
    });
    return;
  }
  await tx.contact_attributes.create({
    data: {
      contact_id: contactId,
      attr_key: attrKey,
      attr_value: attrValue,
      program_id: programId,
    },
  });
}

/**
 * Single write rule for shared contact attributes: update this ficha and
 * project the same value onto sibling fichas of the same person.
 */
export async function upsertSharedPersonAttribute(
  tx: Prisma.TransactionClient,
  contactId: number,
  attrKey: string,
  attrValue: string,
): Promise<void> {
  const contact = await tx.contacts.findUnique({
    where: { id: contactId },
    select: { id: true, person_id: true },
  });
  if (!contact) return;
  const siblings = await tx.contacts.findMany({
    where: { person_id: contact.person_id, active: true },
    select: { id: true },
  });
  for (const sibling of siblings) {
    // Shared attributes live at General scope (program_id null) on each ficha.
    await upsertScopedAttribute(tx, sibling.id, attrKey, attrValue, null);
  }
}

type AttrDefLite = {
  slug: string;
  owner_kind: string;
  shared_scope: string;
  area: string;
};

/**
 * Authoritative attribute write used by Contacts and CRM.
 * - lead owner: skipped here (caller routes to cycle)
 * - shared: projects to sibling fichas
 * - contextual: scoped upsert
 */
export async function upsertContactAttributeAuthoritative(
  tx: Prisma.TransactionClient,
  contactId: number,
  attrKey: string,
  attrValue: string,
  programId: number | null = null,
  def?: AttrDefLite | null,
): Promise<'lead' | 'shared' | 'contextual'> {
  const resolved =
    def ??
    (await (async () => {
      const contact = await tx.contacts.findUnique({
        where: { id: contactId },
        select: { area: true },
      });
      if (!contact) return null;
      return tx.contact_attribute_definitions.findFirst({
        where: { area: contact.area, slug: attrKey, active: true },
        select: { slug: true, owner_kind: true, shared_scope: true, area: true },
      });
    })());

  if (resolved?.owner_kind === 'lead') return 'lead';
  if (resolved?.shared_scope === 'shared') {
    await upsertSharedPersonAttribute(tx, contactId, attrKey, attrValue);
    return 'shared';
  }
  await upsertScopedAttribute(tx, contactId, attrKey, attrValue, programId);
  return 'contextual';
}

async function isAttentionV1EnabledTx(
  tx: Prisma.TransactionClient,
): Promise<boolean> {
  const row = await tx.app_settings.findUnique({
    where: { area_key: { area: 'educacion', key: ATTENTION_V1_SETTING_KEY } },
    select: { value: true },
  });
  const value = String(row?.value ?? '').trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'on';
}

/**
 * Persist a lead-owned attribute on the open cycle for this person/category.
 * No-op when attention v1 is off or there is no open cycle.
 */
export async function upsertLeadOwnedAttribute(
  tx: Prisma.TransactionClient,
  contactId: number,
  attrKey: string,
  attrValue: string,
  programId: number | null = null,
  defId?: number | null,
): Promise<boolean> {
  if (!(await isAttentionV1EnabledTx(tx))) return false;
  const contact = await tx.contacts.findUnique({
    where: { id: contactId },
    select: { person_id: true, area: true },
  });
  if (!contact || !isEducationAttentionArea(contact.area)) return false;
  const def =
    defId != null
      ? { id: defId, slug: attrKey }
      : await tx.contact_attribute_definitions.findFirst({
          where: {
            area: contact.area,
            slug: attrKey,
            owner_kind: 'lead',
            active: true,
          },
          select: { id: true, slug: true },
        });
  if (!def) return false;
  const cycle = await tx.education_lead_cycles.findFirst({
    where: exactOpenCycleWhere({
      personId: contact.person_id,
      area: contact.area,
      programId,
    }),
    orderBy: [{ started_at: 'desc' }, { id: 'desc' }],
    select: { id: true },
  });
  if (!cycle) return false;
  await tx.education_lead_attributes.upsert({
    where: {
      cycle_id_definition_id: {
        cycle_id: cycle.id,
        definition_id: def.id,
      },
    },
    create: {
      cycle_id: cycle.id,
      definition_id: def.id,
      attr_key: def.slug,
      attr_value: String(attrValue ?? ''),
    },
    update: {
      attr_value: String(attrValue ?? ''),
      updated_at: new Date(),
    },
  });
  return true;
}
