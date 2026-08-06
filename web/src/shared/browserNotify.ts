import { MALI_LOGO_URL } from '@/shared/brand'

export type BrowserNotifyPermission =
  | 'unsupported'
  | 'default'
  | 'granted'
  | 'denied'

export function getBrowserNotifyPermission(): BrowserNotifyPermission {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    return 'unsupported'
  }
  return Notification.permission
}

export async function requestBrowserNotifyPermission(): Promise<BrowserNotifyPermission> {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    return 'unsupported'
  }
  if (Notification.permission === 'granted') return 'granted'
  if (Notification.permission === 'denied') return 'denied'
  try {
    const result = await Notification.requestPermission()
    return result
  } catch {
    return getBrowserNotifyPermission()
  }
}

export function showBrowserNotification(opts: {
  title: string
  body: string
  tag: string
  onClick?: () => void
}): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
    return
  }
  try {
    const n = new Notification(opts.title, {
      body: opts.body,
      tag: opts.tag,
      icon: MALI_LOGO_URL,
    })
    n.onclick = () => {
      try {
        window.focus()
      } catch {
        /* ignore */
      }
      opts.onClick?.()
      n.close()
    }
  } catch {
    /* Safari / políticas del SO */
  }
}
