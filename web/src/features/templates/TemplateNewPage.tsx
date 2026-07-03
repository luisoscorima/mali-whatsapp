import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { apiClient } from '../../shared/api'
import { TemplateForm } from './TemplateForm'
import { EMPTY_BUILDER, type TemplateBuilderState } from './templateFormUtils'

type TemplateDetail = {
  id: number
  name: string
  language: string
  category: string | null
  builder: TemplateBuilderState
}

export function TemplateNewPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const duplicateFrom = Number(searchParams.get('duplicate_from') || '')
  const [source, setSource] = useState<TemplateDetail | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!Number.isInteger(duplicateFrom) || duplicateFrom <= 0) return
    apiClient.get<TemplateDetail>(`/api/templates/${duplicateFrom}`).then((result) => {
      if (!result.ok) {
        setError(result.error)
        return
      }
      setSource(result.data)
    })
  }, [duplicateFrom])

  const initialName = source ? `${source.name}_v2` : ''
  const initialLanguage = source?.language || 'es'
  const initialCategory = source?.category || 'MARKETING'
  const initialBuilder = source?.builder || EMPTY_BUILDER

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

  if (duplicateFrom > 0 && !source) {
    return <p className="text-muted">Cargando plantilla origen…</p>
  }

  return (
    <div className="space-y-4">
      <Link to="/templates" className="text-sm text-accent">
        ← Plantillas
      </Link>
      <div>
        <h1 className="text-2xl font-semibold">
          {source ? 'Nueva versión de plantilla' : 'Nueva plantilla'}
        </h1>
        {source ? (
          <p className="text-sm text-muted">
            Basada en <span className="font-mono">{source.name}</span>. Usa otro
            nombre o idioma distinto al original.
          </p>
        ) : null}
      </div>
      <TemplateForm
        mode="create"
        initialName={initialName}
        initialLanguage={initialLanguage}
        initialCategory={initialCategory}
        initialBuilder={initialBuilder}
        sourceTemplateId={source?.id}
        submitLabel={source ? 'Crear nueva versión' : 'Enviar a revisión Meta'}
        onSubmit={async (payload) => {
          const result = await apiClient.post<{ id: number }>('/api/templates', {
            name: payload.name,
            language: payload.language,
            category: payload.category,
            builder: payload.builder,
            source_template_id: payload.source_template_id,
          })
          if (!result.ok) {
            throw new Error(result.error)
          }
          navigate(`/templates/${result.data.id}?flash=created`)
        }}
      />
    </div>
  )
}
