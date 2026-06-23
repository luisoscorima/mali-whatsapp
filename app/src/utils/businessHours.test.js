const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseBusinessHoursConfig,
  isBusinessHoursConfigOperational,
  isWithinBusinessHours,
  validateBusinessHoursInput,
  parseTimeToMinutes,
} = require('./businessHours');

describe('parseTimeToMinutes', () => {
  it('acepta HH:MM valido', () => {
    assert.equal(parseTimeToMinutes('09:00'), 540);
    assert.equal(parseTimeToMinutes('18:00'), 1080);
  });
  it('rechaza formatos invalidos', () => {
    assert.equal(parseTimeToMinutes('9:00'), null);
    assert.equal(parseTimeToMinutes('25:00'), null);
  });
});

describe('parseBusinessHoursConfig', () => {
  it('parsea JSON valido', () => {
    const cfg = parseBusinessHoursConfig(
      JSON.stringify({
        enabled: true,
        timezone: 'America/Lima',
        days: [1, 2, 3],
        from: '09:00',
        to: '18:00',
        outside_hours_message: 'Cerrado',
      })
    );
    assert.equal(cfg.enabled, true);
    assert.deepEqual(cfg.days, [1, 2, 3]);
    assert.equal(cfg.fromMinutes, 540);
    assert.equal(cfg.outside_hours_message, 'Cerrado');
  });
  it('devuelve null con JSON invalido', () => {
    assert.equal(parseBusinessHoursConfig('{'), null);
  });
});

describe('isBusinessHoursConfigOperational', () => {
  it('requiere enabled, dias, horas y mensaje', () => {
    const base = {
      enabled: true,
      days: [1],
      fromMinutes: 540,
      toMinutes: 1080,
      outside_hours_message: 'Hola',
    };
    assert.equal(isBusinessHoursConfigOperational(base), true);
    assert.equal(isBusinessHoursConfigOperational({ ...base, enabled: false }), false);
    assert.equal(isBusinessHoursConfigOperational({ ...base, outside_hours_message: '' }), false);
  });
});

describe('isWithinBusinessHours', () => {
  const cfg = {
    timezone: 'America/Lima',
    days: [1, 2, 3, 4, 5],
    fromMinutes: 540,
    toMinutes: 1080,
    from: '09:00',
    to: '18:00',
  };

  it('dentro de horario en dia laboral', () => {
    const t = new Date('2026-06-22T15:00:00.000Z');
    assert.equal(isWithinBusinessHours(cfg, t), true);
  });

  it('fuera de horario por hora', () => {
    const t = new Date('2026-06-22T02:00:00.000Z');
    assert.equal(isWithinBusinessHours(cfg, t), false);
  });

  it('fuera de horario en fin de semana', () => {
    const t = new Date('2026-06-21T15:00:00.000Z');
    assert.equal(isWithinBusinessHours(cfg, t), false);
  });

  it('limite: desde inclusive, hasta exclusive', () => {
    const mondayNine = new Date('2026-06-22T14:00:00.000Z');
    const mondaySix = new Date('2026-06-22T23:00:00.000Z');
    assert.equal(isWithinBusinessHours(cfg, mondayNine), true);
    assert.equal(isWithinBusinessHours(cfg, mondaySix), false);
  });
});

describe('validateBusinessHoursInput', () => {
  it('exige mensaje al activar', () => {
    const r = validateBusinessHoursInput(
      { enabled: true, days: [1], from: '09:00', to: '18:00', outside_hours_message: '' },
      4096
    );
    assert.ok(r.error);
  });
  it('acepta config valida activa', () => {
    const r = validateBusinessHoursInput(
      {
        enabled: true,
        days: [1, 2],
        from: '09:00',
        to: '18:00',
        outside_hours_message: 'Gracias',
      },
      4096
    );
    assert.equal(r.error, undefined);
    assert.equal(r.config.enabled, true);
    assert.deepEqual(r.config.days, [1, 2]);
  });
  it('permite desactivado sin mensaje', () => {
    const r = validateBusinessHoursInput({ enabled: false, days: [], from: '', to: '' }, 4096);
    assert.equal(r.error, undefined);
    assert.equal(r.config.enabled, false);
  });
});
