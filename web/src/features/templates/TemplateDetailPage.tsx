import { useCallback, useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { apiClient } from '../../shared/api'
import { formatDateTime } from '../../shared/format'
import { TemplateFlashBanner } from './TemplateFlashBanner'
import { TemplateForm } from './TemplateForm'
import { TemplateLivePreview } from './TemplateLivePreview'
import { templateStatusClass } from './templateStatus'
import type { TemplateBuilderState } from './templateFormUtils'
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
  can_edit: boolean
  builder: TemplateBuilderState
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
  const [, setSearchParams] = useSearchParams()
  const [template, setTemplate] = useState<TemplateDetail | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!id) return
    const result = await apiClient.get<TemplateDetail>(`/api/templates/${id}`)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setTemplate(result.data)
    setError('')
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  if (error) {
    return (
      <div className="space-y-3">
        <Link to="/templates" className="text-sm text-accent">
          ← Plantillas
        </Link>
        <p className="text-bad">{error}</p>
      </div>
    )
  }

  if (!template) {
    return <p className="text-muted">Cargando plantilla…</p>
  }

  return (
    <div className="space-y-4">
      <Link to="/templates" className="text-sm text-accent">
        ← Plantillas
      </Link>

      <TemplateFlashBanner />

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-2xl font-semibold">{template.name}</h1>
        <span
          className={`rounded px-2 py-0.5 text-xs font-medium ${templateStatusClass(template.status)}`}
        >
          {template.status}
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

        <TemplateLivePreview state={template.builder} showMeta={false} />
      </div>

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
