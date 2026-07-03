/**
 * Seed idempotente v2: usuario master inicial (paridad con app/src/db/seed.js).
 * Solo actúa si MASTER_INITIAL_PASSWORD está definido y el email no existe.
 */
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { config } = require('dotenv');
const { resolve } = require('path');

config({ path: resolve(__dirname, '../../.env') });

const DEFAULT_MASTER_EMAIL = 'loscorima@mali.pe';

function normalizeEmail(email) {
  return String(email ?? '')
    .trim()
    .toLowerCase();
}

function isValidMaliEmail(email) {
  return /^[^\s@]+@mali\.pe$/i.test(String(email || '').trim());
}

async function main() {
  const email = normalizeEmail(
    process.env.MASTER_USER_EMAIL || DEFAULT_MASTER_EMAIL,
  );
  const pass = String(process.env.MASTER_INITIAL_PASSWORD || '').trim();
  if (!pass) {
    return;
  }
  if (!isValidMaliEmail(email)) {
    console.warn(
      'MASTER_USER_EMAIL invalido; no se crea usuario master automaticamente',
    );
    return;
  }

  const prisma = new PrismaClient();
  try {
    const existing = await prisma.users.findUnique({ where: { email } });
    if (existing) {
      return;
    }
    const hash = await bcrypt.hash(pass, 10);
    await prisma.users.create({
      data: {
        email,
        password_hash: hash,
        area: 'ti',
        is_master: true,
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
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        message: 'No se pudo crear usuario master',
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
