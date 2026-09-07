/**
 * Seed idempotente v2: usuario master inicial + migración de roles operativos.
 */
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { config } = require('dotenv');
const { resolve } = require('path');

config({ path: resolve(__dirname, '../../.env') });

const DEFAULT_MASTER_EMAIL = 'loscorima@mali.pe';

const OPERATIONAL_USERS = [
  {
    email: 'achumpitasi@mali.pe',
    role: 'supervisor',
    areas: ['educacion', 'educacion_ep'],
  },
  {
    email: 'asesordeadmision3@mali.pe',
    role: 'asesor_comercial',
    areas: ['educacion', 'educacion_ca'],
  },
  {
    email: 'darias@mali.pe',
    role: 'asesor_comercial',
    areas: ['educacion', 'educacion_ep'],
  },
  {
    email: 'ezurita@mali.pe',
    role: 'asesor_comercial',
    areas: ['educacion', 'educacion_ca'],
  },
  {
    email: 'gzabalbeascoa@mali.pe',
    role: 'asesor_comercial',
    areas: ['educacion', 'educacion_ep'],
  },
  {
    email: 'joropeza@mali.pe',
    role: 'coordinador',
    areas: ['educacion', 'educacion_ca', 'educacion_ep'],
  },
  {
    email: 'kbaumann@mali.pe',
    role: 'asesor_comercial',
    areas: ['educacion', 'educacion_ca', 'educacion_ep'],
  },
  {
    email: 'khuerta@mali.pe',
    role: 'asesor_comercial',
    areas: ['educacion', 'educacion_ca'],
  },
  {
    email: 'kvillegas@mali.pe',
    role: 'asesor_comercial',
    areas: ['educacion', 'educacion_ca'],
  },
  {
    email: 'lramirez@mali.pe',
    role: 'supervisor',
    areas: ['educacion', 'educacion_ca', 'educacion_ep'],
  },
  {
    email: 'ngonzales@mali.pe',
    role: 'gestor',
    areas: ['educacion', 'educacion_ca', 'educacion_ep'],
  },
  {
    email: 'ocaceres@mali.pe',
    role: 'analista',
    areas: ['educacion', 'educacion_ca', 'educacion_ep'],
  },
  { email: 'maguinaga@mali.pe', role: 'coordinador', areas: ['pam'] },
  { email: 'mperez@mali.pe', role: 'coordinador', areas: ['patronato'] },
  { email: 'lgutierrez@mali.pe', role: 'coordinador', areas: ['patronato'] },
  { email: 'czegarra@mali.pe', role: 'coordinador', areas: ['patronato'] },
  { email: 'evelazco@mali.pe', role: 'coordinador', areas: ['patronato'] },
];

/** Flags legacy alineadas a ROLE_PERMISSIONS (subset crítico para BD). */
const ROLE_LEGACY_FLAGS = {
  asesor_comercial: {
    can_edit_ai_prompt: false,
    can_view_audit_logs: false,
    can_view_integration: false,
    can_edit_business_hours: false,
    can_view_reports: false,
    can_assign_conversations: false,
    can_manage_attributes: false,
    can_manage_segments: false,
    can_view_conversation_stats: false,
    can_view_campaign_stats: false,
    can_manage_leads: false,
  },
  analista: {
    can_edit_ai_prompt: false,
    can_view_audit_logs: true,
    can_view_integration: true,
    can_edit_business_hours: false,
    can_view_reports: true,
    can_assign_conversations: false,
    can_manage_attributes: false,
    can_manage_segments: false,
    can_view_conversation_stats: true,
    can_view_campaign_stats: true,
    can_manage_leads: true,
  },
  gestor: {
    can_edit_ai_prompt: true,
    can_view_audit_logs: false,
    can_view_integration: false,
    can_edit_business_hours: true,
    can_view_reports: false,
    can_assign_conversations: false,
    can_manage_attributes: false,
    can_manage_segments: true,
    can_view_conversation_stats: false,
    can_view_campaign_stats: true,
    can_manage_leads: true,
  },
  supervisor: {
    can_edit_ai_prompt: false,
    can_view_audit_logs: true,
    can_view_integration: true,
    can_edit_business_hours: false,
    can_view_reports: true,
    can_assign_conversations: true,
    can_manage_attributes: false,
    can_manage_segments: false,
    can_view_conversation_stats: true,
    can_view_campaign_stats: true,
    can_manage_leads: true,
  },
  coordinador: {
    can_edit_ai_prompt: true,
    can_view_audit_logs: true,
    can_view_integration: true,
    can_edit_business_hours: true,
    can_view_reports: true,
    can_assign_conversations: true,
    can_manage_attributes: true,
    can_manage_segments: true,
    can_view_conversation_stats: true,
    can_view_campaign_stats: true,
    can_manage_leads: true,
  },
};

function normalizeEmail(email) {
  return String(email ?? '')
    .trim()
    .toLowerCase();
}

function isValidMaliEmail(email) {
  return /^[^\s@]+@mali\.pe$/i.test(String(email || '').trim());
}

async function migrateOperationalRoles(prisma) {
  let updated = 0;
  for (const row of OPERATIONAL_USERS) {
    const email = normalizeEmail(row.email);
    const user = await prisma.users.findUnique({ where: { email } });
    if (!user) continue;
    const primary = row.areas[0];
    const extras = row.areas.slice(1);
    const flags = ROLE_LEGACY_FLAGS[row.role] || ROLE_LEGACY_FLAGS.asesor_comercial;
    await prisma.users.update({
      where: { id: user.id },
      data: {
        role_slug: row.role,
        area: primary,
        is_provisioned: true,
        ...flags,
      },
    });
    await prisma.user_areas.deleteMany({ where: { user_id: user.id } });
    if (extras.length) {
      await prisma.user_areas.createMany({
        data: extras.map((area) => ({ user_id: user.id, area })),
        skipDuplicates: true,
      });
    }
    updated += 1;
  }
  if (updated > 0) {
    console.log(
      JSON.stringify({
        level: 'info',
        message: 'Roles operativos aplicados',
        updated,
      }),
    );
  }
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const email = normalizeEmail(
      process.env.MASTER_USER_EMAIL || DEFAULT_MASTER_EMAIL,
    );
    const pass = String(process.env.MASTER_INITIAL_PASSWORD || '').trim();
    if (pass && isValidMaliEmail(email)) {
      const existing = await prisma.users.findUnique({ where: { email } });
      if (!existing) {
        const hash = await bcrypt.hash(pass, 10);
        await prisma.users.create({
          data: {
            email,
            password_hash: hash,
            area: 'ti',
            role_slug: 'master',
            is_master: true,
            is_provisioned: true,
          },
        });
        console.log(
          JSON.stringify({
            level: 'info',
            message:
              'Usuario master inicial creado (quita MASTER_INITIAL_PASSWORD del entorno tras el primer login)',
            email,
          }),
        );
      }
    } else if (pass && !isValidMaliEmail(email)) {
      console.warn(
        'MASTER_USER_EMAIL invalido; no se crea usuario master automaticamente',
      );
    }

    await migrateOperationalRoles(prisma);
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        message: 'Seed falló',
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
