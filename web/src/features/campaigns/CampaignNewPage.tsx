import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiClient } from '../../shared/api'
import { formatContactName } from '../contacts/contactName'
import { segmentToneClass } from '../segments/segmentColors'

type SegmentDefinition = {
  id: number
  slug: string
  label: string
  color_key: string
}

type TemplateListItem = {
  id: number
  name: string
  language: string
  category: string
  status: string
}

type RecipientPreview = {
  id: number
  name: string
  phone: string
  service_window_open: boolean
}

function segmentTileClass(selected: boolean, exclude = false): string {
  const base =
    'flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors'
  if (selected) {
    return exclude
      ? `${base} border-bad bg-bad/10`
      : `${base} border-accent bg-accent-soft`
  }
  return `${base} border-line bg-surface hover:bg-surface-strong`
}

function fieldLabel(text: string, step?: string) {
  return (
    <div className="flex items-center gap-2">
      {step ? (
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-medium text-white">
          {step}
        </span>
      ) : null}
      <span className="font-medium">{text}</span>
    </div>
  )
}

export function CampaignNewPage() {
  const [segments, setSegments] = useState<SegmentDefinition[]>([])
  const [templates, setTemplates] = useState<TemplateListItem[]>([])
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState('')

  const [includeSegments, setIncludeSegments] = useState<Set<string>>(new Set())
  const [excludeSegments, setExcludeSegments] = useState<Set<string>>(new Set())
  const [excludeServiceWindow, setExcludeServiceWindow] = useState(false)

  const [recipients, setRecipients] = useState<RecipientPreview[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [recipientsLoaded, setRecipientsLoaded] = useState(false)
  const [recipientsStatus, setRecipientsStatus] = useState('')

  const [templateId, setTemplateId] = useState('')

  const approvedTemplates = useMemo(
    () =>
      templates.filter(
        (t) => String(t.status || '').trim().toUpperCase() === 'APPROVED',
      ),
    [templates],
  )

  async function loadWizardData() {
    setLoadError('')
    const [segResult, tplResult] = await Promise.all([
      apiClient.get<SegmentDefinition[]>('/api/segments'),
      apiClient.get<TemplateListItem[]>('/api/templates'),
    ])
    if (!segResult.ok) {
      setLoadError(segResult.error)
      return
    }
    if (!tplResult.ok) {
      setLoadError(tplResult.error)
      return
    }
    setSegments(segResult.data)
    setTemplates(tplResult.data)
  }

  useEffect(() => {
    loadWizardData()
  }, [])

  function toggleSegment(
    slug: string,
    set: React.Dispatch<React.SetStateAction<Set<string>>>,
  ) {
    set((prev) => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      return next
    })
    setRecipientsLoaded(false)
    setRecipients([])
    setSelectedIds(new Set())
    setRecipientsStatus('')
  }

  async function handleSyncTemplates() {
    setActionError('')
    setBusy('sync')
    const result = await apiClient.post('/api/templates/sync', {})
    setBusy('')
    if (!result.ok) {
      setActionError(result.error)
      return
    }
    await loadWizardData()
  }

  async function handleLoadRecipients() {
    setActionError('')
    const segmentList = [...includeSegments]
    if (!segmentList.length) {
      setActionError('Marca al menos un segmento.')
      return
    }

    setBusy('recipients')
    setRecipientsStatus('Cargando…')
    const result = await apiClient.post<{
      contacts: RecipientPreview[]
      total: number
    }>('/api/campaigns/recipients-preview', {
      segments: segmentList,
      excludeSegmentSlugs: [...excludeSegments],
      excludeOpenServiceWindow: excludeServiceWindow,
    })
    setBusy('')

    if (!result.ok) {
      setRecipientsStatus('')
      setActionError(result.error)
      return
    }

    setRecipients(result.data.contacts)
    setSelectedIds(new Set(result.data.contacts.map((c) => c.id)))
    setRecipientsLoaded(true)
    setRecipientsStatus(`${result.data.total} contactos`)
  }

  function selectAllRecipients() {
    setSelectedIds(new Set(recipients.map((r) => r.id)))
  }

  function selectNoRecipients() {
    setSelectedIds(new Set())
  }

  function toggleRecipient(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const windowOpenCount = recipients.filter((r) => r.service_window_open).length

  if (loadError) {
    return <p className="text-bad">{loadError}</p>
  }

  if (!segments.length && !templates.length) {
    return <p className="text-muted">Cargando wizard…</p>
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link to="/campaigns" className="text-sm text-accent">
        ← Campañas
      </Link>

      <div>
        <h1 className="text-2xl font-semibold">Nueva campaña</h1>
        <p className="text-sm text-muted">
          Elige audiencia y plantilla. El envío se habilitará en la semana 27.
        </p>
      </div>

      {actionError ? <p className="text-sm text-bad">{actionError}</p> : null}

      <section className="space-y-4 rounded-xl border border-line bg-surface-strong p-4">
        {fieldLabel('Quién recibe', '1')}
        {segments.length === 0 ? (
          <p className="text-sm text-muted">
            Añade segmentos en{' '}
            <Link to="/segments" className="text-accent">
              Segmentos
            </Link>
            .
          </p>
        ) : (
          <>
            <p className="text-xs text-muted">
              Incluye contactos que pertenezcan a <strong>cualquiera</strong> de
              los segmentos marcados (unión).
            </p>
            <div className="flex flex-wrap gap-2">
              {segments.map((seg) => (
                <label
                  key={seg.slug}
                  className={segmentTileClass(includeSegments.has(seg.slug))}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={includeSegments.has(seg.slug)}
                    onChange={() =>
                      toggleSegment(seg.slug, setIncludeSegments)
                    }
                  />
                  <span
                    className={`h-2 w-2 rounded-full ${segmentToneClass(seg.color_key)}`}
                  />
                  <span>{seg.label}</span>
                </label>
              ))}
            </div>

            <div className="space-y-2 border-t border-line pt-4">
              <p className="text-sm font-medium">Excluir segmentos (opcional)</p>
              <p className="text-xs text-muted">
                No recibirán el mensaje aunque estén en un segmento incluido.
              </p>
              <div className="flex flex-wrap gap-2">
                {segments.map((seg) => (
                  <label
                    key={`ex-${seg.slug}`}
                    className={segmentTileClass(
                      excludeSegments.has(seg.slug),
                      true,
                    )}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={excludeSegments.has(seg.slug)}
                      onChange={() =>
                        toggleSegment(seg.slug, setExcludeSegments)
                      }
                    />
                    <span>{seg.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={excludeServiceWindow}
                onChange={(e) => {
                  setExcludeServiceWindow(e.target.checked)
                  setRecipientsLoaded(false)
                }}
                className="mt-1"
              />
              <span>
                Excluir contactos con ventana de 24 h activa
                <span className="mt-1 block text-xs text-muted">
                  Si ya escribieron en las últimas 24 h, puedes responderles con
                  mensaje libre sin plantilla.
                </span>
              </span>
            </label>

            <div className="space-y-3 border-t border-line pt-4">
              {fieldLabel('Destinatarios', '2')}
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className="rounded-lg bg-accent px-4 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50"
                  disabled={busy !== '' || includeSegments.size === 0}
                  onClick={() => handleLoadRecipients()}
                >
                  {busy === 'recipients' ? 'Cargando…' : 'Mostrar destinatarios'}
                </button>
                {recipientsStatus ? (
                  <span className="text-sm text-muted">{recipientsStatus}</span>
                ) : null}
              </div>

              {recipientsLoaded && recipients.length > 0 ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="text-muted">
                      {selectedIds.size} / {recipients.length} seleccionados
                      {windowOpenCount > 0 && !excludeServiceWindow
                        ? ` · ${windowOpenCount} con ventana 24 h activa`
                        : ''}
                    </span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="rounded-lg border border-line px-2 py-1 text-xs hover:bg-surface"
                        onClick={() => selectAllRecipients()}
                      >
                        Marcar todos
                      </button>
                      <button
                        type="button"
                        className="rounded-lg border border-line px-2 py-1 text-xs hover:bg-surface"
                        onClick={() => selectNoRecipients()}
                      >
                        Ninguno
                      </button>
                    </div>
                  </div>
                  <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-lg border border-line text-sm">
                    {recipients.map((row) => (
                      <li key={row.id} className="flex items-start gap-3 px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(row.id)}
                          onChange={() => toggleRecipient(row.id)}
                          className="mt-1"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">
                            {formatContactName(row.name, '') || '—'}
                          </p>
                          <p className="font-mono text-xs text-muted">
                            {row.phone}
                            {row.service_window_open ? (
                              <span className="ml-2 text-accent">
                                ventana 24 h
                              </span>
                            ) : null}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              ) : recipientsLoaded ? (
                <p className="text-sm text-muted">
                  No hay destinatarios con los filtros actuales.
                </p>
              ) : null}
            </div>
          </>
        )}
      </section>

      <section className="space-y-3 rounded-xl border border-line bg-surface-strong p-4">
        {fieldLabel('Plantilla (Meta)', '3')}
        {approvedTemplates.length === 0 ? (
          <p className="text-sm text-muted">
            No hay plantillas aprobadas. Sincroniza desde Meta.
          </p>
        ) : null}
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[240px] flex-1 text-sm">
            <span className="text-muted">Seleccionar plantilla</span>
            <select
              className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              disabled={approvedTemplates.length === 0}
            >
              <option value="">— Elige una plantilla —</option>
              {approvedTemplates.map((t) => (
                <option key={t.id} value={String(t.id)}>
                  {t.name} · {t.language} · {t.category || '—'}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="rounded-lg border border-line px-3 py-2 text-sm hover:bg-surface"
            disabled={busy === 'sync'}
            onClick={() => handleSyncTemplates()}
          >
            {busy === 'sync' ? 'Sincronizando…' : '↻ Sincronizar'}
          </button>
        </div>
        <p className="text-xs text-muted">
          Los parámetros de plantilla y la programación llegan en la semana 26.
        </p>
      </section>

      <p className="text-sm text-muted">
        Resumen: {includeSegments.size} segmento(s) ·{' '}
        {recipientsLoaded ? `${selectedIds.size} destinatarios` : 'sin lista'} ·{' '}
        {templateId ? 'plantilla elegida' : 'sin plantilla'}.
      </p>

      <button
        type="button"
        className="rounded-lg bg-line px-4 py-2 text-sm text-muted"
        disabled
        title="Envío disponible en semana 27"
      >
        Enviar campaña (próximamente)
      </button>
    </div>
  )
}
