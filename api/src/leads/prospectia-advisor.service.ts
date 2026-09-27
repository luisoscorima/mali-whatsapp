import { Injectable } from '@nestjs/common';

export type ProspectiaMatch = 'exists' | 'missing' | 'unverified';
export type ProspectiaSubject = {
  key: string;
  phone?: string | null;
  username?: string | null;
  whatsapp_user_id?: string | null;
};

type Contact = {
  id?: number;
  phone_number?: string | null;
  whatsapp_user_id?: string | null;
};
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

function normalizeIdentity(raw: string): string | null {
  const value = String(raw ?? '').trim().replace(/^@+/, '').toLowerCase();
  return /^[a-z0-9._]{3,128}$/.test(value) ? value : null;
}

@Injectable()
export class ProspectiaAdvisorService {
  get enabled(): boolean {
    return Boolean(process.env.PROSPECTIA_API_ACCESS_TOKEN?.trim());
  }

  async checkSubjects(subjects: ProspectiaSubject[]): Promise<{ enabled: boolean; matches: Record<string, ProspectiaMatch> }> {
    const matches: Record<string, ProspectiaMatch> = {};
    const unique = [...new Map(subjects.map((subject) => [subject.key, subject])).values()];
    for (let i = 0; i < unique.length; i += 5) {
      const batch = unique.slice(i, i + 5);
      const values = await Promise.all(batch.map((subject) => this.matchSubject(subject)));
      batch.forEach((subject, index) => { matches[subject.key] = values[index]; });
    }
    return { enabled: this.enabled, matches };
  }

  async lookup(subject: ProspectiaSubject): Promise<{ match: ProspectiaMatch; advisorEmail: string | null }> {
    if (!this.enabled) return { match: 'unverified', advisorEmail: null };
    const found = await this.resolve(subject);
    if (found.kind !== 'exists') return { match: found.kind, advisorEmail: null };
    if (!found.complete) return { match: 'exists', advisorEmail: null };
    return { match: 'exists', advisorEmail: await this.advisorEmailFor(found.id) };
  }

  async advisorEmail(rawPhone: string): Promise<string | null> {
    const phone = normalizePhone(rawPhone);
    if (!phone) return null;
    const found = await this.findContact(phone, (item) =>
      Boolean(item.id && item.phone_number && normalizePhone(item.phone_number) === phone));
    if (found.kind !== 'exists' || !found.complete) return null;
    return this.advisorEmailFor(found.id);
  }

  private async resolve(subject: ProspectiaSubject): Promise<SearchOutcome> {
    const phone = subject.phone ? normalizePhone(subject.phone) : null;
    const identities = [...new Set([subject.username, subject.whatsapp_user_id]
      .map((value) => value ? normalizeIdentity(value) : null)
      .filter((value): value is string => Boolean(value)))];
    if (!phone && !identities.length) return { kind: 'unverified' };
    let failed = false;
    if (phone) {
      const found = await this.findContact(phone, (item) =>
        Boolean(item.id && item.phone_number && normalizePhone(item.phone_number) === phone));
      if (found.kind === 'exists') return found;
      if (found.kind === 'unverified') failed = true;
    }
    for (const identity of identities) {
      const found = await this.findUsername(identity);
      if (found.kind === 'exists') return found;
      if (found.kind === 'unverified') failed = true;
    }
    return failed ? { kind: 'unverified' } : { kind: 'missing' };
  }

  private async advisorEmailFor(contactId: number): Promise<string | null> {
    const token = process.env.PROSPECTIA_API_ACCESS_TOKEN?.trim();
    const accountId = process.env.PROSPECTIA_ACCOUNT_ID?.trim() || '21';
    if (!token) return null;
    try {
      const conversations = await this.get<{ payload?: Conversation[] }>(
        new URL(`https://prospectia.attachmedia.com/api/v1/accounts/${accountId}/contacts/${contactId}/conversations`),
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

  private async matchSubject(subject: ProspectiaSubject): Promise<ProspectiaMatch> {
    const phone = subject.phone ? normalizePhone(subject.phone) : null;
    const identities = [...new Set([subject.username, subject.whatsapp_user_id]
      .map((value) => value ? normalizeIdentity(value) : null)
      .filter((value): value is string => Boolean(value)))];
    if (!phone && !identities.length) return 'unverified';
    let failed = false;
    if (phone) {
      const found = await this.findContact(phone, (item) =>
        Boolean(item.id && item.phone_number && normalizePhone(item.phone_number) === phone));
      if (found.kind === 'exists') return 'exists';
      if (found.kind === 'unverified') failed = true;
    }
    for (const identity of identities) {
      const found = await this.findUsername(identity);
      if (found.kind === 'exists') return 'exists';
      if (found.kind === 'unverified') failed = true;
    }
    return failed ? 'unverified' : 'missing';
  }

  private async findUsername(username: string): Promise<SearchOutcome> {
    const searched = await this.findContact(username, (item) =>
      Boolean(item.id && normalizeIdentity(item.whatsapp_user_id ?? '') === username));
    if (searched.kind !== 'missing') return searched;
    try {
      return await this.filterUsername(username);
    } catch {
      return searched;
    }
  }

  private async filterUsername(username: string): Promise<SearchOutcome> {
    const token = process.env.PROSPECTIA_API_ACCESS_TOKEN?.trim();
    const accountId = process.env.PROSPECTIA_ACCOUNT_ID?.trim() || '21';
    if (!token || !/^\d+$/.test(accountId)) return { kind: 'unverified' };
    const response = await fetch(
      `https://prospectia.attachmedia.com/api/v1/accounts/${accountId}/contacts/filter`,
      {
        method: 'POST',
        headers: {
          api_access_token: token,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          payload: [{
            attribute_key: 'whatsapp_user_id',
            filter_operator: 'equal_to',
            values: [username],
          }],
        }),
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!response.ok) throw new Error(`Prospectia HTTP ${response.status}`);
    const result = await response.json() as { meta?: { count?: number }; payload?: Contact[] };
    if (!Array.isArray(result.payload)) return { kind: 'unverified' };
    const matches = result.payload.filter((item) =>
      item.id && normalizeIdentity(item.whatsapp_user_id ?? '') === username);
    const count = Number(result.meta?.count ?? result.payload.length);
    const complete = !(count > result.payload.length);
    if (matches.length === 1) return { kind: 'exists', id: matches[0].id!, complete };
    if (matches.length === 0 && complete) return { kind: 'missing' };
    return { kind: 'unverified' };
  }

  private async findContact(query: string, accepts: (item: Contact) => boolean): Promise<SearchOutcome> {
    const token = process.env.PROSPECTIA_API_ACCESS_TOKEN?.trim();
    const accountId = process.env.PROSPECTIA_ACCOUNT_ID?.trim() || '21';
    if (!token || !query || !/^\d+$/.test(accountId)) return { kind: 'unverified' };
    const search = new URL(`https://prospectia.attachmedia.com/api/v1/accounts/${accountId}/contacts/search`);
    search.searchParams.set('q', query);
    try {
      const result = await this.get<{ meta?: { count?: number }; payload?: Contact[] }>(search, token);
      if (!Array.isArray(result.payload)) return { kind: 'unverified' };
      const matches = result.payload.filter(accepts);
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
