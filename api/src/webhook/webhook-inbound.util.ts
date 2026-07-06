export function extractInboundMessagePreview(msg: Record<string, unknown>): {
  messageType: string;
  bodyText: string;
} {
  const type = String(msg?.type || 'unknown').trim();
  if (type === 'text') {
    const text = msg.text as { body?: string } | undefined;
    const body = String(text?.body ?? '').trim();
    return { messageType: 'text', bodyText: body || '(vacío)' };
  }
  if (type === 'image') {
    const image = msg.image as { caption?: string } | undefined;
    const cap = String(image?.caption ?? '').trim();
    return { messageType: 'image', bodyText: cap || '[Imagen]' };
  }
  if (type === 'video') {
    const video = msg.video as { caption?: string } | undefined;
    const cap = String(video?.caption ?? '').trim();
    return { messageType: 'video', bodyText: cap || '[Video]' };
  }
  if (type === 'document') {
    const document = msg.document as { filename?: string; caption?: string } | undefined;
    const fn = String(document?.filename ?? '').trim();
    const cap = String(document?.caption ?? '').trim();
    const parts = [fn, cap].filter(Boolean);
    return {
      messageType: 'document',
      bodyText: parts.length ? parts.join(' · ') : '[Documento]',
    };
  }
  if (type === 'audio') {
    const audio = msg.audio as { voice?: boolean } | undefined;
    const isVoice = audio?.voice === true;
    return {
      messageType: isVoice ? 'voice' : 'audio',
      bodyText: isVoice ? '[Nota de voz]' : '[Audio]',
    };
  }
  if (type === 'voice') return { messageType: 'voice', bodyText: '[Nota de voz]' };
  if (type === 'sticker') return { messageType: 'sticker', bodyText: '[Sticker]' };
  if (type === 'location') return { messageType: 'location', bodyText: '[Ubicación]' };
  if (type === 'contacts') return { messageType: 'contacts', bodyText: '[Contacto]' };
  if (type === 'button') {
    const button = msg.button as { text?: string } | undefined;
    const t = String(button?.text ?? '').trim();
    return { messageType: 'button', bodyText: t || '[Botón]' };
  }
  if (type === 'interactive') {
    const interactive = msg.interactive as {
      type?: string;
      button_reply?: { title?: string };
    } | undefined;
    const interactiveType = String(interactive?.type ?? '').trim();
    if (interactiveType === 'button_reply') {
      const t = String(interactive?.button_reply?.title ?? '').trim();
      return { messageType: 'interactive', bodyText: t || '[Botón]' };
    }
    return { messageType: 'interactive', bodyText: '[Interactivo]' };
  }
  if (type === 'reaction') {
    return { messageType: 'reaction', bodyText: '' };
  }
  return { messageType: type || 'unknown', bodyText: `[${type || 'mensaje'}]` };
}

export function resolveInboundLinePhoneNumberId(
  value: { metadata?: { phone_number_id?: string } } | undefined,
  area: string | null,
  getAreaPhoneNumberId: (area: string) => string,
): string | null {
  const metaPid = String(value?.metadata?.phone_number_id ?? '').trim();
  if (metaPid) return metaPid;
  if (area) {
    const pid = String(getAreaPhoneNumberId(area) || '').trim();
    return pid || null;
  }
  return null;
}

/** Referencia a media en payload de webhook (Graph API). */
export function extractInboundMediaRef(
  msg: Record<string, unknown>,
): { mediaId: string } | null {
  const t = String(msg?.type || '').trim();
  const image = msg.image as { id?: string } | undefined;
  const video = msg.video as { id?: string } | undefined;
  const audio = msg.audio as { id?: string } | undefined;
  const voice = msg.voice as { id?: string } | undefined;
  const document = msg.document as { id?: string } | undefined;
  const sticker = msg.sticker as { id?: string } | undefined;
  if (t === 'image' && image?.id) return { mediaId: String(image.id) };
  if (t === 'video' && video?.id) return { mediaId: String(video.id) };
  if (t === 'audio' && audio?.id) return { mediaId: String(audio.id) };
  if (t === 'voice' && voice?.id) return { mediaId: String(voice.id) };
  if (t === 'document' && document?.id) return { mediaId: String(document.id) };
  if (t === 'sticker' && sticker?.id) return { mediaId: String(sticker.id) };
  return null;
}
