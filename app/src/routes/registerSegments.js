const { logError } = require('../utils/logger');
const { auditLog, AuditEvent } = require('../services/auditLog');
const { normalizeArea } = require('../middleware/auth');
const { normalizeSegmentColorKey } = require('../utils/segmentColors');
const { removeContactSegment } = require('../utils/contactSegments');
const {
  loadSegmentContactsForExport,
  loadContactAttributesBatch,
  buildSegmentContactsExportBuffer,
  segmentExportFilename,
} = require('../utils/segmentContactsExport');

function firstSegmentForLegacyColumn(segments) {
  if (!segments || segments.length === 0) return null;
  return [...segments].sort()[0];
}

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
    const colorKey = normalizeSegmentColorKey(req.body.color_key);
    try {
      await query(
        `INSERT INTO segment_definitions (area, slug, label, sort_order, color_key) VALUES ($1, $2, $3, $4, $5)`,
        [normalizeArea(area), slug, label, sortOrder, colorKey]
      );
      auditLog(query, {
        req,
        event_type: AuditEvent.SEGMENT_CREATED,
        message: `Segmento creado: ${slug} (${normalizeArea(area)})`,
        meta: { area: normalizeArea(area), slug, label, sort_order: sortOrder, color_key: colorKey },
      });
      res.redirect(`${appPath('/segments')}?segments_saved=1`);
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
    const colorKey = normalizeSegmentColorKey(req.body.color_key);

    const sel = await query(`SELECT slug FROM segment_definitions WHERE id = $1 AND area = $2`, [id, area]);
    if (sel.rowCount === 0) {
      return res.status(404).send('Segmento no encontrado');
    }
    const oldSlug = sel.rows[0].slug;

    if (newSlug === oldSlug) {
      try {
        const r = await query(
          `UPDATE segment_definitions SET label = $1, sort_order = $2, color_key = $3 WHERE id = $4 AND area = $5`,
          [label, sortOrder, colorKey, id, area]
        );
        if (r.rowCount === 0) {
          return res.status(404).send('Segmento no encontrado');
        }
        auditLog(query, {
          req,
          event_type: AuditEvent.SEGMENT_UPDATED,
          message: `Segmento actualizado: ${oldSlug} (id ${id})`,
          meta: {
            area,
            segment_id: id,
            slug: oldSlug,
            label,
            sort_order: sortOrder,
            color_key: colorKey,
            slug_changed: false,
          },
        });
        return res.redirect(`${appPath('/segments')}?segments_saved=1`);
      } catch (error) {
        logError(req, 'Error actualizando segmento', error);
        return res.status(500).send(`No se pudo actualizar: ${error.message}`);
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE segment_definitions SET slug = $1, label = $2, sort_order = $3, color_key = $4 WHERE id = $5 AND area = $6`,
        [newSlug, label, sortOrder, colorKey, id, area]
      );
      await client.query(
        `UPDATE contact_segments SET segment_slug = $1 WHERE area = $2 AND segment_slug = $3`,
        [newSlug, area, oldSlug]
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
      auditLog(query, {
        req,
        event_type: AuditEvent.SEGMENT_UPDATED,
        message: `Segmento renombrado: ${oldSlug} → ${newSlug} (id ${id})`,
        meta: {
          area,
          segment_id: id,
          old_slug: oldSlug,
          new_slug: newSlug,
          label,
          sort_order: sortOrder,
          color_key: colorKey,
          slug_changed: true,
        },
      });
      res.redirect(`${appPath('/segments')}?segments_saved=1`);
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
      const areaN = normalizeArea(area);
      await query(`DELETE FROM contact_segments WHERE area = $1 AND segment_slug = $2`, [areaN, slug]);
      await query(`DELETE FROM segment_definitions WHERE id = $1 AND area = $2`, [id, areaN]);
      auditLog(query, {
        req,
        event_type: AuditEvent.SEGMENT_DELETED,
        message: `Segmento eliminado: ${slug} (${areaN})`,
        meta: { area: areaN, segment_id: id, slug },
      });
      res.redirect(`${appPath('/segments')}?segments_saved=1`);
    } catch (error) {
      logError(req, 'Error borrando segmento', error);
      res.status(500).send(`No se pudo borrar: ${error.message}`);
    }
  });

  app.get('/segments/:id/export', async (req, res) => {
    const segmentId = Number(req.params.id);
    if (!Number.isInteger(segmentId) || segmentId <= 0) {
      return res.status(400).send('Id de segmento invalido');
    }
    const area = normalizeArea(req.user.area);
    const includeAttributes = String(req.query.attrs || '1') !== '0';

    try {
      const segResult = await query(`SELECT id, slug, label FROM segment_definitions WHERE id = $1 AND area = $2`, [
        segmentId,
        area,
      ]);
      if (segResult.rowCount === 0) {
        return res.status(404).send('Segmento no encontrado');
      }
      const segment = segResult.rows[0];
      const contacts = await loadSegmentContactsForExport(query, area, segment.slug);
      if (contacts.length > config.MAX_CSV_ROWS) {
        return res
          .status(400)
          .send(`Demasiados contactos (${contacts.length}). Maximo ${config.MAX_CSV_ROWS}; contacta al administrador.`);
      }

      const attrMap = includeAttributes
        ? await loadContactAttributesBatch(
            query,
            contacts.map((c) => c.id)
          )
        : new Map();
      const buffer = buildSegmentContactsExportBuffer(contacts, attrMap, { includeAttributes });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${segmentExportFilename(segment.slug)}"`);
      return res.send(buffer);
    } catch (error) {
      logError(req, 'Error exportando contactos de segmento', error, { segmentId });
      return res.status(500).send(`No se pudo exportar: ${error.message}`);
    }
  });

  app.post('/segments/:segmentId/contacts/:contactId/remove', async (req, res) => {
    const area = normalizeArea(req.user.area);
    const segmentId = Number(req.params.segmentId);
    const contactId = Number(req.params.contactId);
    if (!Number.isInteger(segmentId) || segmentId <= 0 || !Number.isInteger(contactId) || contactId <= 0) {
      return res.status(400).send('Parámetros inválidos');
    }

    const segResult = await query(`SELECT id, slug, label FROM segment_definitions WHERE id = $1 AND area = $2`, [
      segmentId,
      area,
    ]);
    if (segResult.rowCount === 0) {
      return res.status(404).send('Segmento no encontrado');
    }
    const segment = segResult.rows[0];

    const membership = await query(
      `SELECT
         c.id,
         COALESCE((
           SELECT array_agg(cs.segment_slug ORDER BY cs.segment_slug)
           FROM contact_segments cs
           WHERE cs.contact_id = c.id AND cs.area = c.area
         ), ARRAY[]::varchar[]) AS segment_slugs
       FROM contacts c
       WHERE c.id = $1 AND c.area = $2
         AND EXISTS (
           SELECT 1
           FROM contact_segments csf
           WHERE csf.contact_id = c.id
             AND csf.area = c.area
             AND csf.segment_slug = $3
         )`,
      [contactId, area, segment.slug]
    );
    if (membership.rowCount === 0) {
      return res.redirect(`${appPath(`/segments/${segmentId}`)}?segment_member_error=not_found`);
    }

    const currentSegments = membership.rows[0].segment_slugs || [];
    if (currentSegments.length <= 1) {
      return res.redirect(`${appPath(`/segments/${segmentId}`)}?segment_member_error=last_segment`);
    }

    const nextSegments = currentSegments.filter((slug) => slug !== segment.slug);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await removeContactSegment(client.query.bind(client), contactId, area, segment.slug);
      await client.query(
        `UPDATE contacts
         SET segment = $1,
             updated_at = NOW()
         WHERE id = $2 AND area = $3`,
        [firstSegmentForLegacyColumn(nextSegments), contactId, area]
      );
      await client.query('COMMIT');
      auditLog(query, {
        req,
        event_type: AuditEvent.CONTACT_UPDATED,
        message: `Contacto ${contactId}: se quitó del segmento ${segment.slug}`,
        meta: {
          area,
          contact_id: contactId,
          segment_id: segmentId,
          removed_segment_slug: segment.slug,
          remaining_segments: nextSegments,
        },
      });
      return res.redirect(`${appPath(`/segments/${segmentId}`)}?segment_member_removed=1`);
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      logError(req, 'Error quitando contacto de segmento', error);
      return res.status(500).send(`No se pudo quitar del segmento: ${error.message}`);
    } finally {
      client.release();
    }
  });
}

module.exports = { registerSegments };
