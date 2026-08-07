import { useCallback, useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { apiClient } from '../../shared/api'
import { formatDateTime } from '../../shared/format'
import { notify } from '@/shared/notify'
import { TEMPLATE_FLASH_MESSAGES } from './templateFlash'
import { TemplateForm } from './TemplateForm'
import { TemplateLivePreview } from './TemplateLivePreview'
import { templateStatusClass } from './templateStatus'
import type { TemplateBuilderState } from './templateFormUtils'

type TemplateUsage = {
  mass_campaigns: Array<{
    id: number
    status: string
    segment: string
    total_recipients: number
    created_at: string
    scheduled_at: string | null
  }>
  direct_sends_count: number
  linked_flows: Array<{
    id: number
    name: string
    status: string
    trigger_payload: string
    button_index: number | null
  }>
}

type TemplateDetail = {
  id: number
  meta_id: string | null
  name: string
  language: string
  category: string | null
  status: string
  rejection_reason: string | null
  submitted_at: string | null
  synced_at: string
  active: boolean
  can_edit: boolean
  builder: TemplateBuilderState
  usage: TemplateUsage
  display: {
    headerText: string
    headerFormat: string
    bodyText: string
    footerText: string
    buttons: { type: string; text: string; url: string }[]
    bodyExamples: string[]
  }
}

export function TemplateDetailPage() {
  const { id } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const [template, setTemplate] = useState<TemplateDetail | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [active, setActive] = useState(true)
  const [savingFlags, setSavingFlags] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    const result = await apiClient.get<TemplateDetail>(`/api/templates/${id}`)
    if (!result.ok) {
      notify.error(result.error)
      setLoadFailed(true)
      return
    }
    setTemplate(result.data)
    setActive(result.data.active)
    setLoadFailed(false)
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const flash = searchParams.get('flash')
    if (!flash) return
    const message = TEMPLATE_FLASH_MESSAGES[flash]
    if (message) notify.success(message)
    const next = new URLSearchParams(searchParams)
    next.delete('flash')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  async function saveFlags() {
    if (!template) return
    setSavingFlags(true)
    const result = await apiClient.patch<TemplateDetail>(
      `/api/templates/${template.id}/flags`,
      { active },
    )
    setSavingFlags(false)
    if (!result.ok) {
      notify.error(result.error)
      return
    }
    setTemplate(result.data)
    setActive(result.data.active)
    notify.success('Preferencias guardadas')
  }

  if (loadFailed && !template) {
    return (
      <div className="space-y-3">
        <Link to="/templates" className="text-sm text-accent">
          ← Plantillas
        </Link>
        <p className="text-muted">No se pudo cargar la plantilla.</p>
      </div>
    )
  }

  if (!template) {
    return <p className="text-muted">Cargando plantilla…</p>
  }

  const usage = template.usage

  return (
    <div className="space-y-4">
      <Link to="/templates" className="text-sm text-accent">
        ← Plantillas
      </Link>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-2xl font-semibold">{template.name}</h1>
        <span
          className={`rounded px-2 py-0.5 text-xs font-medium ${templateStatusClass(template.status)}`}
        >
          {template.status}
        </span>
        <span
          className={`rounded px-2 py-0.5 text-xs font-medium ${
            template.active ? 'bg-accent-soft text-accent' : 'bg-bad/15 text-bad'
          }`}
        >
          {template.active ? 'Activo' : 'Inactivo'}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link
          to={`/templates/new?duplicate_from=${template.id}`}
          className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-accent-soft"
        >
          Duplicar como nueva versión
        </Link>
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
        <div className="space-y-4">
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted">Idioma</dt>
              <dd>{template.language}</dd>
            </div>
            <div>
              <dt className="text-muted">Categoría</dt>
              <dd>{template.category || '—'}</dd>
            </div>
            {template.meta_id ? (
              <div>
                <dt className="text-muted">ID Meta</dt>
                <dd className="font-mono">{template.meta_id}</dd>
              </div>
            ) : null}
            {template.submitted_at ? (
              <div>
                <dt className="text-muted">Enviada</dt>
                <dd>{formatDateTime(template.submitted_at)}</dd>
              </div>
            ) : null}
            <div>
              <dt className="text-muted">Última sync</dt>
              <dd>{formatDateTime(template.synced_at)}</dd>
            </div>
            {template.rejection_reason ? (
              <div className="sm:col-span-2">
                <dt className="text-muted">Motivo rechazo</dt>
                <dd className="text-bad">{template.rejection_reason}</dd>
              </div>
            ) : null}
          </dl>

          <form
            className="flex flex-wrap items-center gap-3 border-t border-line pt-4"
            onSubmit={(e) => {
              e.preventDefault()
              void saveFlags()
            }}
          >
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
              />
              Activo
            </label>
            <button
              type="submit"
              disabled={savingFlags || active === template.active}
              className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-accent-soft disabled:opacity-50"
            >
              {savingFlags ? 'Guardando…' : 'Guardar'}
            </button>
            <p className="w-full text-xs text-muted">
              Si está inactiva, no aparecerá al crear campañas ni al enviar desde el inbox.
            </p>
          </form>
        </div>

        <TemplateLivePreview state={template.builder} showMeta={false} />
      </div>

      <section className="space-y-3 border-t border-line pt-6 text-sm">
        <h2 className="text-lg font-semibold">Uso</h2>

        <div className="space-y-2">
          <h3 className="font-medium">Campañas masivas</h3>
          {!usage?.mass_campaigns?.length ? (
            <p className="text-muted">Ninguna campaña masiva</p>
          ) : (
            <ul className="space-y-1">
              {usage.mass_campaigns.map((c) => (
                <li key={c.id}>
                  <Link to={`/campaigns/${c.id}`} className="text-accent">
                    #{c.id}
                  </Link>
                  <span className="text-muted">
                    {' '}
                    · {c.status} · {c.segment} · {c.total_recipients} dest. ·{' '}
                    {formatDateTime(c.scheduled_at || c.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="text-muted">
          Envíos desde inbox: {usage?.direct_sends_count ?? 0}
        </p>

        <div className="space-y-2">
          <h3 className="font-medium">Flujos vinculados</h3>
          {!usage?.linked_flows?.length ? (
            <p className="text-muted">
              Ningún flujo vinculado por payload de botón
            </p>
          ) : (
            <ul className="space-y-1">
              {usage.linked_flows.map((f) => (
                <li key={f.id}>
                  <Link to={`/flows/${f.id}`} className="text-accent">
                    {f.name}
                  </Link>
                  <span className="text-muted"> · {f.status} · </span>
                  <span className="font-mono text-xs">{f.trigger_payload}</span>
                  {f.button_index != null ? (
                    <span className="text-muted">
                      {' '}
                      · botón {f.button_index + 1}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {template.can_edit ? (
        <div className="space-y-3 border-t border-line pt-6">
          <h2 className="text-lg font-semibold">Editar y reenviar a Meta</h2>
          <TemplateForm
            key={`${template.id}-${template.synced_at}`}
            mode="edit"
            initialName={template.name}
            initialLanguage={template.language}
            initialCategory={template.category || 'MARKETING'}
            initialBuilder={template.builder}
            submitLabel="Guardar y reenviar a revisión"
            onSubmit={async (payload) => {
              const result = await apiClient.patch<{ id: number }>(
                `/api/templates/${template.id}`,
                {
                  category: payload.category,
                  builder: payload.builder,
                },
              )
              if (!result.ok) {
                throw new Error(result.error)
              }
              await load()
              setSearchParams({ flash: 'updated' }, { replace: true })
            }}
          />
        </div>
      ) : null}
    </div>
  )
}
