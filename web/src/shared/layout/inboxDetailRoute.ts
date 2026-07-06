/** Rutas que en móvil muestran el panel principal (y ocultan el sidebar). */
export function hasInboxDetailRoute(pathname: string): boolean {
  if (/^\/conversations\/\d+/.test(pathname)) return true
  if (/^\/contacts\/(\d+|new|import)/.test(pathname)) return true
  if (/^\/segments\/(\d+|new)/.test(pathname)) return true
  if (/^\/templates\/(\d+|new)/.test(pathname)) return true
  if (/^\/attributes\/(\d+|new)/.test(pathname)) return true
  if (/^\/campaigns\/(\d+|new)/.test(pathname)) return true
  if (/^\/admin\/.+/.test(pathname)) return true
  if (/^\/settings\/.+/.test(pathname)) return true
  return false
}
