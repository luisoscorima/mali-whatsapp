export type AiConfig = {
  enabled: boolean;
  prompt: string;
  transfer_keyword: string;
};

export function parseAiConfigValue(raw: unknown): AiConfig | null {
  if (raw == null || String(raw).trim() === '') return null;
  try {
    const o = JSON.parse(String(raw)) as Record<string, unknown>;
    return {
      enabled: Boolean(o.enabled),
      prompt: String(o.prompt ?? ''),
      transfer_keyword: String(o.transfer_keyword ?? '[TRANSFERIR]'),
    };
  } catch {
    return null;
  }
}

export function defaultAiConfig(): AiConfig {
  return {
    enabled: false,
    prompt: '',
    transfer_keyword: '[TRANSFERIR]',
  };
}

export function defaultAiConfigSeed(): AiConfig {
  return {
    enabled: true,
    prompt:
      'Eres un asistente virtual del MALI. Responde en español de forma breve y profesional. Si el usuario necesita hablar con un humano, responde únicamente con la palabra clave de transferencia que se te indica.',
    transfer_keyword: '[TRANSFERIR]',
  };
}
