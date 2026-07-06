import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { apiClient } from '../../shared/api'
import { formatDateTime } from '../../shared/format'
import { templateStatusClass } from './templateStatus'
import { WaSidebar } from '@/shared/ui/shell/WaSidebar'

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

type TemplatesListSidebarProps = {
  selectedId?: number | null
}

export function TemplatesListSidebar({ selectedId }: TemplatesListSidebarProps) {
  const location = useLocation()
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
  }, [location.search])

  async function onSync() {
    setSyncing(true)
    setError('')
    const result = await apiClient.post<{ count: number }>('/api/templates/sync', {})
    setSyncing(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    await load()
  }

  return (
    <WaSidebar
      title="Plantillas"
      onRefresh={() => void load()}
      refreshTitle="Actualizar lista"
      actions={
        <>
          <button
            type="button"
            onClick={() => void onSync()}
            disabled={syncing}
            className="small-btn"
            title="Sincronizar desde Meta"
          >
            {syncing ? '…' : 'Sync'}
          </button>
          <Link to="/templates/new" className="small-btn primary">
            +
          </Link>
        </>
      }
      filters={error ? <p className="px-3 text-xs text-bad">{error}</p> : null}
    >
      {!templates ? (
        <p className="inbox-empty-list">Cargando plantillas…</p>
      ) : templates.length === 0 ? (
        <p className="inbox-empty-list">
          No hay plantillas en caché. Pulsa Sync para traerlas desde Meta.
        </p>
      ) : (
        <ul className="inbox-chat-list">
          {templates.map((t) => {
            const active = selectedId === t.id
            return (
              <li key={t.id} className={`inbox-chat-item ${active ? 'is-active' : ''}`}>
                <Link to={`/templates/${t.id}`} className="inbox-chat-link">
                  <span className="inbox-chat-link-main">
                    <span className="inbox-chat-row-top">
                      <span className="inbox-chat-title font-mono">{t.name}</span>
                      <span
                        className={`rounded px-1.5 text-[10px] ${templateStatusClass(t.status)}`}
                      >
                        {t.status}
                      </span>
                    </span>
                    <span className="inbox-chat-preview">
                      {t.language} · {t.category || '—'}
                      {t.submitted_at
                        ? ` · ${formatDateTime(t.submitted_at).split(',')[0]}`
                        : ''}
                    </span>
                    {t.rejection_reason ? (
                      <span className="inbox-chat-preview text-bad line-clamp-1">
                        {t.rejection_reason}
                      </span>
                    ) : null}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </WaSidebar>
  )
}
