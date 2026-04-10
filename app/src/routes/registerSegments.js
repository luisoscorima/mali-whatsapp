const { logError } = require('../utils/logger');
const { normalizeArea } = require('../middleware/auth');

function registerSegments(app, ctx) {
  const { query, pool, config, appPath } = ctx;

  app.post('/settings/segment-add', async (req, res) => {
    const area = req.user.area;
    const slug = String(req.body.slug || '').trim();
    const label = String(req.body.label || '').trim();
    let sortOrder = parseInt(String(req.body.sort_order || '0').trim(), 10);
    if (Number.isNaN(sortOrder)) sortOrder = 0;
    if (!config.SEGMENT_SLUG_REGEX.test(slug)) {
      return res.status(400).send('Slug invalido (minusculas, numeros y guion bajo, max 50)');
    }
    if (!label || label.length > 120) {
      return res.status(400).send('Etiqueta invalida');
    }
    try {
      await query(
        `INSERT INTO segment_definitions (area, slug, label, sort_order) VALUES ($1, $2, $3, $4)`,
        [normalizeArea(area), slug, label, sortOrder]
      );
      res.redirect(`${appPath('/')}?segments_saved=1`);
    } catch (error) {
      if (error.code === '23505') {
        return res.status(400).send('Ese slug ya existe en el area');
      }
      logError(req, 'Error creando segmento', error);
      res.status(500).send(`No se pudo crear: ${error.message}`);
    }
  });

  app.post('/settings/segment-update', async (req, res) => {
    const areaRaw = req.user.area;
    const area = normalizeArea(areaRaw);
    const id = parseInt(String(req.body.id || '').trim(), 10);
    const newSlug = String(req.body.slug || '').trim();
    const label = String(req.body.label || '').trim();
    let sortOrder = parseInt(String(req.body.sort_order || '0').trim(), 10);
    if (Number.isNaN(sortOrder)) sortOrder = 0;
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).send('Id invalido');
    }
    if (!label || label.length > 120) {
      return res.status(400).send('Etiqueta invalida');
    }
    if (!config.SEGMENT_SLUG_REGEX.test(newSlug)) {
      return res.status(400).send('Slug invalido (minusculas, numeros y guion bajo, max 50)');
    }

    const sel = await query(`SELECT slug FROM segment_definitions WHERE id = $1 AND area = $2`, [id, area]);
    if (sel.rowCount === 0) {
      return res.status(404).send('Segmento no encontrado');
    }
    const oldSlug = sel.rows[0].slug;

    if (newSlug === oldSlug) {
      try {
        const r = await query(
          `UPDATE segment_definitions SET label = $1, sort_order = $2 WHERE id = $3 AND area = $4`,
          [label, sortOrder, id, area]
        );
        if (r.rowCount === 0) {
          return res.status(404).send('Segmento no encontrado');
        }
        return res.redirect(`${appPath('/')}?segments_saved=1`);
      } catch (error) {
        logError(req, 'Error actualizando segmento', error);
        return res.status(500).send(`No se pudo actualizar: ${error.message}`);
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE segment_definitions SET slug = $1, label = $2, sort_order = $3 WHERE id = $4 AND area = $5`,
        [newSlug, label, sortOrder, id, area]
      );
      await client.query(`UPDATE contacts SET segment = $1, updated_at = NOW() WHERE area = $2 AND segment = $3`, [
        newSlug,
        area,
        oldSlug,
      ]);
      await client.query(`UPDATE campaigns SET segment = $1 WHERE area = $2 AND segment = $3`, [
        newSlug,
        area,
        oldSlug,
      ]);
      await client.query('COMMIT');
      res.redirect(`${appPath('/')}?segments_saved=1`);
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      if (error.code === '23505') {
        return res.status(400).send('Ese slug ya existe en el area');
      }
      logError(req, 'Error actualizando segmento (slug)', error);
      res.status(500).send(`No se pudo actualizar: ${error.message}`);
    } finally {
      client.release();
    }
  });

  app.post('/settings/segment-delete', async (req, res) => {
    const area = req.user.area;
    const id = parseInt(String(req.body.id || '').trim(), 10);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).send('Id invalido');
    }
    try {
      const sel = await query(
        `SELECT slug FROM segment_definitions WHERE id = $1 AND area = $2`,
        [id, normalizeArea(area)]
      );
      if (sel.rowCount === 0) {
        return res.status(404).send('Segmento no encontrado');
      }
      const slug = sel.rows[0].slug;
      const cnt = await query(
        `SELECT COUNT(*)::int AS n FROM contacts WHERE area = $1 AND segment = $2`,
        [normalizeArea(area), slug]
      );
      if (cnt.rows[0].n > 0) {
        return res.status(400).send('No se puede borrar: hay contactos con este segmento');
      }
      await query(`DELETE FROM segment_definitions WHERE id = $1 AND area = $2`, [id, normalizeArea(area)]);
      res.redirect(`${appPath('/')}?segments_saved=1`);
    } catch (error) {
      logError(req, 'Error borrando segmento', error);
      res.status(500).send(`No se pudo borrar: ${error.message}`);
    }
  });
}

module.exports = { registerSegments };
