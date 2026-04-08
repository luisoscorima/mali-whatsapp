#!/usr/bin/env node
/**
 * Crea o actualiza un usuario del panel (solo correos @mali.pe).
 * Ejecutar dentro del contenedor, no hace falta npm en el host.
 *
 * Uso: node scripts/create-user.js <correo@mali.pe> <contraseña> <pam|educacion> [master]
 * Opcional: último argumento "master" para marcar usuario master.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const MALI_EMAIL_REGEX = /^[^\s@]+@mali\.pe$/i;

const email = String(process.argv[2] || '').trim().toLowerCase();
const password = process.argv[3];
const area = process.argv[4];
const args = process.argv.slice(5);
const isMaster = args.includes('master');

if (!email || !password || !area) {
  console.error('Uso: node scripts/create-user.js <correo@mali.pe> <contraseña> <pam|educacion> [master]');
  process.exit(1);
}

if (!MALI_EMAIL_REGEX.test(email)) {
  console.error('El correo debe ser del dominio @mali.pe');
  process.exit(1);
}

if (!['pam', 'educacion'].includes(area)) {
  console.error('El área debe ser "pam" (Comercial PAM) o "educacion" (Educación).');
  process.exit(1);
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const hash = await bcrypt.hash(password, 10);
  await pool.query(
    `INSERT INTO users (email, password_hash, area, is_master) VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, area = EXCLUDED.area, is_master = EXCLUDED.is_master`,
    [email, hash, area, isMaster]
  );
  console.log('Usuario guardado:', email, '(' + area + ')' + (isMaster ? ' [master]' : ''));
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
