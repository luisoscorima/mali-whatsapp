const config = require('../config');
const { parseAiConfigValue } = require('../utils/aiConfig');
const { auditLog, AuditEvent } = require('../services/auditLog');

const AREA_SLUGS = new Set(config.BUSINESS_AREAS);

function registerSettingsApi(app, ctx) {
  const { query, pool } = ctx;

  /**
   * Master: guardar JSON completo de ai_config.
   * Usuario con permiso (solo su área): actualiza prompt y transfer_keyword sin cambiar enabled.
   */
  app.patch('/api/settings/ai/:area', async (req, res) => {
    const area = String(req.params.area || '').trim().toLowerCase();
    if (!AREA_SLUGS.has(area)) {
      return res.status(400).json({ ok: false, error: 'Area invalida' });
    }
    if (!req.user) {
      return res.status(401).json({ ok: false, error: 'No autenticado' });
    }
    const userArea = String(req.user.area || '').trim().toLowerCase();
    const isMaster = Boolean(req.user.isMaster);
    const canEditPrompt =
      Boolean(req.user.canEditAiPrompt) && userArea === area && config.BUSINESS_AREAS.includes(userArea);

    if (!isMaster && !canEditPrompt) {
      return res.status(403).json({ ok: false, error: 'No autorizado' });
    }

    const body = req.body;
    if (body == null || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ ok: false, error: 'JSON invalido' });
    }

    let value;
    if (isMaster) {
      value = JSON.stringify(body);
    } else {
      const cur = await query(`SELECT value FROM app_settings WHERE area = $1 AND key = 'ai_config'`, [area]);
      let cfg = parseAiConfigValue(cur.rows[0]?.value);
      if (!cfg) {
        cfg = {
          enabled: false,
          prompt: '',
          transfer_keyword: '[TRANSFERIR]',
        };
      }
      cfg.prompt = String(body.prompt ?? cfg.prompt ?? '');
      cfg.transfer_keyword = String(body.transfer_keyword ?? cfg.transfer_keyword ?? '[TRANSFERIR]');
      if (!cfg.prompt.trim()) {
        return res.status(400).json({ ok: false, error: 'El prompt no puede estar vacio' });
      }
      value = JSON.stringify(cfg);
    }

    try {
      await query(
        `INSERT INTO app_settings (area, key, value, updated_at) VALUES ($1, 'ai_config', $2, NOW())
         ON CONFLICT (area, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [area, value]
      );
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message || 'Error al guardar' });
    }
    auditLog(query, {
      req,
      event_type: AuditEvent.SETTINGS_AI_CONFIG,
      message: `Ajustes de IA guardados (área ${area})`,
      meta: {
        area,
        scope: isMaster ? 'full_master' : 'prompt_only',
        json_keys: isMaster ? Object.keys(body).slice(0, 40) : ['prompt', 'transfer_keyword'],
      },
    });
    return res.json({ ok: true });
  });

  /**
   * Master: enciende/apaga IA del área y resetea todas las conversaciones.
   * enabled true → status=bot; false → status=human.
   */
  app.post('/api/settings/ai/:area/enable', async (req, res) => {
    const area = String(req.params.area || '').trim().toLowerCase();
    if (!AREA_SLUGS.has(area)) {
      return res.status(400).json({ ok: false, error: 'Area invalida' });
    }
    if (!req.user) {
      return res.status(401).json({ ok: false, error: 'No autenticado' });
    }
    if (!req.user.isMaster) {
      return res.status(403).json({ ok: false, error: 'Solo administrador master' });
    }
    const enabled = Boolean(req.body && req.body.enabled);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const cur = await client.query(
        `SELECT value FROM app_settings WHERE area = $1 AND key = 'ai_config'`,
        [area]
      );
      let cfg = parseAiConfigValue(cur.rows[0]?.value);
      if (!cfg) {
        cfg = {
          enabled: true,
          prompt:
            'Eres un asistente virtual del MALI. Responde en español de forma breve y profesional. Si el usuario necesita hablar con un humano, responde únicamente con la palabra clave de transferencia que se te indica.',
          transfer_keyword: '[TRANSFERIR]',
        };
      }
      cfg.enabled = enabled;
      const value = JSON.stringify(cfg);
      await client.query(
        `INSERT INTO app_settings (area, key, value, updated_at) VALUES ($1, 'ai_config', $2, NOW())
         ON CONFLICT (area, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [area, value]
      );
      const newStatus = enabled ? 'bot' : 'human';
      await client.query(`UPDATE conversations SET status = $1, updated_at = NOW() WHERE area = $2`, [
        newStatus,
        area,
      ]);
      await client.query('COMMIT');
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* */
      }
      return res.status(500).json({ ok: false, error: e.message || 'Error al guardar' });
    } finally {
      client.release();
    }
    auditLog(query, {
      req,
      event_type: AuditEvent.SETTINGS_AI_ENABLE,
      message: `IA del área ${area} ${enabled ? 'activada' : 'desactivada'} (conversaciones actualizadas)`,
      meta: { area, enabled, conversations_status: enabled ? 'bot' : 'human' },
    });
    return res.json({ ok: true });
  });
}

module.exports = { registerSettingsApi };
