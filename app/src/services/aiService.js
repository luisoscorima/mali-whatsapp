const { GoogleGenerativeAI } = require('@google/generative-ai');

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
  const model = genAI.getGenerativeModel({
    model: 'gemini-1.5-flash',
    systemInstruction,
  });

  const hist = (Array.isArray(history) ? history : []).map((h) => ({
    role: h.role === 'model' ? 'model' : 'user',
    parts: [{ text: String(h.text || '') }],
  }));

  const chat = model.startChat({ history: hist });
  const result = await chat.sendMessage(String(text || ''));
  return String(result.response.text() || '').trim();
}

module.exports = { getAiResponse };
