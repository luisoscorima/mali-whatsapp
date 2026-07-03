import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { apiClient } from '../../shared/api'
import { formatDateTime } from '../../shared/format'
import { TemplateFlashBanner } from './TemplateFlashBanner'
import { templateStatusClass } from './templateStatus'

type TemplateListItem = {
  id: number
  name: string
  language: string
  category: string | null
  status: string
  rejection_reason: string | null
  submitted_at: string | null
  synced_at: string
}

export function TemplatesListPage() {
  const [, setSearchParams] = useSearchParams()
  const [templates, setTemplates] = useState<TemplateListItem[] | null>(null)
  const [error, setError] = useState('')
  const [syncing, setSyncing] = useState(false)

  async function load() {
    const result = await apiClient.get<TemplateListItem[]>('/api/templates')
    if (!result.ok) {
      setError(result.error)
      return
    }
    setTemplates(result.data)
    setError('')
  }

  useEffect(() => {
    void load()
  }, [])

  async function onSync() {
    setSyncing(true)
    setError('')
    const result = await apiClient.post<{ count: number }>('/api/templates/sync', {})
    setSyncing(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setSearchParams({ flash: 'synced' }, { replace: true })
    await load()
  }

  if (error && !templates) {
    return <p className="text-bad">{error}</p>
  }

  if (!templates) {
    return <p className="text-muted">Cargando plantillas…</p>
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Plantillas</h1>
          <p className="text-sm text-muted">
            Plantillas de WhatsApp sincronizadas desde Meta.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/templates/new"
            className="rounded-lg bg-accent px-4 py-2 text-sm text-white"
          >
            Nueva plantilla
          </Link>
          <button
            type="button"
            onClick={() => void onSync()}
            disabled={syncing}
            className="rounded-lg border border-line px-4 py-2 text-sm hover:bg-accent-soft disabled:opacity-60"
          >
            {syncing ? 'Sincronizando…' : 'Sincronizar todo'}
          </button>
        </div>
      </div>

      <TemplateFlashBanner />
      {error ? <p className="text-sm text-bad">{error}</p> : null}

      <p className="text-sm text-muted">
        Trae todas las plantillas desde Meta, incluyendo pendientes, aprobadas y
        rechazadas. En campañas solo se pueden usar las aprobadas.
      </p>

      {templates.length === 0 ? (
        <p className="text-sm text-muted">
          No hay plantillas en caché. Pulsa <strong>Sincronizar todo</strong>.
        </p>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface-strong">
          {templates.map((t) => (
            <li key={t.id}>
              <Link
                to={`/templates/${t.id}`}
                className="block px-4 py-3 hover:bg-accent-soft"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono font-medium">{t.name}</span>
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-medium ${templateStatusClass(t.status)}`}
                  >
                    {t.status}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted">
                  {t.language} · {t.category || '—'}
                  {t.submitted_at
                    ? ` · Creación ${formatDateTime(t.submitted_at).split(',')[0]}`
                    : ''}
                </p>
                {t.rejection_reason ? (
                  <p className="mt-1 text-sm text-bad line-clamp-2">
                    {t.rejection_reason}
                  </p>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
