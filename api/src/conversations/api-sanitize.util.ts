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
): Record<string, unknown> {
  return {
    upload_media_id: uploadMediaId,
    ...sanitizeApiResponse(sendResponse),
  };
}
