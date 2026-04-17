const { OpenAI } = require('openai');

const UNAVAILABLE_REPLY_MESSAGE =
  'Lo siento, estamos experimentando una carga alta de consultas. Por favor, intenta de nuevo en unos momentos.';

/**
 * @param {string} [areaSlug] - ti | pam | educacion
 */
function areaDisplayName(areaSlug) {
  const m = {
    ti: 'TI',
    pam: 'PAM',
    educacion: 'Educación',
  };
  const k = String(areaSlug || '').trim().toLowerCase();
  return m[k] || (k ? k.charAt(0).toUpperCase() + k.slice(1) : 'MALI');
}

/**
 * Instrucciones de sistema (área MALI + prompt de app_settings).
 * @param {string} [areaSlug]
 * @param {string} [prompt]
 */
function buildSystemInstruction(areaSlug, prompt) {
  const areaName = areaDisplayName(areaSlug);
  const p =
    String(prompt || '').trim() || 'Eres un asistente útil. Responde en español.';
  return `Actúa como el asistente de ${areaName} del MALI.\n\n${p}`;
}

/**
 * Historial local → turnos `user` | `model` con `parts: [{ text }]`, sin vacíos,
 * primer turno `user`, fusionando consecutivos del mismo rol.
 *
 * @param {{ role: 'user'|'model', text: string }[]} history
 * @returns {{ role: string, parts: { text: string }[] }[]}
 */
function buildLlmChatTurns(history) {
  const normalized = (Array.isArray(history) ? history : [])
    .map((h) => ({
      role: h.role === 'model' ? 'model' : 'user',
      text: String(h.text || '').trim(),
    }))
    .filter((h) => h.text.length > 0);

  const merged = [];
  for (const h of normalized) {
    const last = merged[merged.length - 1];
    if (last && last.role === h.role) {
      last.text += `\n${h.text}`;
    } else {
      merged.push({ role: h.role, text: h.text });
    }
  }

  while (merged.length > 0 && merged[0].role !== 'user') {
    merged.shift();
  }

  const maxChars = 8000;
  return merged.map((h) => ({
    role: h.role,
    parts: [{ text: h.text.slice(0, maxChars) }],
  }));
}

/**
 * Turnos internos → mensajes OpenAI/Groq (user/assistant).
 * @param {{ role: string, parts: { text: string }[] }[]} turns
 * @returns {{ role: 'user'|'assistant', content: string }[]}
 */
function llmTurnsToOpenAiMessages(turns) {
  return (Array.isArray(turns) ? turns : []).map((c) => {
    const content = String(c.parts?.[0]?.text || '');
    const role = c.role === 'model' ? 'assistant' : 'user';
    return { role, content };
  });
}

/**
 * @param {string} text - Mensaje actual del usuario
 * @param {{ role: 'user'|'model', text: string }[]} history - Turnos previos (sin el mensaje actual)
 * @param {{ prompt?: string }} config - De app_settings.ai_config (campo prompt = instrucciones de área)
 * @param {string} [area] - Slug de área (ti, pam, educacion)
 * @returns {Promise<string|null>} Texto del modelo, mensaje genérico si no hay salida, o `null` si la llamada a Groq falló (excepción).
 */
async function getAiResponse(text, history, config, area) {
  const apiKey = String(process.env.GROQ_API_KEY || '').trim();
  if (!apiKey) return UNAVAILABLE_REPLY_MESSAGE;

  const systemInstruction = buildSystemInstruction(area, config?.prompt);

  try {
    const client = new OpenAI({
      apiKey,
      baseURL: 'https://api.groq.com/openai/v1',
    });

    const turns = buildLlmChatTurns(history);
    const messages = [
      { role: 'system', content: systemInstruction },
      ...llmTurnsToOpenAiMessages(turns),
      { role: 'user', content: String(text || '') },
    ];

    const completion = await client.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages,
    });

    const out = String(completion.choices[0]?.message?.content || '').trim();
    return out || UNAVAILABLE_REPLY_MESSAGE;
  } catch (e) {
    console.error('[Groq Error]:', e.message);
    return null;
  }
}

module.exports = { getAiResponse, UNAVAILABLE_REPLY_MESSAGE };
