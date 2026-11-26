import { useState, type FormEvent } from 'react'
import { Button } from '@/shared/ui/shadcn/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/shadcn/popover'

type SavedView = { name: string; query: string }

function readViews(key: string): SavedView[] {
  try {
    const views: unknown = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(views)
      ? views.filter((view): view is SavedView =>
          typeof view?.name === 'string' && typeof view.query === 'string',
        )
      : []
  } catch {
    return []
  }
}

export function InboxSavedViews({ storageKey, getQuery, onApply }: {
  storageKey: string
  getQuery: () => string
  onApply: (query: string) => void
}) {
  const [views, setViews] = useState(() => readViews(storageKey))
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  function persist(next: SavedView[]) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(next))
      setViews(next)
      setError('')
      return true
    } catch {
      setError('No se pudieron guardar los cambios en este navegador.')
      return false
    }
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
    }
  }

  return (
    <div className="flex items-center gap-1.5" role="group" aria-label="Mis vistas guardadas">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" size="sm" variant="outline" className="shrink-0">
            {views.length ? 'Vistas' : 'Guardar vista'}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 max-w-[calc(100vw-24px)] space-y-2" aria-label="Gestionar vistas guardadas">
          <form onSubmit={save} className="flex items-center gap-2">
            <input
              type="text" value={name} maxLength={48} required
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
          {views.length > 0 && (
            <ul className="max-h-44 space-y-1 overflow-y-auto">
              {views.map((view) => (
                <li key={view.name} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate" title={view.name}>{view.name}</span>
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
          {error && <p role="alert" className="text-xs text-muted">{error}</p>}
        </PopoverContent>
      </Popover>
      {views.length > 0 && (
        <ul className="flex min-w-0 gap-1.5 overflow-x-auto p-0.5">
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
      )}
    </div>
  )
}
