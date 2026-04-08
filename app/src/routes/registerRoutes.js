const bcrypt = require('bcryptjs');
const multer = require('multer');
const config = require('../config');
const { logInfo, logError } = require('../utils/logger');
const { sanitizeApiResponse } = require('../utils/apiSanitize');
const { normalizePhone } = require('../utils/phone');
const {
  isValidMaliEmail,
  normalizeEmail,
  validateContactInput,
  parseContactCsvBuffer,
} = require('../utils/contactsCsv');
const { normalizeArea } = require('../middleware/auth');
const {
  campaignLimiter,
  conversationReplyLimiter,
  contactsImportLimiter,
  templateSyncLimiter,
  csvUpload,
} = require('../middleware/limiters');
const { verifyWebhookSignature } = require('../middleware/webhookVerify');
const { persistInboundMessagesFromWebhookValue } = require('../services/webhookInbound');
const { sendSessionTextMessage } = require('../services/metaWhatsApp');
const { isWithinUserServiceWindow } = require('../utils/conversations');
const { syncTemplatesForArea } = require('../services/templateSync');
const {
  buildTemplateDefinition,
  extractFormValuesForTemplate,
  validateTemplateFormValues,
} = require('../services/templateParser');
const { runCampaignSendJob, resumeQueuedCampaigns } = require('../services/campaignSender');

function createRegisterRoutes({ query, pool, appPath }) {
  async function getSegmentSlugSet(area) {
    const r = await query(`SELECT slug FROM segment_definitions WHERE area = $1`, [normalizeArea(area)]);
    return new Set(r.rows.map((x) => x.slug));
  }

  async function loadSegments(area) {
    const r = await query(
      `SELECT id, slug, label, sort_order FROM segment_definitions WHERE area = $1 ORDER BY sort_order ASC, slug ASC`,
      [normalizeArea(area)]
    );
    return r.rows.map((row) => ({
      id: row.id,
      value: row.slug,
      label: row.label,
      sort_order: row.sort_order,
    }));
  }

  async function loadSyncedTemplates(area) {
    const r = await query(
      `SELECT id, name, language, category, status, components_json, synced_at
       FROM whatsapp_templates
       WHERE area = $1 AND UPPER(status) = 'APPROVED'
       ORDER BY name ASC, language ASC`,
      [normalizeArea(area)]
    );
    return r.rows;
  }

  function validateCampaignWithSync(reqBody, segmentSet, templateRow) {
    const segment = String(reqBody.segment || '').trim();
    const batchSize = Number(reqBody.batchSize || process.env.DEFAULT_BATCH_SIZE || 40);
    const batchDelayMs = Number(reqBody.batchDelayMs || process.env.DEFAULT_BATCH_DELAY_MS || 1500);

    if (!segmentSet.has(segment)) {
      return { ok: false, message: 'Segmento invalido' };
    }
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > config.MAX_BATCH_SIZE) {
      return { ok: false, message: `Batch size invalido (1-${config.MAX_BATCH_SIZE})` };
    }
    if (!Number.isInteger(batchDelayMs) || batchDelayMs < 0 || batchDelayMs > config.MAX_BATCH_DELAY_MS) {
      return { ok: false, message: `Batch delay invalido (0-${config.MAX_BATCH_DELAY_MS})` };
    }

    const templateSyncId = parseInt(String(reqBody.templateSyncId || '').trim(), 10);
    if (!Number.isInteger(templateSyncId) || templateSyncId <= 0) {
      return { ok: false, message: 'Selecciona una plantilla sincronizada' };
    }
    if (!templateRow) {
      return { ok: false, message: 'Plantilla no encontrada. Sincroniza desde Meta.' };
    }

    const def = buildTemplateDefinition(templateRow);
    const values = extractFormValuesForTemplate(def, reqBody);

    if (def.needsHeaderMedia && values.headerMediaUrl.length > config.MAX_IMAGE_URL_LEN) {
      return { ok: false, message: `URL demasiado larga (max ${config.MAX_IMAGE_URL_LEN})` };
    }

    const v = validateTemplateFormValues(def, values, {
      maxBodyLen: config.MAX_BODY_PARAM_LEN,
      maxUrlLen: config.MAX_IMAGE_URL_LEN,
    });
    if (!v.ok) return v;

    const messageText = [
      def.needsHeaderMedia ? `media:${values.headerMediaUrl}` : '',
      ...values.headerParams,
      ...values.bodyParams,
      ...values.buttonParams,
    ]
      .filter(Boolean)
      .join(' | ');

    return {
      ok: true,
      value: {
        segment,
        templateSyncId,
        templateRow,
        def,
        values,
        messageText: messageText || '(sin parametros variables)',
        imageUrl: def.needsHeaderMedia ? values.headerMediaUrl : null,
        batchSize,
        batchDelayMs,
      },
    };
  }

  function register(app) {
    app.get('/login', (req, res) => {
      if (config.requireAuth && req.user) {
        return res.redirect(appPath('/'));
      }
      if (!config.requireAuth) {
        return res.redirect(appPath('/'));
      }
      res.render('login', { error: null, basePath: config.basePath });
    });

    app.post('/login', async (req, res) => {
      if (!config.requireAuth) {
        return res.redirect(appPath('/'));
      }
      const email = normalizeEmail(req.body.email);
      const password = String(req.body.password || '');
      if (!email || !password) {
        return res.status(400).render('login', { error: 'Correo y contraseña son obligatorios', basePath: config.basePath });
      }
      if (!isValidMaliEmail(email)) {
        return res.status(400).render('login', {
          error: 'Usa un correo @mali.pe',
          basePath: config.basePath,
        });
      }
      try {
        const result = await query(
          'SELECT id, email, password_hash, area, is_master FROM users WHERE email = $1',
          [email]
        );
        if (result.rowCount === 0) {
          return res.status(401).render('login', { error: 'Credenciales incorrectas', basePath: config.basePath });
        }
        const user = result.rows[0];
        const ok = await bcrypt.compare(password, user.password_hash);
        if (!ok) {
          return res.status(401).render('login', { error: 'Credenciales incorrectas', basePath: config.basePath });
        }
        req.session.userId = user.id;
        req.session.email = user.email;
        req.session.area = user.area;
        req.session.isMaster = Boolean(user.is_master);
        res.redirect(appPath('/'));
      } catch (err) {
        logError(req, 'Error en login', err);
        res.status(500).render('login', { error: 'Error interno. Intenta de nuevo.', basePath: config.basePath });
      }
    });

    app.post('/logout', (req, res) => {
      req.session.destroy(() => {
        res.redirect(appPath('/login'));
      });
    });

    app.post('/templates/sync', templateSyncLimiter, async (req, res) => {
      try {
        await syncTemplatesForArea(req.user.area);
        res.redirect(`${appPath('/')}?templates_synced=1`);
      } catch (error) {
        logError(req, 'Error sincronizando plantillas', error);
        res
          .status(500)
          .send(
            `No se pudieron sincronizar plantillas: ${error.message}. Comprueba token y permisos de la app en Meta.`
          );
      }
    });

    app.get('/api/templates/:id/definition', async (req, res) => {
      const id = parseInt(String(req.params.id || '').trim(), 10);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ ok: false, error: 'Id invalido' });
      }
      const r = await query(
        `SELECT id, name, language, category, status, components_json FROM whatsapp_templates WHERE id = $1 AND area = $2`,
        [id, req.user.area]
      );
      if (r.rowCount === 0) {
        return res.status(404).json({ ok: false, error: 'No encontrada' });
      }
      const def = buildTemplateDefinition(r.rows[0]);
      res.json({ ok: true, definition: def });
    });

    app.get('/', async (req, res) => {
      const area = req.user.area;
      const [contactsResult, campaignsResult, statsResult, syncedTemplates] = await Promise.all([
        query(
          `SELECT id, name, phone, segment, opt_in, active, created_at
           FROM contacts
           WHERE area = $1
           ORDER BY id DESC
           LIMIT 10`,
          [area]
        ),
        query(
          `SELECT
            c.id,
            c.segment,
            c.template_name,
            c.message_text,
            c.image_url,
            c.status,
            c.total_recipients,
            c.created_at,
            COALESCE(SUM(CASE WHEN cl.status IN ('sent', 'delivered', 'read') THEN 1 ELSE 0 END), 0)::int AS sent_count,
            COALESCE(SUM(CASE WHEN cl.status IN ('delivered', 'read') THEN 1 ELSE 0 END), 0)::int AS delivered_count,
            COALESCE(SUM(CASE WHEN cl.status = 'read' THEN 1 ELSE 0 END), 0)::int AS read_count,
            COALESCE(SUM(CASE WHEN cl.status IN ('error', 'failed', 'undelivered') THEN 1 ELSE 0 END), 0)::int AS failed_count
           FROM campaigns c
           LEFT JOIN campaign_logs cl ON cl.campaign_id = c.id
           WHERE c.area = $1
           GROUP BY c.id
           ORDER BY c.id DESC
           LIMIT 10`,
          [area]
        ),
        query(
          `SELECT segment, COUNT(*)::int AS total
           FROM contacts
           WHERE active = TRUE AND area = $1
           GROUP BY segment
           ORDER BY segment`,
          [area]
        ),
        loadSyncedTemplates(area),
      ]);

      const segmentsList = await loadSegments(area);

      res.render('dashboard', {
        segments: segmentsList,
        syncedTemplates,
        contacts: contactsResult.rows,
        campaigns: campaignsResult.rows,
        stats: statsResult.rows,
        requireAuth: config.requireAuth,
        currentUser: req.user,
        areaLabel: res.locals.areaLabel,
        templatesSynced: String(req.query.templates_synced || '') === '1',
        templatesSyncError: req.query.templates_sync_err || null,
        segmentsSaved: String(req.query.segments_saved || '') === '1',
        csvImport:
          String(req.query.contacts_import || '') === '1'
            ? {
                ok: req.query.ok !== undefined ? Number(req.query.ok) : null,
                bad: req.query.bad !== undefined ? Number(req.query.bad) : null,
                err: req.query.err || null,
              }
            : null,
        maxCsvRows: config.MAX_CSV_ROWS,
        appBaseUrl: (() => {
          const u = String(process.env.APP_BASE_URL || '').trim().replace(/\/$/, '');
          if (u) return u;
          return `http://localhost:${config.port}${config.basePath}`;
        })(),
      });
    });

    app.get('/api/dashboard', async (req, res) => {
      try {
        const area = req.user.area;
        const [contactsResult, campaignsResult, statsResult] = await Promise.all([
          query(
            `SELECT id, name, phone, segment, opt_in, active, created_at
             FROM contacts
             WHERE area = $1
             ORDER BY id DESC
             LIMIT 25`,
            [area]
          ),
          query(
            `SELECT
               c.id,
               c.segment,
               c.template_name,
               c.status,
               c.total_recipients,
               c.created_at,
               COALESCE(SUM(CASE WHEN cl.status IN ('sent', 'delivered', 'read') THEN 1 ELSE 0 END), 0)::int AS sent_count,
               COALESCE(SUM(CASE WHEN cl.status IN ('delivered', 'read') THEN 1 ELSE 0 END), 0)::int AS delivered_count,
               COALESCE(SUM(CASE WHEN cl.status = 'read' THEN 1 ELSE 0 END), 0)::int AS read_count,
               COALESCE(SUM(CASE WHEN cl.status IN ('error', 'failed', 'undelivered') THEN 1 ELSE 0 END), 0)::int AS failed_count
             FROM campaigns c
             LEFT JOIN campaign_logs cl ON cl.campaign_id = c.id
             WHERE c.area = $1
             GROUP BY c.id
             ORDER BY c.id DESC
             LIMIT 25`,
            [area]
          ),
          query(
            `SELECT segment, COUNT(*)::int AS total
             FROM contacts
             WHERE active = TRUE AND area = $1
             GROUP BY segment
             ORDER BY segment`,
            [area]
          ),
        ]);

        res.json({
          ok: true,
          contacts: contactsResult.rows,
          campaigns: campaignsResult.rows,
          stats: statsResult.rows,
        });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
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
        'name,phone,segment',
        'Ejemplo Usuario,51999999999,suscriptor_1',
        'Maria Ejemplo,51988888888,suscriptor_2',
      ].join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="contactos_ejemplo.csv"');
      res.send(`${sample}\n`);
    });

    app.post('/contacts', async (req, res) => {
      const segmentSet = await getSegmentSlugSet(req.user.area);
      const validation = validateContactInput(req.body, segmentSet);
      if (!validation.ok) {
        return res.status(400).send(validation.message);
      }

      try {
        await query(
          `INSERT INTO contacts (name, phone, segment, area, opt_in, active)
           VALUES ($1, $2, $3, $4, TRUE, TRUE)`,
          [validation.value.name, validation.value.phone, validation.value.segment, req.user.area]
        );
        logInfo(req, 'Contacto creado', {
          phone: validation.value.phone,
          segment: validation.value.segment,
          area: req.user.area,
        });
        res.redirect(appPath('/'));
      } catch (error) {
        logError(req, 'Error al crear contacto', error);
        res.status(400).send(`No se pudo guardar el contacto: ${error.message}`);
      }
    });

    app.post(
      '/contacts/import',
      contactsImportLimiter,
      (req, res, next) => {
        csvUpload.single('csvfile')(req, res, (err) => {
          if (err) {
            if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
              return res.redirect(`${appPath('/')}?contacts_import=1&err=too_big`);
            }
            return res.redirect(`${appPath('/')}?contacts_import=1&err=type`);
          }
          next();
        });
      },
      async (req, res) => {
        if (!req.file || !req.file.buffer.length) {
          return res.redirect(`${appPath('/')}?contacts_import=1&err=no_file`);
        }

        try {
          const segmentSet = await getSegmentSlugSet(req.user.area);
          const { rows, errors } = parseContactCsvBuffer(req.file.buffer, segmentSet);

          if (rows.length > config.MAX_CSV_ROWS) {
            return res.redirect(`${appPath('/')}?contacts_import=1&err=too_many`);
          }

          if (rows.length === 0 && errors.length === 0) {
            return res.redirect(`${appPath('/')}?contacts_import=1&err=empty`);
          }

          if (rows.length === 0) {
            const qp = new URLSearchParams({
              contacts_import: '1',
              ok: '0',
              bad: String(errors.length),
            });
            return res.redirect(`${appPath('/')}?${qp.toString()}`);
          }

          const client = await pool.connect();
          try {
            await client.query('BEGIN');
            for (const row of rows) {
              await client.query(
                `INSERT INTO contacts (name, phone, segment, area, opt_in, active)
                 VALUES ($1, $2, $3, $4, TRUE, TRUE)
                 ON CONFLICT (area, phone) DO UPDATE SET
                   name = EXCLUDED.name,
                   segment = EXCLUDED.segment,
                   updated_at = NOW()`,
                [row.name, row.phone, row.segment, req.user.area]
              );
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
          res.redirect(`${appPath('/')}?${qp.toString()}`);
          logInfo(req, 'Importacion CSV contactos', {
            imported: rows.length,
            rowErrors: errors.length,
          });
        } catch (error) {
          logError(req, 'Error importando CSV', error);
          res.redirect(`${appPath('/')}?contacts_import=1&err=parse`);
        }
      }
    );

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
      const area = req.user.area;
      const id = parseInt(String(req.body.id || '').trim(), 10);
      const label = String(req.body.label || '').trim();
      let sortOrder = parseInt(String(req.body.sort_order || '0').trim(), 10);
      if (Number.isNaN(sortOrder)) sortOrder = 0;
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).send('Id invalido');
      }
      if (!label || label.length > 120) {
        return res.status(400).send('Etiqueta invalida');
      }
      try {
        const r = await query(
          `UPDATE segment_definitions SET label = $1, sort_order = $2 WHERE id = $3 AND area = $4`,
          [label, sortOrder, id, normalizeArea(area)]
        );
        if (r.rowCount === 0) {
          return res.status(404).send('Segmento no encontrado');
        }
        res.redirect(`${appPath('/')}?segments_saved=1`);
      } catch (error) {
        logError(req, 'Error actualizando segmento', error);
        res.status(500).send(`No se pudo actualizar: ${error.message}`);
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

    app.post('/campaigns/send', campaignLimiter, async (req, res) => {
      const area = req.user.area;
      const segmentSet = await getSegmentSlugSet(area);
      const templateSyncId = parseInt(String(req.body.templateSyncId || '').trim(), 10);
      let templateRow = null;
      if (Number.isInteger(templateSyncId) && templateSyncId > 0) {
        const tr = await query(
          `SELECT id, name, language, category, status, components_json FROM whatsapp_templates WHERE id = $1 AND area = $2`,
          [templateSyncId, area]
        );
        if (tr.rowCount > 0) templateRow = tr.rows[0];
      }
      const validation = validateCampaignWithSync(req.body, segmentSet, templateRow);
      if (!validation.ok) {
        return res.status(400).send(validation.message);
      }

      const {
        segment,
        templateRow: tRow,
        values,
        messageText,
        imageUrl,
        batchSize,
        batchDelayMs,
      } = validation.value;

      try {
        const recipientsResult = await query(
          `SELECT id, name, phone
           FROM contacts
           WHERE segment = $1
             AND area = $2
             AND opt_in = TRUE
             AND active = TRUE
           ORDER BY id ASC`,
          [segment, area]
        );
        const recipients = recipientsResult.rows;

        const templateSnapshot = {
          id: tRow.id,
          name: tRow.name,
          language: tRow.language,
          category: tRow.category,
          components_json: tRow.components_json,
        };

        const staticParams = {
          headerParams: values.headerParams,
          bodyParams: values.bodyParams,
          buttonParams: values.buttonParams,
          headerMediaUrl: values.headerMediaUrl,
        };

        const campaignPayload = {
          area,
          segment,
          templateSnapshot,
          staticParams,
          batchSize,
          batchDelayMs,
        };

        const campaignResult = await query(
          `INSERT INTO campaigns (area, segment, template_name, message_text, image_url, status, total_recipients, campaign_payload)
           VALUES ($1, $2, $3, $4, $5, 'queued', $6, $7::jsonb)
           RETURNING id`,
          [area, segment, tRow.name, messageText, imageUrl, recipients.length, JSON.stringify(campaignPayload)]
        );

        const campaignId = campaignResult.rows[0].id;

        setImmediate(() => runCampaignSendJob(query, { campaignId, ...campaignPayload }));

        res.redirect(appPath(`/campaigns/${campaignId}`));
      } catch (error) {
        logError(req, 'Error en envio de campana', error);
        res.status(500).send(`No se pudo enviar la campaña: ${error.message}`);
      }
    });

    app.get('/campaigns/:id', async (req, res) => {
      const campaignId = Number(req.params.id);
      if (!Number.isInteger(campaignId) || campaignId <= 0) {
        return res.status(400).send('Id de campana invalido');
      }

      const [campaignResult, logsResult] = await Promise.all([
        query(`SELECT * FROM campaigns WHERE id = $1 AND area = $2`, [campaignId, req.user.area]),
        query(
          `SELECT id, phone, whatsapp_message_id, status, response, created_at
           FROM campaign_logs
           WHERE campaign_id = $1
           ORDER BY id DESC`,
          [campaignId]
        ),
      ]);

      if (campaignResult.rowCount === 0) {
        return res.status(404).send('Campaña no encontrada');
      }

      res.render('campaign-detail', {
        campaign: campaignResult.rows[0],
        logs: logsResult.rows,
        basePath: config.basePath,
        areaLabel: res.locals.areaLabel,
        requireAuth: config.requireAuth,
        currentUser: req.user,
      });
    });

    app.get('/conversations', async (req, res) => {
      const area = req.user.area;
      const listResult = await query(
        `SELECT
            c.id,
            c.phone,
            c.last_message_at,
            c.last_user_message_at,
            ct.name AS contact_name,
            (SELECT m.body_text FROM chat_messages m
             WHERE m.conversation_id = c.id
             ORDER BY m.created_at DESC
             LIMIT 1) AS preview
          FROM conversations c
          LEFT JOIN contacts ct ON ct.id = c.contact_id
          WHERE c.area = $1
          ORDER BY c.last_message_at DESC
          LIMIT 200`,
        [area]
      );

      res.render('conversations', {
        conversations: listResult.rows,
        basePath: config.basePath,
        areaLabel: res.locals.areaLabel,
        requireAuth: config.requireAuth,
        currentUser: req.user,
      });
    });

    app.get('/conversations/:id', async (req, res) => {
      const conversationId = Number(req.params.id);
      if (!Number.isInteger(conversationId) || conversationId <= 0) {
        return res.status(400).send('Id de conversacion invalido');
      }
      const area = req.user.area;

      const convResult = await query(`SELECT * FROM conversations WHERE id = $1 AND area = $2`, [
        conversationId,
        area,
      ]);
      if (convResult.rowCount === 0) {
        return res.status(404).send('Conversacion no encontrada');
      }
      const conversation = convResult.rows[0];

      const contactRow = conversation.contact_id
        ? await query(`SELECT name, phone FROM contacts WHERE id = $1`, [conversation.contact_id])
        : { rows: [] };
      const contact = contactRow.rows[0] || null;

      const messagesResult = await query(
        `SELECT id, direction, body_text, message_type, created_at, wa_message_id, raw_payload
         FROM chat_messages
         WHERE conversation_id = $1
         ORDER BY created_at ASC`,
        [conversationId]
      );

      res.render('conversation-detail', {
        conversation,
        contact,
        messages: messagesResult.rows,
        basePath: config.basePath,
        areaLabel: res.locals.areaLabel,
        requireAuth: config.requireAuth,
        currentUser: req.user,
        canReply: isWithinUserServiceWindow(conversation.last_user_message_at),
      });
    });

    app.post('/conversations/:id/reply', conversationReplyLimiter, async (req, res) => {
      const conversationId = Number(req.params.id);
      if (!Number.isInteger(conversationId) || conversationId <= 0) {
        return res.status(400).send('Id de conversacion invalido');
      }
      const area = req.user.area;
      const text = String(req.body.message || '').trim();

      if (!text) {
        return res.status(400).send('Escribe un mensaje');
      }
      if (text.length > config.MAX_SESSION_TEXT_LEN) {
        return res.status(400).send(`Mensaje demasiado largo (max ${config.MAX_SESSION_TEXT_LEN})`);
      }

      const convResult = await query(`SELECT * FROM conversations WHERE id = $1 AND area = $2`, [
        conversationId,
        area,
      ]);
      if (convResult.rowCount === 0) {
        return res.status(404).send('Conversacion no encontrada');
      }
      const conversation = convResult.rows[0];

      if (!isWithinUserServiceWindow(conversation.last_user_message_at)) {
        return res
          .status(400)
          .send(
            'Ventana de 24 h cerrada: el usuario debe escribirte de nuevo o usa una plantilla desde Campañas.'
          );
      }

      try {
        const apiResponse = await sendSessionTextMessage({
          to: conversation.phone,
          text,
          area,
        });
        const msgId = apiResponse.messages?.[0]?.id || null;

        await query(
          `INSERT INTO chat_messages (conversation_id, direction, wa_message_id, body_text, message_type, raw_payload)
           VALUES ($1, 'outbound', $2, $3, 'text', $4::jsonb)`,
          [
            conversationId,
            msgId,
            text.slice(0, 8000),
            JSON.stringify(sanitizeApiResponse(apiResponse)),
          ]
        );
        await query(
          `UPDATE conversations SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1`,
          [conversationId]
        );

        res.redirect(appPath(`/conversations/${conversationId}`));
      } catch (error) {
        logError(req, 'Error enviando respuesta WhatsApp', error, { conversationId });
        res.status(500).send(`No se pudo enviar: ${error.message}`);
      }
    });

    app.get('/webhook', (req, res) => {
      const mode = req.query['hub.mode'];
      const token = req.query['hub.verify_token'];
      const challenge = req.query['hub.challenge'];

      if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
        return res.status(200).send(challenge);
      }

      return res.sendStatus(403);
    });

    app.post('/webhook', async (req, res) => {
      try {
        if (!verifyWebhookSignature(req)) {
          return res.status(401).json({ ok: false, error: 'Invalid webhook signature' });
        }

        const entries = req.body.entry || [];

        for (const entry of entries) {
          const changes = entry.changes || [];

          for (const change of changes) {
            const value = change.value || {};
            await persistInboundMessagesFromWebhookValue(query, value);

            const statuses = value.statuses || [];

            for (const status of statuses) {
              const messageId = status.id;
              const mappedStatus = status.status;

              if (messageId && mappedStatus) {
                await query(
                  `UPDATE campaign_logs
                   SET status = $1,
                       response = COALESCE(response, '{}'::jsonb) || $2::jsonb
                   WHERE whatsapp_message_id = $3`,
                  [mappedStatus, JSON.stringify(status), messageId]
                );

                await query(
                  `UPDATE chat_messages
                   SET raw_payload = COALESCE(raw_payload, '{}'::jsonb) || jsonb_build_object('delivery_status', $1::jsonb)
                   WHERE wa_message_id = $2`,
                  [JSON.stringify(status), messageId]
                );
              }
            }
          }
        }

        res.sendStatus(200);
      } catch (error) {
        logError(req, 'Error procesando webhook', error);
        res.status(500).json({ ok: false, error: error.message });
      }
    });

  }

  return { register, resumeQueuedCampaigns: () => resumeQueuedCampaigns(query) };
}

module.exports = { createRegisterRoutes };
