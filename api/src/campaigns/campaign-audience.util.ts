import { readMaxExcludeContactIds } from './campaign-recipients.util';

export type CampaignAudience =
  | {
      ok: true;
      mode: 'multi';
      segments: string[];
      recipientContactIds: number[];
      segmentLabelForDb: string;
    }
  | {
      ok: true;
      mode: 'legacy';
      segments: string[];
      recipientContactIds: undefined;
      segmentLabelForDb: string;
    }
  | { ok: false; message: string };

export type CampaignExclusions =
  | {
      ok: true;
      excludeContactIds: number[];
      excludeSegmentSlugs: string[];
    }
  | { ok: false; message: string };

export function parseCampaignExclusions(
  reqBody: Record<string, unknown>,
  segmentSet: Set<string>,
): CampaignExclusions {
  const maxIds = readMaxExcludeContactIds();

  let excludeContactIds: number[] = [];
  if (Object.prototype.hasOwnProperty.call(reqBody, 'excludeContactIds')) {
    const raw = reqBody.excludeContactIds;
    if (!Array.isArray(raw)) {
      return { ok: false, message: 'Lista de exclusiones por contacto inválida' };
    }
    const ids = raw
      .map((x) => Number(x))
      .filter((n) => Number.isInteger(n) && n > 0);
    excludeContactIds = [...new Set(ids)].sort((a, b) => a - b);
    if (excludeContactIds.length > maxIds) {
      return {
        ok: false,
        message: `Demasiados contactos a excluir (máximo ${maxIds})`,
      };
    }
  }

  let excludeSegmentSlugs: string[] = [];
  if (Object.prototype.hasOwnProperty.call(reqBody, 'excludeSegmentSlugs')) {
    const raw = reqBody.excludeSegmentSlugs;
    if (!Array.isArray(raw)) {
      return { ok: false, message: 'Segmentos de exclusión inválidos' };
    }
    excludeSegmentSlugs = [
      ...new Set(raw.map((s) => String(s).trim()).filter(Boolean)),
    ];
    for (const s of excludeSegmentSlugs) {
      if (!segmentSet.has(s)) {
        return { ok: false, message: 'Segmento de exclusión inválido' };
      }
    }
  }

  return { ok: true, excludeContactIds, excludeSegmentSlugs };
}

export function parseCampaignAudience(
  reqBody: Record<string, unknown>,
  segmentSet: Set<string>,
): CampaignAudience {
  const maxIds = readMaxExcludeContactIds();
  const hasRecipientIdsKey = Object.prototype.hasOwnProperty.call(
    reqBody,
    'recipientContactIds',
  );

  if (hasRecipientIdsKey) {
    const raw = reqBody.recipientContactIds;
    if (!Array.isArray(raw)) {
      return { ok: false, message: 'Lista de destinatarios inválida' };
    }
    const ids = raw
      .map((x) => Number(x))
      .filter((n) => Number.isInteger(n) && n > 0);
    const uniqueIds = [...new Set(ids)].sort((a, b) => a - b);
    if (uniqueIds.length === 0) {
      return { ok: false, message: 'Selecciona al menos un destinatario' };
    }
    if (uniqueIds.length > maxIds) {
      return {
        ok: false,
        message: `Demasiados destinatarios (máximo ${maxIds})`,
      };
    }

    let segments: string[] = [];
    if (Array.isArray(reqBody.segments)) {
      segments = [
        ...new Set(reqBody.segments.map((s) => String(s).trim()).filter(Boolean)),
      ];
    }
    if (segments.length === 0) {
      return { ok: false, message: 'Selecciona al menos un segmento' };
    }
    for (const s of segments) {
      if (!segmentSet.has(s)) {
        return { ok: false, message: 'Segmento invalido' };
      }
    }
    return {
      ok: true,
      mode: 'multi',
      segments,
      recipientContactIds: uniqueIds,
      segmentLabelForDb: segments.join(', '),
    };
  }

  const segment = String(reqBody.segment || '').trim();
  if (!segmentSet.has(segment)) {
    return { ok: false, message: 'Segmento invalido' };
  }
  return {
    ok: true,
    mode: 'legacy',
    segments: [segment],
    recipientContactIds: undefined,
    segmentLabelForDb: segment,
  };
}
