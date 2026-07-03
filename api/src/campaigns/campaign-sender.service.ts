import { Injectable, Logger } from '@nestjs/common';
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
import { readCampaignAutoRetryDelayMinutes, readCampaignPhoneMinGapMs } from './campaign-config.util';
import {
  buildParamsForContact,
  fetchContactAttributesMap,
  type StaticTemplateParams,
} from './contact-template-params.util';
import type { ParamMapping } from '../templates/template-definition.util';
import {
  fetchRecipientsUnion,
  type RecipientRow,
} from './campaign-recipients.util';

export type CampaignTemplateSnapshot = {
  id: number;
  name: string;
  language: string;
  category: string | null;
  components_json: unknown;
};

export type CampaignJobPayload = {
  area: string;
  segments?: string[];
  segment?: string;
  recipientContactIds?: number[];
  excludeContactIds?: number[];
  excludeSegmentSlugs?: string[];
  excludeOpenServiceWindow?: boolean;
  excludeContactIdsMerged?: number[];
  templateSnapshot: CampaignTemplateSnapshot;
  staticParams: StaticTemplateParams;
  paramMapping: ParamMapping | null;
  batchSize: number;
  batchDelayMs: number;
};

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

@Injectable()
export class CampaignSenderService {
  private readonly logger = new Logger(CampaignSenderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly campaignQueue: CampaignQueueService,
  ) {}

  enqueueSendJob(campaignId: number, payload: CampaignJobPayload): void {
    void this.campaignQueue.enqueueSend(campaignId, payload).catch((error) => {
      this.logger.error(
        `Error encolando envío campaña #${campaignId}`,
        error instanceof Error ? error.stack : String(error),
      );
    });
  }

  private async buildCampaignRecipients(
    area: string,
    ctx: CampaignJobPayload,
  ): Promise<RecipientRow[]> {
    const recipientOptions: {
      excludeContactIds?: number[];
      excludeSegmentSlugs?: string[];
      excludeOpenServiceWindow?: boolean;
      contactIds?: number[];
    } = {};

    let mergedExclude =
      Array.isArray(ctx.excludeContactIdsMerged) &&
      ctx.excludeContactIdsMerged.length > 0
        ? ctx.excludeContactIdsMerged
        : Array.isArray(ctx.excludeContactIds) && ctx.excludeContactIds.length > 0
          ? ctx.excludeContactIds
          : [];

    if (mergedExclude.length > 0) {
      recipientOptions.excludeContactIds = mergedExclude;
    }
    if (Array.isArray(ctx.excludeSegmentSlugs) && ctx.excludeSegmentSlugs.length > 0) {
      recipientOptions.excludeSegmentSlugs = ctx.excludeSegmentSlugs;
    }
    if (ctx.excludeOpenServiceWindow) {
      recipientOptions.excludeOpenServiceWindow = true;
    }

    if (
      Array.isArray(ctx.recipientContactIds) &&
      ctx.recipientContactIds.length > 0 &&
      Array.isArray(ctx.segments) &&
      ctx.segments.length > 0
    ) {
      return fetchRecipientsUnion(this.prisma, area, ctx.segments, {
        ...recipientOptions,
        contactIds: ctx.recipientContactIds,
      });
    }
    if (ctx.segment) {
      return fetchRecipientsUnion(this.prisma, area, [ctx.segment], recipientOptions);
    }
    if (Array.isArray(ctx.segments) && ctx.segments.length > 0) {
      return fetchRecipientsUnion(this.prisma, area, ctx.segments, recipientOptions);
    }
    throw new Error('Payload de campaña inválido: falta segmento o lista de destinatarios');
  }

  private async fetchProcessedRecipientState(campaignId: number) {
    const rows = await this.prisma.campaign_logs.findMany({
      where: { campaign_id: campaignId },
      select: { contact_id: true, phone: true },
    });
    const contactIds = new Set<number>();
    const phones = new Set<string>();
    for (const row of rows) {
      if (Number.isInteger(row.contact_id) && row.contact_id! > 0) {
        contactIds.add(row.contact_id!);
      }
      if (row.phone) {
        phones.add(normalizePhone(row.phone));
      }
    }
    return { contactIds, phones };
  }

  private filterPendingRecipients(
    recipients: RecipientRow[],
    processedState: { contactIds: Set<number>; phones: Set<string> },
  ): RecipientRow[] {
    return recipients.filter((contact) => {
      if (processedState.contactIds.has(contact.id)) return false;
      const phoneNorm = normalizePhone(contact.phone);
      if (phoneNorm && processedState.phones.has(phoneNorm)) return false;
      return true;
    });
  }

  async runCampaignSendJob(
    campaignId: number,
    ctx: CampaignJobPayload,
  ): Promise<void> {
    const {
      area: areaRaw,
      templateSnapshot,
      staticParams,
      paramMapping,
      batchSize,
      batchDelayMs,
    } = ctx;
    const area = normalizeArea(areaRaw);

    const row = {
      id: templateSnapshot.id || 0,
      name: templateSnapshot.name,
      language: templateSnapshot.language,
      category: templateSnapshot.category || '',
      status: 'APPROVED',
      components_json: templateSnapshot.components_json,
      placeholder_aliases_json: null,
    };
    const def = buildTemplateDefinition(row);
    const usePerContactParams = Boolean(paramMapping);

    try {
      const lock = await this.prisma.campaigns.updateMany({
        where: { id: campaignId, status: 'queued' },
        data: { status: 'processing' },
      });
      if (lock.count === 0) {
        return;
      }

      const allRecipients = await this.buildCampaignRecipients(area, ctx);
      await this.prisma.campaigns.update({
        where: { id: campaignId },
        data: { total_recipients: allRecipients.length },
      });

      const processedState = await this.fetchProcessedRecipientState(campaignId);
      const recipients = this.filterPendingRecipients(allRecipients, processedState);

      let attrsMap = new Map<number, Record<string, string>>();
      if (usePerContactParams) {
        attrsMap = await fetchContactAttributesMap(
          this.prisma,
          recipients.map((c) => c.id),
        );
      }

      const gapMs = readCampaignPhoneMinGapMs();

      for (let i = 0; i < recipients.length; i += batchSize) {
        const batch = recipients.slice(i, i + batchSize);

        for (const contact of batch) {
          try {
            const phoneNorm = normalizePhone(contact.phone);
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

            const resolvedParams = usePerContactParams
              ? buildParamsForContact(
                  staticParams,
                  paramMapping,
                  contact,
                  attrsMap.get(contact.id),
                )
              : staticParams;
            const components = buildWhatsappGraphComponents(def, resolvedParams);

            const apiResponse = await sendTemplateWithComponents({
              to: phoneNorm,
              templateName: templateSnapshot.name,
              languageCode: templateSnapshot.language,
              components,
              area,
            });

            const messageId = apiResponse.messages?.[0]?.id || null;

            await this.prisma.campaign_logs.create({
              data: {
                campaign_id: campaignId,
                contact_id: contact.id,
                phone: phoneNorm,
                whatsapp_message_id: messageId,
                status: 'sent',
                response: sanitizeApiResponse(apiResponse) as object,
              },
            });
          } catch (error) {
            const err = error as Error & { response?: { data?: unknown } };
            const payload = sanitizeApiErrorPayload(
              err.response?.data || { message: err.message },
            );
            const { retryable } = classifyCampaignSendError(payload);

            await this.prisma.campaign_logs.create({
              data: {
                campaign_id: campaignId,
                contact_id: contact.id,
                phone: normalizePhone(contact.phone),
                status: 'error',
                response: payload as object,
                retryable,
                attempt: 1,
              },
            });
            this.logger.warn(
              `Error enviando campaña #${campaignId} contacto ${contact.id}: ${err.message}`,
            );
          }
        }

        if (i + batchSize < recipients.length) {
          await wait(batchDelayMs);
        }
      }

      const autoRetryMinutes = readCampaignAutoRetryDelayMinutes();
      await this.prisma.$executeRaw`
        UPDATE campaigns
        SET status = 'completed',
            auto_retry_at = NOW() + (${autoRetryMinutes}::int * interval '1 minute'),
            auto_retry_done = FALSE
        WHERE id = ${campaignId}
      `;
    } catch (error) {
      try {
        await this.prisma.campaigns.update({
          where: { id: campaignId },
          data: { status: 'failed' },
        });
      } catch {
        /* ignore */
      }
      throw error;
    }
  }
}
