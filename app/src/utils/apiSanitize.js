function sanitizeApiResponse(data) {
  return {
    messaging_product: data?.messaging_product,
    contacts: Array.isArray(data?.contacts) ? data.contacts : [],
    messages: Array.isArray(data?.messages)
      ? data.messages.map((item) => ({ id: item.id, message_status: item.message_status }))
      : [],
  };
}

/** Respuesta combinada subida de media + envío (inbox adjuntos). */
function sanitizeMediaOutboundPayload(uploadResponse, sendResponse) {
  return {
    upload_media_id: uploadResponse?.id != null ? String(uploadResponse.id) : null,
    ...sanitizeApiResponse(sendResponse),
  };
}

function sanitizeApiErrorPayload(payload) {
  const error = payload?.error || {};
  return {
    error: {
      message: error.message || payload?.message || 'unknown_error',
      type: error.type,
      code: error.code,
      error_subcode: error.error_subcode,
      fbtrace_id: error.fbtrace_id,
    },
  };
}

module.exports = { sanitizeApiResponse, sanitizeApiErrorPayload, sanitizeMediaOutboundPayload };
