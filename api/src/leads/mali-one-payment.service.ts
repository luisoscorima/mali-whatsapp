import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';

/**
 * Proxy asesor → MALI ONE lookup/associate de códigos Treasury.
 * Aditivo: si ONE no está configurado o cae, el chat sigue; solo falla esta acción.
 */
@Injectable()
export class MaliOnePaymentService {
  private readonly logger = new Logger(MaliOnePaymentService.name);

  constructor(private readonly config: AppConfigService) {}

  private assertConfigured(): { base: string; token: string } {
    const base = this.config.maliOneApiBaseUrl;
    const token = this.config.maliOneCrmEducacionServiceToken;
    if (!base || !token) {
      throw new ServiceUnavailableException(
        'Lookup de pagos no configurado (MALI_ONE_API_URL / MALI_ONE_CRM_EDUCACION_SERVICE_TOKEN)',
      );
    }
    return { base, token };
  }

  async lookup(code: string, provider?: string): Promise<unknown> {
    const q = String(code ?? '').trim();
    if (q.length < 4) throw new BadRequestException('Código demasiado corto');
    const { base, token } = this.assertConfigured();
    const qs = new URLSearchParams({ code: q });
    if (provider && provider !== 'all') qs.set('provider', provider);
    const url = `${base}/api/crm-educacion/internal/payments/lookup?${qs}`;
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'x-crm-educacion-service-token': token,
        },
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new BadRequestException(
          text || `ONE lookup HTTP ${res.status}`,
        );
      }
      return res.json();
    } catch (err) {
      if (err instanceof BadRequestException || err instanceof ServiceUnavailableException) {
        throw err;
      }
      this.logger.warn(`ONE payment lookup falló: ${err instanceof Error ? err.message : err}`);
      throw new ServiceUnavailableException(
        'No se pudo validar el código (MALI ONE / Treasury no disponible)',
      );
    }
  }

  async paymentLink(waCycleId: number): Promise<{
    payment_link: {
      saleId: string;
      waCycleId: number;
      status: 'reportado' | 'parcial' | 'pagado' | 'revertido';
      code: string | null;
    } | null;
  } | null> {
    if (!Number.isInteger(waCycleId) || waCycleId < 1) {
      throw new BadRequestException('waCycleId inválido');
    }
    const { base, token } = this.assertConfigured();
    const url = `${base}/api/crm-educacion/internal/sales/by-cycle/${waCycleId}`;
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'x-crm-educacion-service-token': token,
        },
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new BadRequestException(
          text || `ONE sale-link HTTP ${res.status}`,
        );
      }
      return res.json() as Promise<{
        payment_link: {
          saleId: string;
          waCycleId: number;
          status: 'reportado' | 'parcial' | 'pagado' | 'revertido';
          code: string | null;
        } | null;
      }>;
    } catch (err) {
      if (err instanceof BadRequestException || err instanceof ServiceUnavailableException) {
        throw err;
      }
      this.logger.warn(
        `ONE payment link falló: ${err instanceof Error ? err.message : err}`,
      );
      throw new ServiceUnavailableException(
        'No se pudo consultar el vínculo de pago (MALI ONE)',
      );
    }
  }

  async associate(input: {
    waCycleId: number;
    waContactId?: number;
    transactionCode: string;
    actorEmail?: string;
  }): Promise<unknown> {
    const { base, token } = this.assertConfigured();
    const url = `${base}/api/crm-educacion/internal/payments/associate`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'x-crm-educacion-service-token': token,
        },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new BadRequestException(
          text || `ONE associate HTTP ${res.status}`,
        );
      }
      return res.json();
    } catch (err) {
      if (err instanceof BadRequestException || err instanceof ServiceUnavailableException) {
        throw err;
      }
      this.logger.warn(`ONE payment associate falló: ${err instanceof Error ? err.message : err}`);
      throw new ServiceUnavailableException(
        'No se pudo asociar el código (MALI ONE / Treasury no disponible)',
      );
    }
  }
}
