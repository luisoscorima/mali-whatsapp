import { useId, useRef, useState, type FormEvent } from 'react'
import { Button } from '@/shared/ui/shadcn/button'
import type { SavedView } from './useInboxSavedViews'

export function InboxSavedViews({ views, saveViews, getQuery, onApply }: {
  views: SavedView[]
  saveViews: (views: SavedView[]) => boolean
  getQuery: () => string
  onApply: (query: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const saveButtonRef = useRef<HTMLButtonElement>(null)
  const formId = useId()

  function persist(next: SavedView[]) {
    const saved = saveViews(next)
    setError(saved ? '' : 'No se pudieron guardar los cambios en este navegador.')
    return saved
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const label = name.trim()
    if (!label) return
    if (views.some((view) => view.name.toLocaleLowerCase() === label.toLocaleLowerCase())) {
      setError('Ya existe una vista con ese nombre.')
      return
    }
    if (persist([...views, { name: label, query: getQuery() }])) {
      setName('')
      setOpen(false)
      saveButtonRef.current?.focus()
    }
  }

  return (
    <section className="space-y-2 border-b border-line pb-3" aria-label="Vistas guardadas">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Vistas guardadas</span>
        <Button
          ref={saveButtonRef} type="button" size="sm" variant="ghost"
          aria-expanded={open} aria-controls={open ? formId : undefined}
          onClick={() => {
            setOpen(!open)
            setError('')
          }}
        >
          {open ? 'Cancelar' : 'Guardar vista'}
        </Button>
      </div>
      {open && (
        <form id={formId} onSubmit={save} className="flex items-center gap-2">
          <input
            type="text" value={name} maxLength={48} required autoFocus
            aria-label="Nombre de la vista"
            className="inbox-search-input min-w-0 flex-1"
            placeholder="Nombre de la vista"
            onChange={(event) => {
              setName(event.target.value)
              setError('')
            }}
          />
          <Button type="submit" size="sm" variant="secondary" disabled={!name.trim()}>
            Guardar
          </Button>
        </form>
      )}
      {views.length > 0 && (
        <ul className="max-h-40 space-y-1 overflow-y-auto">
          {views.map((view) => (
            <li key={view.name} className="flex items-center gap-2">
              <Button
                type="button" size="sm" variant="ghost" className="min-w-0 flex-1 justify-start"
                title={view.name} onClick={() => onApply(view.query)}
              >
                <span className="truncate">{view.name}</span>
              </Button>
              <Button
                type="button" size="sm" variant="ghost"
                aria-label={`Eliminar vista ${view.name}`}
                onClick={() => persist(views.filter((item) => item.name !== view.name))}
              >
                Eliminar
              </Button>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="text-xs text-bad">{error}</p>}
    </section>
  )
}

export function InboxSavedViewShortcuts({ views, onApply }: {
  views: SavedView[]
  onApply: (query: string) => void
}) {
  if (!views.length) return null
  return (
    <ul className="flex min-w-0 gap-1.5 overflow-x-auto p-0.5" aria-label="Accesos a vistas guardadas">
      {views.map((view) => (
        <li key={view.name} className="shrink-0">
          <Button
            type="button" size="sm" variant="secondary" className="max-w-44"
            title={view.name} onClick={() => onApply(view.query)}
          >
            <span className="truncate">{view.name}</span>
            </Button>
        </li>
      ))}
    </ul>
  )
}
