const { GoogleGenerativeAI } = require('@google/generative-ai');

const GEMINI_UNAVAILABLE_MESSAGE =
  'Lo siento, estoy experimentando una alta carga de consultas. Por favor, intenta de nuevo en unos momentos.';

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
 * Convierte el historial local a {@link Content} del SDK: roles `user` | `model`,
 * `parts: [{ text }]`, sin textos vacíos, empezando siempre por `user` y
 * fusionando turnos consecutivos del mismo rol (alternancia estable multi-turno).
 *
 * @param {{ role: 'user'|'model', text: string }[]} history
 * @returns {{ role: string, parts: { text: string }[] }[]}
 */
function buildGeminiChatContents(history) {
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
 * @param {string} text - Mensaje actual del usuario
 * @param {{ role: 'user'|'model', text: string }[]} history - Turnos previos (sin el mensaje actual)
 * @param {{ prompt?: string }} config - De app_settings.ai_config (campo prompt = instrucciones de área)
 * @param {string} [area] - Slug de área (ti, pam, educacion)
 * @returns {Promise<string>}
 */
async function getAiResponse(text, history, config, area) {
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    return GEMINI_UNAVAILABLE_MESSAGE;
  }
  const systemInstruction = buildSystemInstruction(area, config?.prompt);

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel(
      {
        model: 'gemini-2.5-flash',
        systemInstruction,
      },
      { apiVersion: 'v1beta' }
    );

    const contents = buildGeminiChatContents(history);
    const chat = model.startChat({ history: contents });
    const result = await chat.sendMessage(String(text || ''));
    const out = String(result.response.text() || '').trim();
    return out || GEMINI_UNAVAILABLE_MESSAGE;
  } catch (e) {
    console.log(
      JSON.stringify({
        level: 'warn',
        message: 'Gemini getAiResponse falló; respuesta genérica al cliente',
        error: e && e.message ? e.message : String(e),
      })
    );
    return GEMINI_UNAVAILABLE_MESSAGE;
  }
}

module.exports = { getAiResponse };
