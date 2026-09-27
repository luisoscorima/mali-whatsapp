import { Injectable } from '@nestjs/common';

export type ProspectiaMatch = 'exists' | 'missing' | 'unverified';

type Contact = { id?: number; phone_number?: string | null };
type Conversation = {
  status?: string;
  last_activity_at?: number;
  created_at?: number;
  meta?: { assignee?: { email?: string | null } | null };
};
type SearchOutcome =
  | { kind: 'unverified' }
  | { kind: 'missing' }
  | { kind: 'exists'; id: number; complete: boolean };

function normalizePhone(raw: string): string | null {
  const digits = String(raw ?? '').replace(/\D/g, '');
  return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
}

@Injectable()
export class ProspectiaAdvisorService {
  get enabled(): boolean {
    return Boolean(process.env.PROSPECTIA_API_ACCESS_TOKEN?.trim());
  }

  async checkPhones(phones: string[]): Promise<{ enabled: boolean; matches: Record<string, ProspectiaMatch> }> {
    const matches: Record<string, ProspectiaMatch> = {};
    const unique = [...new Set(phones)];
    for (let i = 0; i < unique.length; i += 5) {
      const batch = unique.slice(i, i + 5);
      const values = await Promise.all(batch.map((phone) => this.matchPhone(phone)));
      batch.forEach((phone, index) => { matches[phone] = values[index]; });
    }
    return { enabled: this.enabled, matches };
  }

  async advisorEmail(rawPhone: string): Promise<string | null> {
    const found = await this.findContact(rawPhone);
    if (found.kind !== 'exists' || !found.complete) return null;
    const token = process.env.PROSPECTIA_API_ACCESS_TOKEN?.trim();
    const accountId = process.env.PROSPECTIA_ACCOUNT_ID?.trim() || '21';
    if (!token) return null;
    try {
      const conversations = await this.get<{ payload?: Conversation[] }>(
        new URL(`https://prospectia.attachmedia.com/api/v1/accounts/${accountId}/contacts/${found.id}/conversations`),
        token,
      );
      if (!Array.isArray(conversations.payload)) return null;
      const active = conversations.payload
        .filter((item) => item.status === 'open' || item.status === 'pending')
        .sort((a, b) => (b.last_activity_at ?? b.created_at ?? 0) -
          (a.last_activity_at ?? a.created_at ?? 0));
      const email = active[0]?.meta?.assignee?.email?.trim().toLowerCase();
      return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
    } catch {
      return null;
    }
  }

  private async matchPhone(raw: string): Promise<ProspectiaMatch> {
    const found = await this.findContact(raw);
    if (found.kind === 'exists') return 'exists';
    if (found.kind === 'missing') return 'missing';
    return 'unverified';
  }

  private async findContact(raw: string): Promise<SearchOutcome> {
    const token = process.env.PROSPECTIA_API_ACCESS_TOKEN?.trim();
    const accountId = process.env.PROSPECTIA_ACCOUNT_ID?.trim() || '21';
    const phone = normalizePhone(raw);
    if (!token || !phone || !/^\d+$/.test(accountId)) return { kind: 'unverified' };
    const search = new URL(`https://prospectia.attachmedia.com/api/v1/accounts/${accountId}/contacts/search`);
    search.searchParams.set('q', phone);
    try {
      const result = await this.get<{ meta?: { count?: number }; payload?: Contact[] }>(search, token);
      if (!Array.isArray(result.payload)) return { kind: 'unverified' };
      const matches = result.payload.filter((item) =>
        item.id && item.phone_number && normalizePhone(item.phone_number) === phone);
      const count = Number(result.meta?.count ?? result.payload.length);
      const complete = !(count > result.payload.length);
      if (matches.length === 1) return { kind: 'exists', id: matches[0].id!, complete };
      if (matches.length === 0 && complete) return { kind: 'missing' };
      return { kind: 'unverified' };
    } catch {
      return { kind: 'unverified' };
    }
  }

  private async get<T>(url: URL, token: string): Promise<T> {
    const response = await fetch(url, {
      method: 'GET',
      headers: { api_access_token: token, Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Prospectia HTTP ${response.status}`);
    return response.json() as Promise<T>;
  }
}
