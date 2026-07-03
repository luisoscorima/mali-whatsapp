import {
  buildTemplateDefinition,
  extractFormValuesForTemplate,
  validateTemplateFormValues,
} from '../templates/template-definition.util';
import { parseParamMappingFromBody } from './contact-template-params.util';
import {
  CAMPAIGN_SCHEDULE_MAX_DAYS,
  CAMPAIGN_SCHEDULE_MIN_MARGIN_MS,
  MAX_BATCH_DELAY_MS,
  MAX_BATCH_SIZE,
  MAX_BODY_PARAM_LEN,
  MAX_IMAGE_URL_LEN,
  readDefaultBatchDelayMs,
  readDefaultBatchSize,
} from './campaign-config.util';
import {
  parseCampaignAudience,
  parseCampaignExclusions,
} from './campaign-audience.util';

export type ValidatedCampaignSend = {
  audienceMode: 'multi' | 'legacy';
  segments: string[];
  recipientContactIds?: number[];
  excludeContactIds: number[];
  excludeSegmentSlugs: string[];
  excludeOpenServiceWindow: boolean;
  paramMapping: ReturnType<typeof parseParamMappingFromBody>;
  segment: string;
  templateSyncId: number;
  templateRow: {
    id: number;
    name: string;
    language: string;
    category: string | null;
    status: string;
    components_json: unknown;
    placeholder_aliases_json: unknown;
  };
  def: ReturnType<typeof buildTemplateDefinition>;
  values: ReturnType<typeof extractFormValuesForTemplate>;
  messageText: string;
  imageUrl: string | null;
  batchSize: number;
  batchDelayMs: number;
  isScheduled: boolean;
  scheduledAt: Date | null;
};

export function validateCampaignSend(
  reqBody: Record<string, unknown>,
  segmentSet: Set<string>,
  templateRow: {
    id: number;
    name: string;
    language: string;
    category: string | null;
    status: string;
    components_json: unknown;
    placeholder_aliases_json: unknown;
  } | null,
): { ok: true; value: ValidatedCampaignSend } | { ok: false; message: string } {
  const batchSize = Number(reqBody.batchSize ?? readDefaultBatchSize());
  const batchDelayMs = Number(reqBody.batchDelayMs ?? readDefaultBatchDelayMs());

  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
    return { ok: false, message: `Batch size invalido (1-${MAX_BATCH_SIZE})` };
  }
  if (
    !Number.isInteger(batchDelayMs) ||
    batchDelayMs < 0 ||
    batchDelayMs > MAX_BATCH_DELAY_MS
  ) {
    return {
      ok: false,
      message: `Batch delay invalido (0-${MAX_BATCH_DELAY_MS})`,
    };
  }

  const audience = parseCampaignAudience(reqBody, segmentSet);
  if (!audience.ok) return audience;

  const exclusions = parseCampaignExclusions(reqBody, segmentSet);
  if (!exclusions.ok) return exclusions;

  const excludeOpenServiceWindow = reqBody?.excludeOpenServiceWindow === true;

  const templateSyncId = parseInt(String(reqBody.templateSyncId || '').trim(), 10);
  if (!Number.isInteger(templateSyncId) || templateSyncId <= 0) {
    return { ok: false, message: 'Selecciona una plantilla sincronizada' };
  }
  if (!templateRow) {
    return { ok: false, message: 'Plantilla no encontrada. Sincroniza desde Meta.' };
  }

  const def = buildTemplateDefinition(templateRow);
  const values = extractFormValuesForTemplate(def, reqBody);
  const paramMapping = parseParamMappingFromBody(def, reqBody);

  if (def.needsHeaderMedia && values.headerMediaUrl.length > MAX_IMAGE_URL_LEN) {
    return { ok: false, message: `URL demasiado larga (max ${MAX_IMAGE_URL_LEN})` };
  }

  const v = validateTemplateFormValues(def, values, {
    maxBodyLen: MAX_BODY_PARAM_LEN,
    maxUrlLen: MAX_IMAGE_URL_LEN,
    paramMapping,
  });
  if (!v.ok) return v;

  const messageText = [
    def.needsHeaderMedia ? `media:${values.headerMediaUrl}` : '',
    ...values.headerParams,
    ...values.bodyParams,
    ...values.buttonParams,
  ]
    .filter(Boolean)
    .join(' | ');

  const scheduleMode = String(reqBody.scheduleMode || 'now')
    .trim()
    .toLowerCase();
  const isScheduled = scheduleMode === 'scheduled';
  let scheduledAt: Date | null = null;

  if (isScheduled) {
    const raw = String(reqBody.scheduledAt || '').trim();
    if (!raw) {
      return {
        ok: false,
        message: 'Indica fecha y hora para la campaña programada',
      };
    }
    const t = new Date(raw);
    if (Number.isNaN(t.getTime())) {
      return { ok: false, message: 'Fecha u hora de programación no válida' };
    }
    const minT = Date.now() + CAMPAIGN_SCHEDULE_MIN_MARGIN_MS;
    if (t.getTime() < minT) {
      return {
        ok: false,
        message: 'La programación debe ser al menos 1 minuto en el futuro',
      };
    }
    const maxMs = CAMPAIGN_SCHEDULE_MAX_DAYS * 24 * 60 * 60 * 1000;
    if (t.getTime() > Date.now() + maxMs) {
      return {
        ok: false,
        message: `La programación no puede superar ${CAMPAIGN_SCHEDULE_MAX_DAYS} días`,
      };
    }
    scheduledAt = t;
  }

  return {
    ok: true,
    value: {
      audienceMode: audience.mode,
      segments: audience.segments,
      recipientContactIds: audience.recipientContactIds,
      excludeContactIds: exclusions.excludeContactIds,
      excludeSegmentSlugs: exclusions.excludeSegmentSlugs,
      excludeOpenServiceWindow,
      paramMapping,
      segment: audience.segmentLabelForDb,
      templateSyncId,
      templateRow,
      def,
      values,
      messageText: messageText || '(sin parametros variables)',
      imageUrl: def.needsHeaderMedia ? values.headerMediaUrl : null,
      batchSize,
      batchDelayMs,
      isScheduled,
      scheduledAt,
    },
  };
}
