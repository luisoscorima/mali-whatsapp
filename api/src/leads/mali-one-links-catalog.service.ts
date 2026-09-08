import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import type { MaliOneWhatsappCatalogItem } from './mali-one-link-match.util';

const CACHE_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class MaliOneLinksCatalogService {
  private readonly logger = new Logger(MaliOneLinksCatalogService.name);
  private cache: MaliOneWhatsappCatalogItem[] | null = null;
  private cachedAt = 0;
  private inflight: Promise<MaliOneWhatsappCatalogItem[]> | null = null;

  constructor(private readonly config: AppConfigService) {}

  async getCatalog(): Promise<MaliOneWhatsappCatalogItem[]> {
    const now = Date.now();
    if (this.cache && now - this.cachedAt < CACHE_TTL_MS) {
      return this.cache;
    }
    if (this.inflight) return this.inflight;

    this.inflight = this.fetchCatalog()
      .then((rows) => {
        this.cache = rows;
        this.cachedAt = Date.now();
        return rows;
      })
      .catch((err) => {
        this.logger.warn(
          `Catálogo MALI ONE links falló: ${err instanceof Error ? err.message : err}`,
        );
        // Si hay cache viejo, úsalo; si no, vacío (match solo por ref no disponible sin catálogo).
        return this.cache ?? [];
      })
      .finally(() => {
        this.inflight = null;
      });

    return this.inflight;
  }

  private async fetchCatalog(): Promise<MaliOneWhatsappCatalogItem[]> {
    const base = this.config.maliOneApiBaseUrl;
    const token = this.config.maliOneLinksServiceToken;
    if (!base || !token) {
      return [];
    }

    const url = `${base}/api/links/internal/whatsapp-catalog`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'x-links-service-token': token,
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as unknown;
    if (!Array.isArray(data)) {
      throw new Error('Respuesta de catálogo inválida');
    }
    return data
      .map((row) => {
        if (!row || typeof row !== 'object') return null;
        const r = row as Record<string, unknown>;
        const slug = String(r.slug ?? '').trim();
        if (!slug) return null;
        return {
          slug,
          text: String(r.text ?? ''),
          text_normalized: String(r.text_normalized ?? ''),
          tags: Array.isArray(r.tags)
            ? r.tags.map((t) => String(t)).filter(Boolean)
            : [],
          phone: String(r.phone ?? ''),
        } satisfies MaliOneWhatsappCatalogItem;
      })
      .filter((x): x is MaliOneWhatsappCatalogItem => x != null);
  }
}
