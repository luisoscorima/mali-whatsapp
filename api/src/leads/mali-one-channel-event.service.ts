import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';

/**
 * Outbox shadow hacia MALI ONE (EducacionChannelEvent).
 * Aditivo: no escribe etapa/assign en ONE; fallo no tumba gestión WA.
 */
@Injectable()
export class MaliOneChannelEventService {
  private readonly logger = new Logger(MaliOneChannelEventService.name);
  private authorityLogged = false;

  constructor(private readonly config: AppConfigService) {}

  private configured(): { base: string; token: string } | null {
    const base = this.config.maliOneApiBaseUrl;
    const token = this.config.maliOneCrmEducacionServiceToken;
    if (!base || !token) return null;
    return { base, token };
  }

  /** Lectura informativa; no cambia el escritor comercial (sigue WA). */
  async logCommercialAuthorityOnce(): Promise<void> {
    if (this.authorityLogged) return;
    const cfg = this.configured();
    if (!cfg) return;
    this.authorityLogged = true;
    try {
      const res = await fetch(`${cfg.base}/api/crm-educacion/commercial-authority`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) {
        this.logger.warn(`commercial-authority HTTP ${res.status}`);
        return;
      }
      const body = (await res.json()) as {
        authority?: string;
        wa_ux?: string;
        wa_channels_pending?: string[];
      };
      this.logger.log(
        `ONE commercial-authority=${body.authority ?? '?'} wa_ux=${body.wa_ux ?? '?'} pending=${(body.wa_channels_pending ?? []).join(',')}`,
      );
    } catch (err) {
      this.logger.warn(
        `commercial-authority falló: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  async tryEmit(input: {
    eventId: string;
    eventType: string;
    occurredAt?: Date;
    payload: Record<string, unknown>;
  }): Promise<{ ok: boolean } | null> {
    const cfg = this.configured();
    if (!cfg) return null;
    void this.logCommercialAuthorityOnce();
    const url = `${cfg.base}/api/crm-educacion/internal/channel-events`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'x-crm-educacion-service-token': cfg.token,
        },
        body: JSON.stringify({
          eventId: input.eventId,
          eventType: input.eventType,
          occurredAt: (input.occurredAt ?? new Date()).toISOString(),
          payload: input.payload,
        }),
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        this.logger.warn(
          `ONE channel-event HTTP ${res.status}: ${text.slice(0, 200)}`,
        );
        return null;
      }
      return { ok: true };
    } catch (err) {
      this.logger.warn(
        `ONE channel-event falló: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
  }
}
