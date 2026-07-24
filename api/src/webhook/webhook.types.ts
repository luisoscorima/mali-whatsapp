export type MetaWebhookBody = {
  object?: string;
  entry?: MetaWebhookEntry[];
};

export type MetaWebhookEntry = {
  id?: string;
  changes?: MetaWebhookChange[];
};

export type MetaWebhookChange = {
  field?: string;
  value?: MetaWebhookChangeValue;
};

export type MetaWebhookContact = {
  profile?: { name?: string };
  wa_id?: string;
};

export type MetaWebhookChangeValue = {
  metadata?: { phone_number_id?: string };
  contacts?: MetaWebhookContact[];
  messages?: Record<string, unknown>[];
  statuses?: Record<string, unknown>[];
  message_template_name?: string;
  name?: string;
  message_template_language?: string;
  language?: string;
  event?: string;
  message_template_status?: string;
  reason?: string;
  rejection_reason?: string;
};
