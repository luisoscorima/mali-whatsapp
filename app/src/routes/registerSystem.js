const config = require('../config');
const { buildContactImportSampleXlsxBuffer } = require('../utils/contactsCsv');

function sendContactImportSampleXlsx(res) {
  const buffer = buildContactImportSampleXlsxBuffer();
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', 'attachment; filename="contactos_ejemplo.xlsx"');
  res.send(buffer);
}

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

  app.get('/contacts/sample.xlsx', (req, res) => {
    sendContactImportSampleXlsx(res);
  });

  app.get('/contacts/sample.csv', (req, res) => {
    sendContactImportSampleXlsx(res);
  });
}

module.exports = { registerSystem };
