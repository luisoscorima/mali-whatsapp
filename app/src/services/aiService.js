const { GoogleGenerativeAI } = require('@google/generative-ai');

/**
 * Convierte el historial local a {@link Content} del SDK: roles `user` | `model`,
 * `parts: [{ text }]`, sin textos vacíos, empezando siempre por `user` y
 * fusionando turnos consecutivos del mismo rol (alternancia estable para Gemini 2.x).
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
 * @param {{ prompt?: string }} config - De app_settings.ai_config (campo prompt = instrucciones de sistema)
 * @returns {Promise<string>}
 */
async function getAiResponse(text, history, config) {
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY no configurada');
  }
  const systemInstruction =
    String(config?.prompt || '').trim() || 'Eres un asistente útil. Responde en español.';

  const genAI = new GoogleGenerativeAI(apiKey);
  // Gemini 2.5: razonamiento interno vía generationConfig.thinkingConfig (no existe `thinking: true` en el tipo del SDK).
  const generationConfig = {
    thinkingConfig: {
      thinkingBudget: -1,
    },
  };

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction,
    generationConfig,
  });

  const contents = buildGeminiChatContents(history);
  const chat = model.startChat({ history: contents });
  const result = await chat.sendMessage(String(text || ''));
  return String(result.response.text() || '').trim();
}

module.exports = { getAiResponse };
