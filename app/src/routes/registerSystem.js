const config = require('../config');

function registerSystem(app, ctx) {
  const { query } = ctx;

  app.get('/landing', (req, res) => {
    res.render('landing', { basePath: config.basePath });
  });

  app.get('/health', async (req, res) => {
    try {
      await query('SELECT 1');
      res.json({ ok: true, db: 'up' });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get('/contacts/sample.csv', (req, res) => {
    const sample = [
      'name,phone,segment,prefix',
      'Ejemplo Usuario,982160981,suscriptor_1,',
      'Maria Ejemplo,51988888888,suscriptor_2,',
      'Internacional,5551234567,suscriptor_1,1',
    ].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="contactos_ejemplo.csv"');
    res.send(`${sample}\n`);
  });
}

module.exports = { registerSystem };
