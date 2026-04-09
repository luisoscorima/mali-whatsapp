function registerSystem(app, ctx) {
  const { query } = ctx;

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
      'name,phone,segment',
      'Ejemplo Usuario,51999999999,suscriptor_1',
      'Maria Ejemplo,51988888888,suscriptor_2',
    ].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="contactos_ejemplo.csv"');
    res.send(`${sample}\n`);
  });
}

module.exports = { registerSystem };
