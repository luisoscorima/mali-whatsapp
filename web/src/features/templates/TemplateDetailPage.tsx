import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiClient } from '../../shared/api'
import { formatDateTime } from '../../shared/format'
import { templateStatusClass } from './templateStatus'

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
  const [template, setTemplate] = useState<TemplateDetail | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) return
    apiClient.get<TemplateDetail>(`/api/templates/${id}`).then((result) => {
      if (!result.ok) {
        setError(result.error)
        return
      }
      setTemplate(result.data)
    })
  }, [id])

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

  const d = template.display

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
      </div>

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

      <div className="rounded-xl border border-line bg-surface-strong p-4">
        <h2 className="mb-3 font-medium">Vista previa</h2>
        <div className="space-y-2 rounded-lg bg-bg p-4 text-sm">
          {d.headerFormat && d.headerFormat !== 'TEXT' ? (
            <p className="text-muted">
              Cabecera: {d.headerFormat}
            </p>
          ) : d.headerText ? (
            <p className="font-medium">{d.headerText}</p>
          ) : null}
          {d.bodyText ? (
            <p className="whitespace-pre-wrap">{d.bodyText}</p>
          ) : (
            <p className="text-muted">Sin cuerpo</p>
          )}
          {d.footerText ? (
            <p className="text-xs text-muted">{d.footerText}</p>
          ) : null}
          {d.buttons.length > 0 ? (
            <ul className="space-y-1 border-t border-line pt-2">
              {d.buttons.map((btn, i) => (
                <li key={i} className="text-accent">
                  {btn.text || btn.type}
                  {btn.url ? ` · ${btn.url}` : ''}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  )
}
