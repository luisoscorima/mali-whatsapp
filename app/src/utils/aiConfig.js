/**
 * Configuración IA por área (`app_settings`, key `ai_config`, value JSON en texto).
 */
function parseAiConfigValue(raw) {
  if (raw == null || String(raw).trim() === '') return null;
  try {
    const o = JSON.parse(String(raw));
    return {
      enabled: Boolean(o.enabled),
      prompt: String(o.prompt ?? ''),
      transfer_keyword: String(o.transfer_keyword ?? '[TRANSFERIR]'),
    };
  } catch {
    return null;
  }
}

function isAiAreaEnabledFromSettingsRow(valueRow) {
  const cfg = parseAiConfigValue(valueRow);
  return Boolean(cfg && cfg.enabled);
}

module.exports = { parseAiConfigValue, isAiAreaEnabledFromSettingsRow };
