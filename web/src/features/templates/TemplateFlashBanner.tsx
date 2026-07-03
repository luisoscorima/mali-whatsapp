import { useSearchParams } from 'react-router-dom'
import { TEMPLATE_FLASH_MESSAGES } from './templateFlash'

export function TemplateFlashBanner() {
  const [searchParams, setSearchParams] = useSearchParams()
  const flash = searchParams.get('flash')
  const message = flash ? TEMPLATE_FLASH_MESSAGES[flash] : null

  if (!message) return null

  function dismiss() {
    const next = new URLSearchParams(searchParams)
    next.delete('flash')
    setSearchParams(next, { replace: true })
  }

  return (
    <p className="rounded-lg border border-accent/30 bg-accent-soft px-4 py-2 text-sm text-accent">
      {message}{' '}
      <button
        type="button"
        onClick={dismiss}
        className="ml-1 underline hover:no-underline"
      >
        Cerrar
      </button>
    </p>
  )
}
