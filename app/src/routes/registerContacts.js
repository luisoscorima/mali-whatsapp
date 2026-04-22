const multer = require('multer');
const { logInfo, logError } = require('../utils/logger');
const { auditLog, AuditEvent, phoneMetaTail } = require('../services/auditLog');
const {
  validateContactInput,
  parseContactCsvBuffer,
  parseContactXlsxBuffer,
} = require('../utils/contactsCsv');
const { contactsImportLimiter, contactsImportUpload } = require('../middleware/limiters');
const { replaceContactSegments, appendContactSegments } = require('../utils/contactSegments');

function firstSegmentForLegacyColumn(segments) {
  if (!segments || segments.length === 0) return null;
  return [...segments].sort()[0];
}

function registerContacts(app, ctx) {
  const { query, pool, config, getSegmentSlugSet, appPath } = ctx;

  app.post('/contacts', async (req, res) => {
    const segmentSet = await getSegmentSlugSet(req.user.area);
    const validation = validateContactInput(req.body, segmentSet, { minSegments: 1 });
    if (!validation.ok) {
      return res.status(400).send(validation.message);
    }

    const segs = validation.value.segments;
    try {
      const ins = await query(
        `INSERT INTO contacts (name, phone, segment, area, opt_in, active)
         VALUES ($1, $2, $3, $4, TRUE, TRUE)
         RETURNING id`,
        [validation.value.name, validation.value.phone, firstSegmentForLegacyColumn(segs), req.user.area]
      );
      const contactId = ins.rows[0]?.id;
      if (contactId) {
        await replaceContactSegments(query, contactId, req.user.area, segs);
        await query(
          `UPDATE conversations SET contact_id = $1, updated_at = NOW()
           WHERE area = $2 AND phone = $3`,
          [contactId, req.user.area, validation.value.phone]
        );
      }
      logInfo(req, 'Contacto creado', {
        phone: validation.value.phone,
        segments: segs,
        area: req.user.area,
      });
      auditLog(query, {
        req,
        event_type: AuditEvent.CONTACT_CREATED,
        message: `Contacto creado (id ${contactId})`,
        meta: {
          contact_id: contactId,
          area: req.user.area,
          phone_tail: phoneMetaTail(validation.value.phone),
          segments: segs,
        },
      });
      res.redirect(appPath('/contacts'));
    } catch (error) {
      logError(req, 'Error al crear contacto', error);
      res.status(400).send(`No se pudo guardar el contacto: ${error.message}`);
    }
  });

  app.post(
    '/contacts/import',
    contactsImportLimiter,
    (req, res, next) => {
      contactsImportUpload.single('csvfile')(req, res, (err) => {
        if (err) {
          if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
            return res.redirect(`${appPath('/contacts/import')}?contacts_import=1&err=too_big`);
          }
          return res.redirect(`${appPath('/contacts/import')}?contacts_import=1&err=type`);
        }
        next();
      });
    },
    async (req, res) => {
      if (!req.file || !req.file.buffer.length) {
        return res.redirect(`${appPath('/contacts/import')}?contacts_import=1&err=no_file`);
      }

      try {
        const segmentSet = await getSegmentSlugSet(req.user.area);
        const nameLower = String(req.file.originalname || '').toLowerCase();
        const { rows, errors } = nameLower.endsWith('.xlsx')
          ? parseContactXlsxBuffer(req.file.buffer, segmentSet)
          : parseContactCsvBuffer(req.file.buffer, segmentSet);

        if (rows.length > config.MAX_CSV_ROWS) {
          return res.redirect(`${appPath('/contacts/import')}?contacts_import=1&err=too_many`);
        }

        if (rows.length === 0 && errors.length === 0) {
          return res.redirect(`${appPath('/contacts/import')}?contacts_import=1&err=empty`);
        }

        if (rows.length === 0) {
          const qp = new URLSearchParams({
            contacts_import: '1',
            ok: '0',
            bad: String(errors.length),
          });
          return res.redirect(`${appPath('/contacts/import')}?${qp.toString()}`);
        }

        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          for (const row of rows) {
            const segs = row.segments;
            const up = await client.query(
              `INSERT INTO contacts (name, phone, segment, area, opt_in, active)
               VALUES ($1, $2, $3, $4, TRUE, TRUE)
               ON CONFLICT (area, phone) DO UPDATE SET
                 name = EXCLUDED.name,
                 segment = EXCLUDED.segment,
                 updated_at = NOW()
               RETURNING id`,
              [row.name, row.phone, firstSegmentForLegacyColumn(segs), req.user.area]
            );
            const contactId = up.rows[0]?.id;
            if (contactId) {
              await replaceContactSegments(client.query.bind(client), contactId, req.user.area, segs);
              await client.query(
                `UPDATE conversations SET contact_id = $1, updated_at = NOW()
                 WHERE area = $2 AND phone = $3`,
                [contactId, req.user.area, row.phone]
              );
            }
          }
          await client.query('COMMIT');
        } catch (dbErr) {
          await client.query('ROLLBACK');
          throw dbErr;
        } finally {
          client.release();
        }

        const qp = new URLSearchParams({
          contacts_import: '1',
          ok: String(rows.length),
          bad: String(errors.length),
        });
        auditLog(query, {
          req,
          event_type: AuditEvent.CONTACT_IMPORT,
          message: `Importación de contactos: ${rows.length} filas guardadas`,
          meta: {
            area: req.user.area,
            rows_saved: rows.length,
            row_errors_in_file: errors.length,
            filename: String(req.file?.originalname || '').slice(0, 200),
          },
        });
        res.redirect(`${appPath('/contacts/import')}?${qp.toString()}`);
        logInfo(req, 'Importacion CSV contactos', {
          imported: rows.length,
          rowErrors: errors.length,
        });
      } catch (error) {
        logError(req, 'Error importando CSV', error);
        res.redirect(`${appPath('/contacts/import')}?contacts_import=1&err=parse`);
      }
    }
  );

  app.post('/contacts/bulk-add-segment', async (req, res) => {
    const area = req.user.area;
    const segmentSet = await getSegmentSlugSet(area);
    const segmentSlug = String(req.body.segment_slug || '').trim();
    if (!segmentSet.has(segmentSlug)) {
      return res.status(400).send('Segmento invalido');
    }
    const rawIds = req.body.contact_ids;
    const idList = Array.isArray(rawIds)
      ? rawIds
      : rawIds != null && rawIds !== ''
        ? [rawIds]
        : [];
    const contactIds = idList
      .map((x) => Number(String(x).trim()))
      .filter((n) => Number.isInteger(n) && n > 0);
    if (contactIds.length === 0) {
      return res.status(400).send('Selecciona al menos un contacto');
    }
    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const cid of contactIds) {
          const own = await client.query(`SELECT id FROM contacts WHERE id = $1 AND area = $2`, [cid, area]);
          if (own.rowCount === 0) continue;
          await appendContactSegments(client.query.bind(client), cid, area, [segmentSlug]);
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
      auditLog(query, {
        req,
        event_type: AuditEvent.CONTACT_BULK_SEGMENT,
        message: `Asignación masiva al segmento «${segmentSlug}» (${contactIds.length} contactos)`,
        meta: { area, segment_slug: segmentSlug, contact_count: contactIds.length },
      });
      res.redirect(`${appPath('/contacts')}?contact_updated=1`);
      logInfo(req, 'Asignacion masiva a segmento', { segmentSlug, count: contactIds.length, area });
    } catch (error) {
      logError(req, 'Error asignacion masiva segmento', error);
      res.status(500).send(`No se pudo asignar: ${error.message}`);
    }
  });

  app.post('/contacts/:id/update', async (req, res) => {
    const contactId = Number(req.params.id);
    if (!Number.isInteger(contactId) || contactId <= 0) {
      return res.status(400).send('Id de contacto invalido');
    }
    const area = req.user.area;
    const segmentSet = await getSegmentSlugSet(area);
    const validation = validateContactInput(req.body, segmentSet, { minSegments: 1 });
    if (!validation.ok) {
      return res.status(400).send(validation.message);
    }

    const own = await query(`SELECT id FROM contacts WHERE id = $1 AND area = $2`, [contactId, area]);
    if (own.rowCount === 0) {
      return res.status(404).send('Contacto no encontrado');
    }

    const dup = await query(
      `SELECT id FROM contacts WHERE area = $1 AND phone = $2 AND id <> $3`,
      [area, validation.value.phone, contactId]
    );
    if (dup.rowCount > 0) {
      return res.status(400).send('Ya existe otro contacto con ese telefono en esta area');
    }

    const segs = validation.value.segments;

    try {
      await query(
        `UPDATE contacts SET name = $1, phone = $2, segment = $3, updated_at = NOW()
         WHERE id = $4 AND area = $5`,
        [validation.value.name, validation.value.phone, firstSegmentForLegacyColumn(segs), contactId, area]
      );
      await replaceContactSegments(query, contactId, area, segs);
      logInfo(req, 'Contacto actualizado', { contactId, area });
      auditLog(query, {
        req,
        event_type: AuditEvent.CONTACT_UPDATED,
        message: `Contacto actualizado (id ${contactId})`,
        meta: {
          contact_id: contactId,
          area,
          phone_tail: phoneMetaTail(validation.value.phone),
          segments: segs,
        },
      });
      res.redirect(`${appPath(`/contacts/${contactId}?contact_updated=1`)}`);
    } catch (error) {
      logError(req, 'Error al actualizar contacto', error);
      res.status(400).send(`No se pudo actualizar: ${error.message}`);
    }
  });

  app.post('/contacts/:id/delete', async (req, res) => {
    const contactId = Number(req.params.id);
    if (!Number.isInteger(contactId) || contactId <= 0) {
      return res.status(400).send('Id de contacto invalido');
    }
    const area = req.user.area;
    const del = await query(`DELETE FROM contacts WHERE id = $1 AND area = $2 RETURNING id`, [contactId, area]);
    if (del.rowCount === 0) {
      return res.status(404).send('Contacto no encontrado');
    }
    logInfo(req, 'Contacto eliminado', { contactId, area });
    auditLog(query, {
      req,
      event_type: AuditEvent.CONTACT_DELETED,
      message: `Contacto eliminado (id ${contactId})`,
      meta: { contact_id: contactId, area },
    });
    res.redirect(`${appPath('/contacts?contact_deleted=1')}`);
  });
}

module.exports = { registerContacts };
