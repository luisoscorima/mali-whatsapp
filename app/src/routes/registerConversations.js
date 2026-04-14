const { logError } = require('../utils/logger');
const { sanitizeApiResponse, sanitizeMediaOutboundPayload } = require('../utils/apiSanitize');
const { conversationReplyLimiter, conversationMediaUpload } = require('../middleware/limiters');
const {
  sendSessionTextMessage,
  uploadMediaToWhatsApp,
  sendSessionMediaMessage,
  classifyConversationUpload,
} = require('../services/metaWhatsApp');
const { isWithinUserServiceWindow } = require('../utils/conversations');

const MEDIA_TYPE_LABEL = {
  image: 'Imagen',
  video: 'Video',
  audio: 'Audio',
  document: 'Documento',
};

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
    });
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
    });
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

      if (!isWithinUserServiceWindow(conversation.last_user_message_at)) {
        return res
          .status(400)
          .send(
            'Ventana de 24 h cerrada: el usuario debe escribirte de nuevo o usa una plantilla desde Campañas.'
          );
      }

      const seg = String(req.body.inbox_segment || '').trim();
      const qText = String(req.body.inbox_q || '').trim();
      const sp = new URLSearchParams();
      if (seg) sp.set('segment', seg);
      if (qText) sp.set('q', qText);
      const suffix = sp.toString() ? `?${sp.toString()}` : '';
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
            `INSERT INTO chat_messages (conversation_id, direction, wa_message_id, body_text, message_type, raw_payload)
             VALUES ($1, 'outbound', $2, $3, 'text', $4::jsonb)`,
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

        await query(
          `INSERT INTO chat_messages (conversation_id, direction, wa_message_id, body_text, message_type, raw_payload)
           VALUES ($1, 'outbound', $2, $3, $4, $5::jsonb)`,
          [
            conversationId,
            msgId,
            bodyText,
            uploadResult.waType,
            JSON.stringify(
              sanitizeMediaOutboundPayload({ id: uploadResult.mediaId }, sendResp)
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
