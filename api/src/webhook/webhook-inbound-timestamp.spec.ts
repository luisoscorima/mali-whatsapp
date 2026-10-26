import { parseWhatsAppInboundTimestamp } from './webhook-inbound.util';

describe('parseWhatsAppInboundTimestamp', () => {
  const nowMs = Date.UTC(2026, 9, 26, 18, 0, 0); // 26 oct 2026 18:00 UTC

  it('usa el timestamp Unix de Meta en segundos', () => {
    const metaSec = Math.floor(Date.UTC(2026, 9, 25, 11, 55, 55) / 1000);
    const parsed = parseWhatsAppInboundTimestamp(
      { timestamp: String(metaSec) },
      nowMs,
    );
    expect(parsed?.toISOString()).toBe('2026-10-25T11:55:55.000Z');
  });

  it('devuelve null si falta o es inválido', () => {
    expect(parseWhatsAppInboundTimestamp({}, nowMs)).toBeNull();
    expect(parseWhatsAppInboundTimestamp({ timestamp: 'abc' }, nowMs)).toBeNull();
    expect(parseWhatsAppInboundTimestamp({ timestamp: '0' }, nowMs)).toBeNull();
  });

  it('rechaza timestamps demasiado a futuro', () => {
    const futureSec = Math.floor(nowMs / 1000) + 60 * 60;
    expect(
      parseWhatsAppInboundTimestamp({ timestamp: String(futureSec) }, nowMs),
    ).toBeNull();
  });
});
