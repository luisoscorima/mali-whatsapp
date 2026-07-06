import { useEffect } from 'react'

/** Ejecuta callback cada `ms` mientras la pestaña está visible (SPA sin botón Actualizar). */
export function useIntervalWhenVisible(callback: () => void, ms: number) {
  useEffect(() => {
    function tick() {
      if (document.visibilityState === 'hidden') return
      callback()
    }

    const timer = window.setInterval(tick, ms)
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [callback, ms])
}
