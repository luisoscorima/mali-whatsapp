import { useId, useRef, useState, type FormEvent } from 'react'
import { Button } from '@/shared/ui/shadcn/button'
import type { SavedView } from './useInboxSavedViews'

export function InboxSavedViewShortcuts({ views, onApply, saveViews, getQuery, canSave = false }: {
  views: SavedView[]
  onApply: (query: string) => void
  saveViews?: (views: SavedView[]) => boolean
  getQuery?: () => string
  canSave?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const saveButtonRef = useRef<HTMLButtonElement>(null)
  const formId = useId()
  const allowSave = Boolean(canSave && saveViews && getQuery)

  function persist(next: SavedView[]) {
    if (!saveViews) return false
    const saved = saveViews(next)
    setError(saved ? '' : 'No se pudieron guardar los cambios en este navegador.')
    return saved
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!getQuery) return
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

  if (!views.length && !allowSave) return null

  return (
    <div className="inbox-saved-view-bar">
      <ul className="flex min-w-0 gap-1.5 overflow-x-auto p-0.5" aria-label="Vistas guardadas">
        {views.map((view) => (
          <li key={view.name} className="flex shrink-0 items-center">
            <Button
              type="button" size="sm" variant="secondary" className="max-w-44"
              title={view.name} onClick={() => onApply(view.query)}
            >
              <span className="truncate">{view.name}</span>
            </Button>
            {saveViews ? (
              <Button
                type="button" size="sm" variant="ghost" className="px-2"
                aria-label={`Eliminar vista ${view.name}`}
                onClick={() => persist(views.filter((item) => item.name !== view.name))}
              >
                ×
              </Button>
            ) : null}
          </li>
        ))}
        {allowSave ? (
          <li className="shrink-0">
            <Button
              ref={saveButtonRef} type="button" size="sm" variant="outline"
              aria-expanded={open} aria-controls={open ? formId : undefined}
              onClick={() => {
                setOpen(!open)
                setError('')
              }}
            >
              {open ? 'Cancelar' : 'Guardar vista'}
            </Button>
          </li>
        ) : null}
      </ul>
      {allowSave && open && (
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
      {error && <p role="alert" className="text-xs text-bad">{error}</p>}
    </div>
  )
}
