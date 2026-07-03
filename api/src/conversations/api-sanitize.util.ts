export function sanitizeApiResponse(data: unknown): Record<string, unknown> {
  const record = data as {
    messaging_product?: string;
    contacts?: unknown[];
    messages?: { id?: string; message_status?: string }[];
  };
  return {
    messaging_product: record?.messaging_product,
    contacts: Array.isArray(record?.contacts) ? record.contacts : [],
    messages: Array.isArray(record?.messages)
      ? record.messages.map((item) => ({
          id: item.id,
          message_status: item.message_status,
        }))
      : [],
  };
}

export function sanitizeMediaOutboundPayload(
  uploadMediaId: string,
  sendResponse: unknown,
  localPreview?: { url: string; mime?: string | null } | null,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    upload_media_id: uploadMediaId,
    ...sanitizeApiResponse(sendResponse),
  };
  if (localPreview?.url) {
    payload.local_preview = {
      url: localPreview.url,
      ...(localPreview.mime ? { mime: localPreview.mime } : {}),
    };
  }
  return payload;
}
