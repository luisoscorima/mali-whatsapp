const { logError } = require('../utils/logger');
const { sanitizeApiResponse } = require('../utils/apiSanitize');
const { conversationReplyLimiter } = require('../middleware/limiters');
const { sendSessionTextMessage } = require('../services/metaWhatsApp');
const { isWithinUserServiceWindow } = require('../utils/conversations');

function registerConversations(app, ctx) {
  const { query, config, buildInboxRenderData, appPath, resolveAppBaseUrl } = ctx;

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

      const seg = String(req.body.inbox_segment || '').trim();
      const qText = String(req.body.inbox_q || '').trim();
      const sp = new URLSearchParams();
      if (seg) sp.set('segment', seg);
      if (qText) sp.set('q', qText);
      const suffix = sp.toString() ? `?${sp.toString()}` : '';
      res.redirect(appPath(`/conversations/${conversationId}${suffix}`));
    } catch (error) {
      logError(req, 'Error enviando respuesta WhatsApp', error, { conversationId });
      res.status(500).send(`No se pudo enviar: ${error.message}`);
    }
  });
}

module.exports = { registerConversations };
