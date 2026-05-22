/**
 * Texto legible para UI/CSV a partir de campaign_logs.response (API Meta o webhook).
 */

function parseResponseObject(response) {
  if (response == null || response === '') return null;
  if (typeof response === 'object') return response;
  if (typeof response === 'string') {
    try {
      return JSON.parse(response);
    } catch {
      return null;
    }
  }
  return null;
}

function summarizeCampaignLogResponse(response) {
  const data = parseResponseObject(response);
  if (!data || typeof data !== 'object') {
    return 'Sin detalle Meta';
  }

  const err = data.error;
  if (err && typeof err === 'object') {
    const parts = [];
    if (err.code != null && err.code !== '') parts.push(`Código ${err.code}`);
    const msg = err.message || data.message;
    if (msg) parts.push(String(msg).trim());
    if (parts.length) return parts.join(' · ');
  }

  const webhookErrors = Array.isArray(data.errors) ? data.errors : [];
  if (webhookErrors.length > 0) {
    const e0 = webhookErrors[0];
    if (e0 && typeof e0 === 'object') {
      const parts = [];
      if (e0.code != null && e0.code !== '') parts.push(`Código ${e0.code}`);
      const msg = e0.message || e0.title || e0.error_data?.details;
      if (msg) parts.push(String(msg).trim());
      if (parts.length) return parts.join(' · ');
    }
  }

  if (data.message) {
    return String(data.message).trim();
  }

  return 'Sin detalle Meta';
}

function csvEscapeCell(value) {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildCampaignFailedLogsCsv(logs, formatDate) {
  const format = typeof formatDate === 'function' ? formatDate : (d) => String(d ?? '');
  const header = ['telefono', 'estado', 'motivo', 'fecha_envio'];
  const lines = [header.join(',')];
  for (const log of logs) {
    lines.push(
      [
        csvEscapeCell(log.phone),
        csvEscapeCell(log.status),
        csvEscapeCell(log.error_summary || summarizeCampaignLogResponse(log.response)),
        csvEscapeCell(format(log.created_at)),
      ].join(',')
    );
  }
  return `${lines.join('\n')}\n`;
}

module.exports = {
  parseResponseObject,
  summarizeCampaignLogResponse,
  buildCampaignFailedLogsCsv,
};
