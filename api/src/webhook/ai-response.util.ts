import { AREA_LABELS, type BusinessArea } from '../config/areas';

export const UNAVAILABLE_REPLY_MESSAGE =
  'Lo siento, estamos experimentando una carga alta de consultas. Por favor, intenta de nuevo en unos momentos.';

export const TRANSFER_TO_HUMAN_NOTICE =
  'He derivado tu consulta a un asesor. En breve te atenderán.';

type AiTurn = { role: 'user' | 'model'; text: string };

function areaDisplayName(areaSlug: string): string {
  const k = String(areaSlug || '').trim().toLowerCase();
  return (
    AREA_LABELS[k as BusinessArea] ||
    (k ? k.charAt(0).toUpperCase() + k.slice(1) : 'MALI')
  );
}

function buildSystemInstruction(areaSlug: string, prompt: string): string {
  const areaName = areaDisplayName(areaSlug);
  const p =
    String(prompt || '').trim() || 'Eres un asistente útil. Responde en español.';
  return `Actúa como el asistente de ${areaName} del MALI.\n\n${p}`;
}

function buildLlmChatTurns(history: AiTurn[]): { role: string; text: string }[] {
  const normalized = (Array.isArray(history) ? history : [])
    .map((h) => ({
      role: h.role === 'model' ? 'model' : 'user',
      text: String(h.text || '').trim(),
    }))
    .filter((h) => h.text.length > 0);

  const merged: { role: string; text: string }[] = [];
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
    text: h.text.slice(0, maxChars),
  }));
}

export async function getAiResponse(
  text: string,
  history: AiTurn[],
  config: { prompt?: string; transfer_keyword?: string },
  area?: string,
): Promise<string | null> {
  const apiKey = String(process.env.GROQ_API_KEY || '').trim();
  if (!apiKey) return UNAVAILABLE_REPLY_MESSAGE;

  const transferKw =
    String(config?.transfer_keyword ?? '[TRANSFERIR]').trim() || '[TRANSFERIR]';
  const systemInstruction = buildSystemInstruction(area || '', config?.prompt || '');
  const fechaParaIA = new Date().toLocaleString('es-PE', {
    timeZone: 'America/Lima',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
  const systemPrompt = `\n\n[FECHA Y HORA ACTUAL DEL SISTEMA: ${fechaParaIA}].\n\n${systemInstruction}\n\nSi necesitas transferir, usa exactamente esta frase: ${transferKw}`;

  try {
    const turns = buildLlmChatTurns(history);
    const messages: { role: string; content: string }[] = [
      { role: 'system', content: systemPrompt },
      ...turns.map((c) => ({
        role: c.role === 'model' ? 'assistant' : 'user',
        content: c.text,
      })),
      { role: 'user', content: String(text || '') },
    ];

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages,
      }),
    });

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
      error?: { message?: string };
    };

    if (!response.ok) {
      throw new Error(data?.error?.message || `Groq error ${response.status}`);
    }

    const out = String(data.choices?.[0]?.message?.content || '').trim();
    return out || UNAVAILABLE_REPLY_MESSAGE;
  } catch {
    return null;
  }
}
