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
      button_reply?: { title?: string; id?: string };
      list_reply?: { title?: string; id?: string };
    } | undefined;
    const interactiveType = String(interactive?.type ?? '').trim();
    if (interactiveType === 'button_reply') {
      const t = String(interactive?.button_reply?.title ?? '').trim();
      return { messageType: 'interactive', bodyText: t || '[Botón]' };
    }
    if (interactiveType === 'list_reply') {
      const t = String(interactive?.list_reply?.title ?? '').trim();
      return { messageType: 'interactive', bodyText: t || '[Lista]' };
    }
    return { messageType: 'interactive', bodyText: '[Interactivo]' };
  }
  if (type === 'reaction') {
    return { messageType: 'reaction', bodyText: '' };
  }
  return { messageType: type || 'unknown', bodyText: `[${type || 'mensaje'}]` };
}

/** Nombre de perfil WhatsApp del webhook Meta (`value.contacts[].profile.name`). */
export function extractInboundProfileName(
  contacts: { profile?: { name?: string }; wa_id?: string }[] | undefined,
  senderPhone: string,
): string | null {
  if (!Array.isArray(contacts) || contacts.length === 0) return null;
  const phone = String(senderPhone || '').trim();
  const matched = phone
    ? contacts.find((c) => String(c?.wa_id ?? '').trim() === phone)
    : undefined;
  const entry = matched ?? (contacts.length === 1 ? contacts[0] : undefined);
  const name = String(entry?.profile?.name ?? '').trim();
  return name || null;
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

/**
 * Payload estable de botón (plantilla QUICK_REPLY o reply interactivo de sesión).
 * Preferir `payload` / `button_reply.id` sobre el título visible.
 */
export function extractInboundButtonPayload(
  msg: Record<string, unknown>,
): { payload: string; title: string } | null {
  const type = String(msg?.type || '').trim();
  if (type === 'button') {
    const button = msg.button as { text?: string; payload?: string } | undefined;
    const title = String(button?.text ?? '').trim();
    const payload = String(button?.payload ?? '').trim() || title;
    if (!payload) return null;
    return { payload, title: title || payload };
  }
  if (type === 'interactive') {
    const interactive = msg.interactive as {
      type?: string;
      button_reply?: { title?: string; id?: string };
      list_reply?: { title?: string; id?: string };
    } | undefined;
    const interactiveType = String(interactive?.type ?? '').trim();
    if (interactiveType === 'button_reply') {
      const title = String(interactive?.button_reply?.title ?? '').trim();
      const payload =
        String(interactive?.button_reply?.id ?? '').trim() || title;
      if (!payload) return null;
      return { payload, title: title || payload };
    }
    if (interactiveType === 'list_reply') {
      const title = String(interactive?.list_reply?.title ?? '').trim();
      const payload =
        String(interactive?.list_reply?.id ?? '').trim() || title;
      if (!payload) return null;
      return { payload, title: title || payload };
    }
  }
  return null;
}
