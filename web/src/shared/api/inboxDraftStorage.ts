const PREFIX = 'mali.inbox.reply-draft:'

export function readInboxDraft(key: string): string {
  try {
    return sessionStorage.getItem(PREFIX + key) ?? ''
  } catch {
    return ''
  }
}

export function writeInboxDraft(key: string, text: string): void {
  try {
    if (text.trim()) sessionStorage.setItem(PREFIX + key, text)
    else sessionStorage.removeItem(PREFIX + key)
  } catch {
    // The open inbox keeps the draft in memory if storage is unavailable.
  }
}

export function clearInboxDrafts(): void {
  try {
    for (let index = sessionStorage.length - 1; index >= 0; index--) {
      const key = sessionStorage.key(index)
      if (key?.startsWith(PREFIX)) sessionStorage.removeItem(key)
    }
  } catch {
    // Storage can be unavailable on sign-out.
  }
}
