const multer = require('multer');
const { logInfo, logError } = require('../utils/logger');
const { validateContactInput, parseContactCsvBuffer, parseContactXlsxBuffer } = require('../utils/contactsCsv');
const { contactsImportLimiter, contactsImportUpload } = require('../middleware/limiters');

function registerContacts(app, ctx) {
  const { query, pool, config, getSegmentSlugSet, appPath } = ctx;

  app.post('/contacts', async (req, res) => {
    const segmentSet = await getSegmentSlugSet(req.user.area);
    const validation = validateContactInput(req.body, segmentSet);
    if (!validation.ok) {
      return res.status(400).send(validation.message);
    }

    try {
      const ins = await query(
        `INSERT INTO contacts (name, phone, segment, area, opt_in, active)
         VALUES ($1, $2, $3, $4, TRUE, TRUE)
         RETURNING id`,
        [validation.value.name, validation.value.phone, validation.value.segment, req.user.area]
      );
      const contactId = ins.rows[0]?.id;
      if (contactId) {
        await query(
          `UPDATE conversations SET contact_id = $1, updated_at = NOW()
           WHERE area = $2 AND phone = $3`,
          [contactId, req.user.area, validation.value.phone]
        );
      }
      logInfo(req, 'Contacto creado', {
        phone: validation.value.phone,
        segment: validation.value.segment,
        area: req.user.area,
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
            return res.redirect(`${appPath('/contacts')}?contacts_import=1&err=too_big`);
          }
          return res.redirect(`${appPath('/contacts')}?contacts_import=1&err=type`);
        }
        next();
      });
    },
    async (req, res) => {
      if (!req.file || !req.file.buffer.length) {
        return res.redirect(`${appPath('/contacts')}?contacts_import=1&err=no_file`);
      }

      try {
        const segmentSet = await getSegmentSlugSet(req.user.area);
        const nameLower = String(req.file.originalname || '').toLowerCase();
        const { rows, errors } = nameLower.endsWith('.xlsx')
          ? parseContactXlsxBuffer(req.file.buffer, segmentSet)
          : parseContactCsvBuffer(req.file.buffer, segmentSet);

        if (rows.length > config.MAX_CSV_ROWS) {
          return res.redirect(`${appPath('/contacts')}?contacts_import=1&err=too_many`);
        }

        if (rows.length === 0 && errors.length === 0) {
          return res.redirect(`${appPath('/contacts')}?contacts_import=1&err=empty`);
        }

        if (rows.length === 0) {
          const qp = new URLSearchParams({
            contacts_import: '1',
            ok: '0',
            bad: String(errors.length),
          });
          return res.redirect(`${appPath('/contacts')}?${qp.toString()}`);
        }

        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          for (const row of rows) {
            const up = await client.query(
              `INSERT INTO contacts (name, phone, segment, area, opt_in, active)
               VALUES ($1, $2, $3, $4, TRUE, TRUE)
               ON CONFLICT (area, phone) DO UPDATE SET
                 name = EXCLUDED.name,
                 segment = EXCLUDED.segment,
                 updated_at = NOW()
               RETURNING id`,
              [row.name, row.phone, row.segment, req.user.area]
            );
            const contactId = up.rows[0]?.id;
            if (contactId) {
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
        res.redirect(`${appPath('/contacts')}?${qp.toString()}`);
        logInfo(req, 'Importacion CSV contactos', {
          imported: rows.length,
          rowErrors: errors.length,
        });
      } catch (error) {
        logError(req, 'Error importando CSV', error);
        res.redirect(`${appPath('/contacts')}?contacts_import=1&err=parse`);
      }
    }
  );

  app.post('/contacts/:id/update', async (req, res) => {
    const contactId = Number(req.params.id);
    if (!Number.isInteger(contactId) || contactId <= 0) {
      return res.status(400).send('Id de contacto invalido');
    }
    const area = req.user.area;
    const segmentSet = await getSegmentSlugSet(area);
    const validation = validateContactInput(req.body, segmentSet);
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

    try {
      await query(
        `UPDATE contacts SET name = $1, phone = $2, segment = $3, updated_at = NOW()
         WHERE id = $4 AND area = $5`,
        [validation.value.name, validation.value.phone, validation.value.segment, contactId, area]
      );
      logInfo(req, 'Contacto actualizado', { contactId, area });
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
    res.redirect(`${appPath('/contacts?contact_deleted=1')}`);
  });
}

module.exports = { registerContacts };
