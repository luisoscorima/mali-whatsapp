const bcrypt = require('bcryptjs');
const config = require('../config');
const { isValidMaliEmail, normalizeEmail } = require('../utils/contactsCsv');

async function seedMasterUser(query) {
  const email = normalizeEmail(process.env.MASTER_USER_EMAIL || config.DEFAULT_MASTER_EMAIL);
  const pass = String(process.env.MASTER_INITIAL_PASSWORD || '').trim();
  if (!pass) {
    return;
  }
  if (!isValidMaliEmail(email)) {
    console.warn('MASTER_USER_EMAIL invalido; no se crea usuario master automaticamente');
    return;
  }
  try {
    const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rowCount > 0) {
      return;
    }
    const hash = await bcrypt.hash(pass, 10);
    await query(
      `INSERT INTO users (email, password_hash, area, is_master) VALUES ($1, $2, 'pam', TRUE)`,
      [email, hash]
    );
    console.log(
      JSON.stringify({
        level: 'info',
        message:
          'Usuario master inicial creado (quita MASTER_INITIAL_PASSWORD del entorno tras el primer login)',
        email,
      })
    );
  } catch (e) {
    console.error(
      JSON.stringify({ level: 'error', message: 'No se pudo crear usuario master', error: e.message })
    );
  }
}

module.exports = { seedMasterUser };
