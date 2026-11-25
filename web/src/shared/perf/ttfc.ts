import { apiClient } from '@/shared/api/api-client'

const WARM_KEY = 'wa_perf_ttfc_warm'
const STATE_KEY = '__waTtfcState'

type TtfcState = {
  startMs: number
  cold: boolean
  navType: 'full' | 'spa'
  reported: boolean
}

function readState(): TtfcState | null {
  return (window as Window & { [STATE_KEY]?: TtfcState })[STATE_KEY] ?? null
}

function writeState(state: TtfcState): void {
  ;(window as Window & { [STATE_KEY]?: TtfcState })[STATE_KEY] = state
}

/**
 * Inicio de medición hacia la primera lista.
 * Si el inbox entra poco después de cargar el documento (p. ej. `/` → Conversaciones),
 * mide desde la navegación; si es navegación SPA interna, desde el mount.
 */
export function markTtfcNavStart(): void {
  if (readState()) return
  const cold = !sessionStorage.getItem(WARM_KEY)
  const sinceNav = performance.now()
  const isFull = sinceNav < 90_000
  writeState({
    startMs: isFull ? 0 : sinceNav,
    cold,
    navType: isFull ? 'full' : 'spa',
    reported: false,
  })
}

/** Primera respuesta OK de la lista del inbox (vacía o no). */
export function reportTtfcFirstConversations(opts?: { path?: string }): void {
  const state = readState()
  if (!state || state.reported) return
  state.reported = true

  const durationMs = Math.round(performance.now() - state.startMs)
  if (durationMs < 0 || durationMs > 600_000) return

  sessionStorage.setItem(WARM_KEY, '1')

  const payload = {
    metric: 'time_to_first_conversations',
    durationMs,
    cold: state.cold,
    navType: state.navType,
    path: opts?.path || window.location.pathname || '/',
  }

  if (import.meta.env.DEV) {
    console.info('[perf]', payload)
  }

  void apiClient.post('/api/perf/client-timing', payload).catch(() => {
    /* no bloquear UI */
  })
}
