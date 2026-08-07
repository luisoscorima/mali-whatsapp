import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { normalizeArea } from '../config/areas';
import { PrismaService } from '../prisma/prisma.service';
import { CampaignQueueService } from '../queues/campaign-queue.service';
import { normalizePhone } from '../contacts/contacts-validation.utils';
import {
  buildTemplateDefinition,
  buildWhatsappGraphComponents,
} from '../templates/template-definition.util';
import { sendTemplateWithComponents } from '../templates/whatsapp-meta.util';
import { classifyCampaignSendError } from './campaign-incident.util';
import {
  readCampaignMaxManualRetries,
  readCampaignMaxRetryAttempts,
  readCampaignPhoneMinGapMs,
} from './campaign-config.util';
import {
  buildParamsForContact,
  fetchContactAttributesMap,
} from './contact-template-params.util';
import type { CampaignJobPayload } from './campaign-sender.service';
import {
  applyCampaignImageFallback,
  buildCampaignMessagePreview,
} from './campaign-message-preview.util';
import { persistCampaignChatMessage } from './campaign-chat-message.util';
import {
  campaignLogStatusColumnSql,
  ERROR_STATUSES,
  SALIDA_OK_STATUSES,
  sqlCampaignLogIsError,
  sqlInList,
} from './campaign-log-statuses.util';

const SALIDA_OK_IN = sqlInList(SALIDA_OK_STATUSES);
const ERROR_STATUS_IN = sqlInList(ERROR_STATUSES);

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeApiResponse(data: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(data ?? {}));
  } catch {
    return { message: 'respuesta no serializable' };
  }
}

function sanitizeApiErrorPayload(data: unknown): Record<string, unknown> {
  if (data && typeof data === 'object') {
    return sanitizeApiResponse(data) as Record<string, unknown>;
  }
  return { message: String(data || 'Error desconocido') };
}

function parseCampaignPayload(raw: unknown): CampaignJobPayload | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as CampaignJobPayload;
    } catch {
      return null;
    }
  }
  return raw as CampaignJobPayload;
}

function sqlNoSuccessfulLogForPhone(outerAlias = 'campaign_logs'): string {
  const okStatus = campaignLogStatusColumnSql('ok.status');
  return `NOT EXISTS (
    SELECT 1 FROM campaign_logs ok
    WHERE ok.campaign_id = ${outerAlias}.campaign_id
      AND ok.phone = ${outerAlias}.phone
      AND ok.id <> ${outerAlias}.id
      AND ${okStatus} IN ${SALIDA_OK_IN}
  )`;
}

type RetryCandidate = {
  id: number;
  contact_id: number | null;
  phone: string;
  attempt: number | null;
  whatsapp_message_id: string | null;
};

export type CampaignRetryResult = {
  retried: number;
  recovered: number;
  stillFailed: number;
  skippedWithoutResend?: number;
  skipped?: boolean;
  error?: string;
};

@Injectable()
export class CampaignRetryService {
  private readonly logger = new Logger(CampaignRetryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly campaignQueue: CampaignQueueService,
  ) {}

  enqueueRetryJob(campaignId: number, mode: 'auto' | 'manual' = 'auto'): void {
    void this.campaignQueue.enqueueRetry(campaignId, mode).catch((error) => {
      this.logger.error(
        `Error encolando reintento campaña #${campaignId}`,
        error instanceof Error ? error.stack : String(error),
      );
    });
  }

  private buildSendContext(payload: CampaignJobPayload) {
    const templateSnapshot = payload.templateSnapshot;
    if (!templateSnapshot) return null;
    const row = {
      id: templateSnapshot.id || 0,
      name: templateSnapshot.name,
      language: templateSnapshot.language,
      category: templateSnapshot.category || '',
      status: 'APPROVED',
      components_json: templateSnapshot.components_json,
      placeholder_aliases_json:
        templateSnapshot.placeholder_aliases_json ?? null,
    };
    const def = buildTemplateDefinition(row);
    return {
      area: normalizeArea(payload.area),
      templateSnapshot,
      def,
      staticParams: payload.staticParams || {
        headerParams: [],
        bodyParams: [],
        buttonParams: [],
        headerMediaUrl: '',
      },
      paramMapping: payload.paramMapping || null,
      batchDelayMs: Number(payload.batchDelayMs) || 0,
    };
  }

  private async fetchRetryCandidates(
    campaignId: number,
    maxAttempts: number,
  ): Promise<RetryCandidate[]> {
    // Si ya hay chat/wamid OK, el loop hace heal sin llamar a Meta
    // (incluimos esos logs para corregir "error" fantasma).
    return this.prisma.$queryRaw<RetryCandidate[]>(Prisma.sql`
      SELECT cl.id, cl.contact_id, cl.phone, cl.attempt, cl.whatsapp_message_id
      FROM campaign_logs cl
      WHERE cl.campaign_id = ${campaignId}
        AND ${Prisma.raw(sqlCampaignLogIsError('cl.status'))}
        AND cl.retryable = TRUE
        AND COALESCE(cl.attempt, 1) < ${maxAttempts}
        AND ${Prisma.raw(sqlNoSuccessfulLogForPhone('cl'))}
      ORDER BY cl.id ASC
    `);
  }

  /** Wamid ya persistido en chat para esta campaña + teléfono. */
  private async findExistingCampaignChatWaId(
    campaignId: number,
    phone: string,
  ): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<{ wa_message_id: string }[]>(
      Prisma.sql`
        SELECT m.wa_message_id
        FROM chat_messages m
        INNER JOIN conversations conv ON conv.id = m.conversation_id
        WHERE conv.phone = ${phone}
          AND m.direction = 'outbound'
          AND m.message_type = 'campaign'
          AND NULLIF(BTRIM(m.raw_payload->>'campaign_id'), '') ~ '^[0-9]+$'
          AND (m.raw_payload->>'campaign_id')::int = ${campaignId}
          AND m.wa_message_id IS NOT NULL
        ORDER BY m.id DESC
        LIMIT 1
      `,
    );
    const id = String(rows[0]?.wa_message_id || '').trim();
    return id || null;
  }

  /**
   * Evita que dos workers procesen el mismo log a la vez.
   * Marca retryable=false hasta resolver (éxito, heal o nuevo error).
   */
  private async claimRetryCandidate(
    row: RetryCandidate,
    maxAttempts: number,
  ): Promise<RetryCandidate | null> {
    const currentAttempt = Number(row.attempt || 1);
    const claimed = await this.prisma.$queryRaw<RetryCandidate[]>(Prisma.sql`
      UPDATE campaign_logs
      SET retryable = FALSE,
          last_retry_at = NOW()
      WHERE id = ${row.id}
        AND ${Prisma.raw(`${campaignLogStatusColumnSql('status')} IN ${ERROR_STATUS_IN}`)}
        AND retryable = TRUE
        AND COALESCE(attempt, 1) = ${currentAttempt}
        AND COALESCE(attempt, 1) < ${maxAttempts}
      RETURNING id, contact_id, phone, attempt, whatsapp_message_id
    `);
    return claimed[0] ?? null;
  }

  private async recoverWithoutResend(input: {
    campaignId: number;
    logId: number;
    phone: string;
    contactId: number | null;
    waMessageId: string;
    nextAttempt: number;
    area: string;
    templateName: string;
    preview: ReturnType<typeof buildCampaignMessagePreview>;
  }): Promise<void> {
    await this.prisma.campaign_logs.update({
      where: { id: input.logId },
      data: {
        status: 'sent',
        whatsapp_message_id: input.waMessageId,
        attempt: input.nextAttempt,
        retryable: false,
        last_retry_at: new Date(),
      },
    });

    try {
      await persistCampaignChatMessage(this.prisma, {
        area: input.area,
        campaignId: input.campaignId,
        templateName: input.templateName,
        contactId: input.contactId,
        phone: input.phone,
        waMessageId: input.waMessageId,
        preview: input.preview,
      });
    } catch (persistError) {
      this.logger.warn(
        `Reintento campaña #${input.campaignId}: heal sin reenvío, chat no persistido (${input.phone}): ${
          persistError instanceof Error ? persistError.message : persistError
        }`,
      );
    }
  }

  async runCampaignRetryJob(
    campaignId: number,
    mode: 'auto' | 'manual' = 'auto',
  ): Promise<CampaignRetryResult> {
    const maxAttempts = readCampaignMaxRetryAttempts();
    const maxManualRetries = readCampaignMaxManualRetries();

    const campaign = await this.prisma.campaigns.findUnique({
      where: { id: campaignId },
      select: {
        id: true,
        area: true,
        status: true,
        image_url: true,
        campaign_payload: true,
        auto_retry_done: true,
        manual_retry_count: true,
      },
    });

    if (!campaign) {
      return {
        retried: 0,
        recovered: 0,
        stillFailed: 0,
        skipped: true,
        error: 'Campaña no encontrada',
      };
    }

    const status = String(campaign.status || '');
    if (status === 'processing' || status === 'queued') {
      return {
        retried: 0,
        recovered: 0,
        stillFailed: 0,
        skipped: true,
        error: 'Campaña en envío',
      };
    }

    if (mode === 'auto') {
      const lock = await this.prisma.campaigns.updateMany({
        where: {
          id: campaignId,
          auto_retry_done: false,
          status: 'completed',
        },
        data: { auto_retry_done: true },
      });
      if (lock.count === 0) {
        return { retried: 0, recovered: 0, stillFailed: 0, skipped: true };
      }
    } else if (Number(campaign.manual_retry_count || 0) >= maxManualRetries) {
      return {
        retried: 0,
        recovered: 0,
        stillFailed: 0,
        skipped: true,
        error: `Límite de reintentos manuales (${maxManualRetries})`,
      };
    }

    const payload = parseCampaignPayload(campaign.campaign_payload);
    const sendCtx = payload ? this.buildSendContext(payload) : null;
    if (!sendCtx) {
      return {
        retried: 0,
        recovered: 0,
        stillFailed: 0,
        skipped: true,
        error: 'Payload de campaña inválido',
      };
    }

    const candidates = await this.fetchRetryCandidates(campaignId, maxAttempts);
    const contactIds = candidates
      .map((c) => c.contact_id)
      .filter((id): id is number => Number.isInteger(id) && id! > 0);

    const contactRows =
      contactIds.length > 0
        ? await this.prisma.contacts.findMany({
            where: { id: { in: contactIds } },
            select: { id: true, name: true, phone: true, email: true, dni: true },
          })
        : [];
    const contactById = new Map(contactRows.map((c) => [c.id, c]));

    const attrsMap =
      sendCtx.paramMapping && contactIds.length > 0
        ? await fetchContactAttributesMap(this.prisma, contactIds)
        : new Map();

    if (candidates.length === 0) {
      if (mode === 'manual') {
        await this.prisma.campaigns.update({
          where: { id: campaignId },
          data: {
            manual_retry_count: { increment: 1 },
            last_manual_retry_at: new Date(),
          },
        });
      }
      return { retried: 0, recovered: 0, stillFailed: 0 };
    }

    const retryDelayMs = Math.max(0, sendCtx.batchDelayMs * 2);
    const gapMs = readCampaignPhoneMinGapMs();
    let recovered = 0;
    let stillFailed = 0;
    let skippedWithoutResend = 0;
    let metaAttempts = 0;

    for (const row of candidates) {
      if (retryDelayMs > 0) {
        await wait(retryDelayMs);
      }

      const phoneNorm = normalizePhone(row.phone);
      if (!phoneNorm) {
        stillFailed += 1;
        continue;
      }

      const claimed = await this.claimRetryCandidate(row, maxAttempts);
      if (!claimed) {
        continue;
      }

      const nextAttempt = Number(claimed.attempt || 1) + 1;
      const contact = claimed.contact_id
        ? contactById.get(claimed.contact_id)
        : null;

      const resolvedParams = sendCtx.paramMapping
        ? buildParamsForContact(
            sendCtx.staticParams,
            sendCtx.paramMapping,
            contact || { name: '', phone: claimed.phone },
            contact ? attrsMap.get(contact.id) : undefined,
          )
        : sendCtx.staticParams;
      const preview = applyCampaignImageFallback(
        buildCampaignMessagePreview(
          sendCtx.def,
          sendCtx.templateSnapshot.components_json,
          resolvedParams,
        ),
        campaign.image_url,
      );
      const templateName = String(sendCtx.templateSnapshot.name || '');

      const existingWaId =
        String(claimed.whatsapp_message_id || '').trim() ||
        (await this.findExistingCampaignChatWaId(campaignId, phoneNorm));

      // Meta ya aceptó (hay wamid en log o en chat): no volver a enviar.
      if (existingWaId) {
        await this.recoverWithoutResend({
          campaignId,
          logId: claimed.id,
          phone: phoneNorm,
          contactId: claimed.contact_id,
          waMessageId: existingWaId,
          nextAttempt,
          area: sendCtx.area,
          templateName,
          preview,
        });
        this.logger.log(
          `Campaña #${campaignId}: skip reenvío Meta (${phoneNorm}); wamid existente ${existingWaId}`,
        );
        skippedWithoutResend += 1;
        recovered += 1;
        continue;
      }

      if (gapMs > 0) {
        const last = await this.prisma.campaign_logs.findFirst({
          where: { phone: phoneNorm },
          orderBy: { created_at: 'desc' },
          select: { created_at: true },
        });
        if (last?.created_at) {
          const elapsed = Date.now() - last.created_at.getTime();
          if (elapsed < gapMs) {
            await wait(gapMs - elapsed);
          }
        }
      }

      try {
        const components = buildWhatsappGraphComponents(
          sendCtx.def,
          resolvedParams,
        );

        metaAttempts += 1;
        const apiResponse = await sendTemplateWithComponents({
          to: phoneNorm,
          templateName: sendCtx.templateSnapshot.name,
          languageCode: sendCtx.templateSnapshot.language,
          components,
          area: sendCtx.area,
        });

        const messageId = apiResponse.messages?.[0]?.id || null;

        await this.prisma.campaign_logs.update({
          where: { id: claimed.id },
          data: {
            status: 'sent',
            whatsapp_message_id: messageId,
            response: sanitizeApiResponse(apiResponse) as object,
            attempt: nextAttempt,
            retryable: false,
            last_retry_at: new Date(),
          },
        });

        try {
          await persistCampaignChatMessage(this.prisma, {
            area: sendCtx.area,
            campaignId,
            templateName,
            contactId: claimed.contact_id,
            phone: phoneNorm,
            waMessageId: messageId,
            preview,
            apiResponse: sanitizeApiResponse(apiResponse),
          });
        } catch (persistError) {
          this.logger.warn(
            `Reintento campaña #${campaignId}: no se pudo guardar mensaje en conversación (${phoneNorm}): ${
              persistError instanceof Error
                ? persistError.message
                : persistError
            }`,
          );
        }
        recovered += 1;
      } catch (error) {
        const err = error as Error & { response?: { data?: unknown } };
        const payloadErr = sanitizeApiErrorPayload(
          err.response?.data || { message: err.message },
        );
        const classification = classifyCampaignSendError(payloadErr);

        await this.prisma.campaign_logs.update({
          where: { id: claimed.id },
          data: {
            status: 'error',
            response: payloadErr as object,
            attempt: nextAttempt,
            retryable: classification.retryable,
            last_retry_at: new Date(),
          },
        });
        stillFailed += 1;
      }
    }

    if (mode === 'manual') {
      await this.prisma.campaigns.update({
        where: { id: campaignId },
        data: {
          manual_retry_count: { increment: 1 },
          last_manual_retry_at: new Date(),
        },
      });
    }

    return {
      retried: metaAttempts,
      recovered,
      stillFailed,
      skippedWithoutResend,
    };
  }

  async promoteDueCampaignRetries(limit = 50): Promise<void> {
    const rows = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
      SELECT id FROM campaigns
      WHERE status = 'completed'
        AND auto_retry_done = FALSE
        AND auto_retry_at IS NOT NULL
        AND auto_retry_at <= NOW()
      ORDER BY auto_retry_at ASC
      LIMIT ${limit}
    `);
    for (const row of rows) {
      this.enqueueRetryJob(row.id, 'auto');
    }
  }
}
