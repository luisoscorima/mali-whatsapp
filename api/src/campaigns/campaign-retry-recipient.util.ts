import { normalizeWhatsAppRecipient } from '../conversations/whatsapp-recipient.util';

export type CampaignRetryRecipient = {
  phone: string;
  targetChanged: boolean;
};

/** El contacto vigente manda; el teléfono del log queda como fallback histórico. */
export function resolveCampaignRetryRecipient(
  logPhone: string | null | undefined,
  currentContactPhone: string | null | undefined,
): CampaignRetryRecipient {
  const stored = normalizeWhatsAppRecipient(logPhone);
  const current = normalizeWhatsAppRecipient(currentContactPhone);
  return {
    phone: current || stored,
    targetChanged: Boolean(current && current !== stored),
  };
}
