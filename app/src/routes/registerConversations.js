const { logError, logWarn } = require('../utils/logger');
const { sanitizeApiResponse, sanitizeMediaOutboundPayload } = require('../utils/apiSanitize');
const { saveOutboundChatMediaFile } = require('../utils/chatMediaStorage');
const { conversationReplyLimiter, conversationMediaUpload } = require('../middleware/limiters');
const {
  sendSessionTextMessage,
  uploadMediaToWhatsApp,
  sendSessionMediaMessage,
  classifyConversationUpload,
} = require('../services/metaWhatsApp');
const { isWithinUserServiceWindow } = require('../utils/conversations');
const { parseAiConfigValue } = require('../utils/aiConfig');
const { buildExportRows, buildXlsxBuffer, safeFilenamePart } = require('../utils/conversationExport');
const { exportFilenameDateStamp } = require('../utils/datetimeDisplay');

const MEDIA_TYPE_LABEL = {
  image: 'Imagen',
  video: 'Video',
  audio: 'Audio',
  document: 'Documento',
};

function inboxRedirectSuffixFromBody(body) {
  const seg = String(body.inbox_segment || '').trim();
  const qText = String(body.inbox_q || '').trim();
  const inboxChat = String(body.inbox_chat || '').trim();
  const sp = new URLSearchParams();
  if (seg) sp.set('segment', seg);
  if (qText) sp.set('q', qText);
  if (inboxChat === 'unread') sp.set('chat', 'unread');
  else if (inboxChat === 'bot') sp.set('chat', 'bot');
  else if (inboxChat === 'human') sp.set('chat', 'human');
  const s = sp.toString();
  return s ? `?${s}` : '';
}

function registerConversations(app, ctx) {
  const { query, config, buildInboxRenderData, appPath, resolveAppBaseUrl } = ctx;

  function handleReplyUpload(req, res, next) {
    conversationMediaUpload.single('file')(req, res, (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res
            .status(400)
            .send(
              `Archivo demasiado grande (máx. ${Math.round(config.MAX_MEDIA_DOCUMENT_BYTES / (1024 * 1024))} MB).`
            );
        }
        return res.status(400).send(err.message || 'Error al procesar el archivo');
      }
      next();
    });
  }

  app.get('/conversations', async (req, res) => {
    const inbox = await buildInboxRenderData(req, { selectedId: null });
    res.render('conversations', {
      ...inbox,
      basePath: config.basePath,
      areaLabel: res.locals.areaLabel,
      requireAuth: config.requireAuth,
      currentUser: req.user,
      appBaseUrl: resolveAppBaseUrl(),
      activeNav: 'conversations',
      showAdminNav: res.locals.showAdminNav,
    });
  });

  app.post('/conversations/:id/lead-score', async (req, res) => {
    const conversationId = Number(req.params.id);
    if (!Number.isInteger(conversationId) || conversationId <= 0) {
      return res.status(400).send('Id de conversacion invalido');
    }
    const area = req.user.area;
    const clear = String(req.body.lead_score_clear || '').trim() === '1';
    const raw = String(req.body.lead_score ?? '').trim();
    let score = null;
    if (!clear) {
      const n = parseInt(raw, 10);
      if (!Number.isInteger(n) || n < 1 || n > 5) {
        return res.status(400).send('Calificacion invalida (1 a 5)');
      }
      score = n;
    }

    const convResult = await query(`SELECT contact_id FROM conversations WHERE id = $1 AND area = $2`, [
      conversationId,
      area,
    ]);
    if (convResult.rowCount === 0) {
      return res.status(404).send('Conversacion no encontrada');
    }
    const contactId = convResult.rows[0].contact_id;
    if (!contactId) {
      return res
        .status(400)
        .send('No hay contacto vinculado; crea o vincula el contacto para poder calificar el lead.');
    }

    try {
      await query(`UPDATE contacts SET lead_score = $1, updated_at = NOW() WHERE id = $2 AND area = $3`, [
        clear ? null : score,
        contactId,
        area,
      ]);
    } catch (error) {
      logError(req, 'Error guardando lead score', error, { conversationId });
      return res.status(500).send(`No se pudo guardar: ${error.message}`);
    }

    const suffix = inboxRedirectSuffixFromBody(req.body);
    res.redirect(appPath(`/conversations/${conversationId}${suffix}`));
  });

  app.patch('/api/conversations/:id/mode', async (req, res) => {
    const conversationId = Number(req.params.id);
    if (!Number.isInteger(conversationId) || conversationId <= 0) {
      return res.status(400).json({ ok: false, error: 'Id invalido' });
    }
    if (!req.user) {
      return res.status(401).json({ ok: false, error: 'No autenticado' });
    }
    const area = req.user.area;
    const status = String(req.body?.status || '').trim().toLowerCase();
    if (status !== 'bot' && status !== 'human') {
      return res.status(400).json({ ok: false, error: 'status debe ser bot o human' });
    }
    if (status === 'bot') {
      const cfgRow = await query(`SELECT value FROM app_settings WHERE area = $1 AND key = 'ai_config'`, [
        area,
      ]);
      const cfg = parseAiConfigValue(cfgRow.rows[0]?.value);
      if (!cfg || !cfg.enabled) {
        return res.status(400).json({ ok: false, error: 'IA desactivada para el área' });
      }
    }
    const r = await query(
      `UPDATE conversations SET status = $1, updated_at = NOW() WHERE id = $2 AND area = $3 RETURNING id`,
      [status, conversationId, area]
    );
    if (r.rowCount === 0) {
      return res.status(404).json({ ok: false, error: 'No encontrada' });
    }
    return res.json({ ok: true, status });
  });

  app.get('/conversations/:id', async (req, res) => {
    const conversationId = Number(req.params.id);
    if (!Number.isInteger(conversationId) || conversationId <= 0) {
      return res.status(400).send('Id de conversacion invalido');
    }
    const data = await buildInboxRenderData(req, { selectedId: conversationId });
    if (data.notFound) {
      return res.status(404).send('Conversacion no encontrada');
    }
    res.render('conversations', {
      ...data,
      basePath: config.basePath,
      areaLabel: res.locals.areaLabel,
      requireAuth: config.requireAuth,
      currentUser: req.user,
      appBaseUrl: resolveAppBaseUrl(),
      activeNav: 'conversations',
      showAdminNav: res.locals.showAdminNav,
    });
  });

  app.get('/conversations/:id/export', async (req, res) => {
    const conversationId = Number(req.params.id);
    if (!Number.isInteger(conversationId) || conversationId <= 0) {
      return res.status(400).send('Id de conversacion invalido');
    }
    const area = req.user.area;
    const convResult = await query(`SELECT id, phone FROM conversations WHERE id = $1 AND area = $2`, [
      conversationId,
      area,
    ]);
    if (convResult.rowCount === 0) {
      return res.status(404).send('Conversacion no encontrada');
    }
    const conv = convResult.rows[0];

    const messagesResult = await query(
      `SELECT direction, body_text, message_type, created_at, raw_payload
       FROM chat_messages
       WHERE conversation_id = $1
       ORDER BY created_at ASC`,
      [conversationId]
    );
    const rows = buildExportRows(messagesResult.rows);
    const stamp = exportFilenameDateStamp();
    const baseName = `conversacion-${safeFilenamePart(conv.phone)}-${conversationId}-${stamp}`;

    try {
      const buf = buildXlsxBuffer(rows);
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', `attachment; filename="${baseName}.xlsx"`);
      return res.send(buf);
    } catch (error) {
      logError(req, 'Error exportando conversacion', error, { conversationId });
      return res.status(500).send(`No se pudo generar la exportacion: ${error.message}`);
    }
  });

  app.post(
    '/conversations/:id/reply',
    conversationReplyLimiter,
    handleReplyUpload,
    async (req, res) => {
      const conversationId = Number(req.params.id);
      if (!Number.isInteger(conversationId) || conversationId <= 0) {
        return res.status(400).send('Id de conversacion invalido');
      }
      const area = req.user.area;
      const text = String(req.body.message || '').trim();
      const file = req.file;

      if (!text && !file) {
        return res.status(400).send('Escribe un mensaje o adjunta un archivo');
      }

      if (!file && text.length > config.MAX_SESSION_TEXT_LEN) {
        return res
          .status(400)
          .send(`Mensaje demasiado largo (max ${config.MAX_SESSION_TEXT_LEN})`);
      }

      const convResult = await query(`SELECT * FROM conversations WHERE id = $1 AND area = $2`, [
        conversationId,
        area,
      ]);
      if (convResult.rowCount === 0) {
        return res.status(404).send('Conversacion no encontrada');
      }
      const conversation = convResult.rows[0];

      const aiCfgRow = await query(`SELECT value FROM app_settings WHERE area = $1 AND key = 'ai_config'`, [
        area,
      ]);
      const aiCfg = parseAiConfigValue(aiCfgRow.rows[0]?.value);
      const convStatus = String(conversation.status || '').trim().toLowerCase();
      if (aiCfg && aiCfg.enabled && convStatus === 'bot') {
        return res
          .status(400)
          .send('Este chat está en modo Bot; cambia a Asesor (Más, arriba a la derecha) para responder.');
      }

      if (!isWithinUserServiceWindow(conversation.last_user_message_at)) {
        return res
          .status(400)
          .send(
            'Ventana de 24 h cerrada: el usuario debe escribirte de nuevo o usa una plantilla desde Campañas.'
          );
      }

      const suffix = inboxRedirectSuffixFromBody(req.body);
      const redirectUrl = appPath(`/conversations/${conversationId}${suffix}`);

      try {
        if (!file) {
          const apiResponse = await sendSessionTextMessage({
            to: conversation.phone,
            text,
            area,
          });
          const msgId = apiResponse.messages?.[0]?.id || null;

          await query(
            `INSERT INTO chat_messages (conversation_id, direction, wa_message_id, body_text, message_type, raw_payload, is_ai)
             VALUES ($1, 'outbound', $2, $3, 'text', $4::jsonb, FALSE)`,
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
          return res.redirect(redirectUrl);
        }

        let waType;
        try {
          ({ waType } = classifyConversationUpload(file.mimetype, file.size));
        } catch (e) {
          return res.status(400).send(e.message || 'Archivo no válido');
        }

        if (waType === 'audio' && text && text.length > config.MAX_SESSION_TEXT_LEN) {
          return res
            .status(400)
            .send(
              `Con audio, el texto no puede superar ${config.MAX_SESSION_TEXT_LEN} caracteres`
            );
        }

        const uploadResult = await uploadMediaToWhatsApp({
          area,
          buffer: file.buffer,
          mimeType: file.mimetype,
          filename: file.originalname,
        });

        const label = MEDIA_TYPE_LABEL[uploadResult.waType] || 'Archivo';

        if (uploadResult.waType === 'audio' && text) {
          const textResp = await sendSessionTextMessage({
            to: conversation.phone,
            text,
            area,
          });
          const textMsgId = textResp.messages?.[0]?.id || null;
          await query(
            `INSERT INTO chat_messages (conversation_id, direction, wa_message_id, body_text, message_type, raw_payload, is_ai)
             VALUES ($1, 'outbound', $2, $3, 'text', $4::jsonb, FALSE)`,
            [
              conversationId,
              textMsgId,
              text.slice(0, 8000),
              JSON.stringify(sanitizeApiResponse(textResp)),
            ]
          );
        }

        const captionForMedia =
          uploadResult.waType === 'audio'
            ? ''
            : text
              ? text.slice(0, config.MAX_MEDIA_CAPTION_LEN)
              : '';

        const sendResp = await sendSessionMediaMessage({
          to: conversation.phone,
          area,
          waType: uploadResult.waType,
          mediaId: uploadResult.mediaId,
          caption: captionForMedia,
          documentFilename:
            uploadResult.waType === 'document' ? uploadResult.safeFilename : undefined,
        });
        const msgId = sendResp.messages?.[0]?.id || null;

        let bodyText;
        if (captionForMedia) {
          bodyText = `${captionForMedia.slice(0, 8000)}`;
        } else {
          bodyText = `[${label}] ${uploadResult.safeFilename}`.slice(0, 8000);
        }

        let localPreview = null;
        try {
          localPreview = await saveOutboundChatMediaFile({
            buffer: file.buffer,
            conversationId,
            mimeType: file.mimetype,
          });
        } catch (storeErr) {
          logWarn(req, 'No se guardó vista previa del adjunto (S3 y disco fallaron)', {
            conversationId,
            error: storeErr.message,
            code: storeErr.Code || storeErr.name,
          });
        }

        await query(
          `INSERT INTO chat_messages (conversation_id, direction, wa_message_id, body_text, message_type, raw_payload, is_ai)
           VALUES ($1, 'outbound', $2, $3, $4, $5::jsonb, FALSE)`,
          [
            conversationId,
            msgId,
            bodyText,
            uploadResult.waType,
            JSON.stringify(
              sanitizeMediaOutboundPayload({ id: uploadResult.mediaId }, sendResp, localPreview)
            ),
          ]
        );
        await query(
          `UPDATE conversations SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1`,
          [conversationId]
        );

        return res.redirect(redirectUrl);
      } catch (error) {
        logError(req, 'Error enviando respuesta WhatsApp', error, { conversationId });
        res.status(500).send(`No se pudo enviar: ${error.message}`);
      }
    }
  );
}

module.exports = { registerConversations };
