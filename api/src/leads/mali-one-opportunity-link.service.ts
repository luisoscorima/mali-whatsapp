import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';

/**
 * Aditivo: tras captación WA, vincula ciclo a oportunidad comercial nativa en ONE
 * (p.ej. ingresada desde Chatwoot/Prospectia). Si ONE cae, el chat sigue.
 */
@Injectable()
export class MaliOneOpportunityLinkService {
  private readonly logger = new Logger(MaliOneOpportunityLinkService.name);

  constructor(private readonly config: AppConfigService) {}

  private configured(): { base: string; token: string } | null {
    const base = this.config.maliOneApiBaseUrl;
    const token = this.config.maliOneCrmEducacionServiceToken;
    if (!base || !token) return null;
    return { base, token };
  }

  async tryLinkCycle(input: {
    waCycleId: number;
    waContactId?: number;
    phone?: string | null;
    email?: string | null;
    markInbound?: boolean;
  }): Promise<{ linked: boolean } | null> {
    if (!Number.isInteger(input.waCycleId) || input.waCycleId < 1) return null;
    const cfg = this.configured();
    if (!cfg) return null;
    const phone = String(input.phone ?? '').trim();
    const email = String(input.email ?? '').trim().toLowerCase();
    if (!phone && !email) return null;
    const url = `${cfg.base}/api/crm-educacion/internal/opportunities/link-cycle`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'x-crm-educacion-service-token': cfg.token,
        },
        body: JSON.stringify({
          waCycleId: input.waCycleId,
          waContactId: input.waContactId,
          phone: phone || undefined,
          email: email || undefined,
          markInbound: input.markInbound !== false,
        }),
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        this.logger.warn(
          `ONE opportunity link-cycle HTTP ${res.status}: ${text.slice(0, 200)}`,
        );
        return null;
      }
      const body = (await res.json()) as { linked?: boolean };
      return { linked: Boolean(body.linked) };
    } catch (err) {
      this.logger.warn(
        `ONE opportunity link-cycle falló: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
  }
}
