import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiClient } from '../../shared/api'
import { formatContactName } from '../contacts/contactName'
import { segmentToneClass } from '../segments/segmentColors'
import {
  CampaignTemplateFields,
  emptyTemplateFormState,
  type AttributeOption,
  type CampaignTemplateFormState,
} from './CampaignTemplateFields'
import { CampaignShell } from './CampaignShell'

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

type ContactSearchHit = {
  id: number
  name: string
  last_name: string
  phone: string
}

type ExcludedContact = {
  id: number
  name: string
  phone: string
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

function buildSendPayload(input: {
  segments: string[]
  selectedIds: number[]
  excludeSegments: string[]
  excludeContactIds: number[]
  excludeServiceWindow: boolean
  templateId: string
  scheduleMode: 'now' | 'scheduled'
  scheduledAt: string
  batchSize: number
  batchDelayMs: number
  form: CampaignTemplateFormState
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    segments: input.segments,
    recipientContactIds: input.selectedIds,
    excludeSegmentSlugs: input.excludeSegments,
    excludeOpenServiceWindow: input.excludeServiceWindow,
    templateSyncId: Number(input.templateId),
    scheduleMode: input.scheduleMode,
    batchSize: input.batchSize,
    batchDelayMs: input.batchDelayMs,
    headerMediaUrl: input.form.headerMediaUrl,
  }
  if (input.excludeContactIds.length > 0) {
    body.excludeContactIds = input.excludeContactIds
  }
  if (input.scheduleMode === 'scheduled' && input.scheduledAt) {
    const t = new Date(input.scheduledAt)
    body.scheduledAt = Number.isNaN(t.getTime())
      ? input.scheduledAt
      : t.toISOString()
  }
  input.form.headerParams.forEach((v, i) => {
    body[`headerParam_${i}`] = v
    body[`headerParamSource_${i}`] = input.form.headerParamSources[i] || 'static'
  })
  input.form.bodyParams.forEach((v, i) => {
    body[`bodyParam_${i}`] = v
    body[`bodyParamSource_${i}`] = input.form.bodyParamSources[i] || 'static'
  })
  input.form.buttonParams.forEach((v, i) => {
    body[`buttonParam_${i}`] = v
    body[`buttonParamSource_${i}`] = input.form.buttonParamSources[i] || 'static'
  })
  return body
}

export function CampaignNewPage() {
  const navigate = useNavigate()
  const [segments, setSegments] = useState<SegmentDefinition[]>([])
  const [templates, setTemplates] = useState<TemplateListItem[]>([])
  const [attrDefs, setAttrDefs] = useState<AttributeOption[]>([])
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState('')

  const [includeSegments, setIncludeSegments] = useState<Set<string>>(new Set())
  const [excludeSegments, setExcludeSegments] = useState<Set<string>>(new Set())
  const [excludeContactIds, setExcludeContactIds] = useState<Set<number>>(
    new Set(),
  )
  const [excludedContacts, setExcludedContacts] = useState<ExcludedContact[]>(
    [],
  )
  const [contactSearchQuery, setContactSearchQuery] = useState('')
  const [contactSearchResults, setContactSearchResults] = useState<
    ContactSearchHit[]
  >([])
  const [excludeServiceWindow, setExcludeServiceWindow] = useState(false)

  const [recipients, setRecipients] = useState<RecipientPreview[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [recipientsLoaded, setRecipientsLoaded] = useState(false)
  const [recipientsStatus, setRecipientsStatus] = useState('')

  const [templateId, setTemplateId] = useState('')
  const [templateForm, setTemplateForm] = useState<CampaignTemplateFormState>(
    emptyTemplateFormState(),
  )
  const [templateReady, setTemplateReady] = useState(false)

  const [scheduleMode, setScheduleMode] = useState<'now' | 'scheduled'>('now')
  const [scheduledAt, setScheduledAt] = useState('')
  const [batchSize, setBatchSize] = useState(40)
  const [batchDelayMs, setBatchDelayMs] = useState(1500)

  const approvedTemplates = useMemo(
    () =>
      templates.filter(
        (t) => String(t.status || '').trim().toUpperCase() === 'APPROVED',
      ),
    [templates],
  )

  const selectedTemplate = approvedTemplates.find(
    (t) => String(t.id) === templateId,
  )

  async function loadWizardData() {
    setLoadError('')
    const [segResult, tplResult, attrResult] = await Promise.all([
      apiClient.get<SegmentDefinition[]>('/api/segments'),
      apiClient.get<TemplateListItem[]>('/api/templates'),
      apiClient.get<AttributeOption[]>('/api/attribute-definitions'),
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
    if (attrResult.ok) {
      setAttrDefs(
        attrResult.data.map((a) => ({ slug: a.slug, label: a.label })),
      )
    }
  }

  useEffect(() => {
    loadWizardData()
  }, [])

  function invalidateRecipients() {
    setRecipientsLoaded(false)
    setRecipients([])
    setSelectedIds(new Set())
    setRecipientsStatus('')
  }

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
    invalidateRecipients()
  }

  function addExcludeContact(contact: ExcludedContact) {
    if (excludeContactIds.has(contact.id)) return
    setExcludeContactIds((prev) => new Set(prev).add(contact.id))
    setExcludedContacts((prev) => [...prev, contact])
    setRecipients((prev) => prev.filter((r) => r.id !== contact.id))
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.delete(contact.id)
      return next
    })
    setContactSearchResults((prev) => prev.filter((r) => r.id !== contact.id))
  }

  function removeExcludeContact(id: number) {
    setExcludeContactIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    setExcludedContacts((prev) => prev.filter((c) => c.id !== id))
    invalidateRecipients()
  }

  async function handleSearchContacts() {
    const q = contactSearchQuery.trim()
    if (!q) return
    setActionError('')
    setBusy('contact-search')
    const result = await apiClient.get<{
      items: ContactSearchHit[]
    }>(`/api/contacts?q=${encodeURIComponent(q)}&limit=15`)
    setBusy('')
    if (!result.ok) {
      setActionError(result.error)
      return
    }
    setContactSearchResults(
      result.data.items.filter((row) => !excludeContactIds.has(row.id)),
    )
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
      excludeContactIds: [...excludeContactIds].sort((a, b) => a - b),
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

  const canSend =
    includeSegments.size > 0 &&
    recipientsLoaded &&
    selectedIds.size > 0 &&
    templateId &&
    templateReady &&
    (scheduleMode === 'now' || Boolean(scheduledAt.trim()))

  async function handleSend() {
    setActionError('')
    if (!canSend) return

    const tplLabel = selectedTemplate
      ? `${selectedTemplate.name} · ${selectedTemplate.language}`
      : 'plantilla'
    const when =
      scheduleMode === 'scheduled'
        ? `programada para ${scheduledAt}`
        : 'envío inmediato'
    const ok = window.confirm(
      `¿Confirmas la campaña?\n\n` +
        `${selectedIds.size} destinatarios` +
        (excludedContacts.length > 0
          ? `\n${excludedContacts.length} contacto(s) excluido(s)`
          : '') +
        `\nPlantilla: ${tplLabel}\n` +
        `${when}`,
    )
    if (!ok) return

    setBusy('send')
    const payload = buildSendPayload({
      segments: [...includeSegments],
      selectedIds: [...selectedIds].sort((a, b) => a - b),
      excludeSegments: [...excludeSegments],
      excludeContactIds: [...excludeContactIds].sort((a, b) => a - b),
      excludeServiceWindow,
      templateId,
      scheduleMode,
      scheduledAt,
      batchSize,
      batchDelayMs,
      form: templateForm,
    })

    const result = await apiClient.post<{
      campaignId: number
      redirect: string
    }>('/api/campaigns/send', payload)
    setBusy('')

    if (!result.ok) {
      setActionError(result.error)
      return
    }

    navigate(`/campaigns/${result.data.campaignId}`)
  }

  const windowOpenCount = recipients.filter((r) => r.service_window_open).length

  if (loadError) {
    return <p className="text-bad">{loadError}</p>
  }

  if (!segments.length && !templates.length) {
    return (
      <CampaignShell>
        <p className="text-muted">Cargando wizard…</p>
      </CampaignShell>
    )
  }

  return (
    <CampaignShell>
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Nueva campaña</h1>
        <p className="text-sm text-muted">
          Elige audiencia, plantilla y parámetros. Puedes enviar ahora o programar.
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

            <div className="space-y-2 border-t border-line pt-4">
              <p className="text-sm font-medium">
                Excluir contactos concretos (opcional)
              </p>
              <p className="text-xs text-muted">
                Busca por nombre o teléfono. No recibirán la campaña aunque
                pertenezcan a los segmentos incluidos.
              </p>

              {excludedContacts.length > 0 ? (
                <ul className="flex flex-wrap gap-2">
                  {excludedContacts.map((contact) => (
                    <li
                      key={contact.id}
                      className="flex items-center gap-1 rounded-lg border border-bad/30 bg-bad/10 px-2 py-1 text-xs"
                    >
                      <span>
                        {formatContactName(contact.name, '') || '—'} ·{' '}
                        <span className="font-mono">{contact.phone}</span>
                      </span>
                      <button
                        type="button"
                        className="ml-1 text-bad hover:opacity-80"
                        aria-label="Quitar exclusión"
                        onClick={() => removeExcludeContact(contact.id)}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <input
                  type="search"
                  className="min-w-[200px] flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm"
                  placeholder="Nombre o teléfono…"
                  value={contactSearchQuery}
                  onChange={(e) => setContactSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void handleSearchContacts()
                    }
                  }}
                />
                <button
                  type="button"
                  className="rounded-lg border border-line px-3 py-2 text-sm hover:bg-surface disabled:opacity-50"
                  disabled={
                    busy !== '' || !contactSearchQuery.trim()
                  }
                  onClick={() => void handleSearchContacts()}
                >
                  {busy === 'contact-search' ? 'Buscando…' : 'Buscar'}
                </button>
              </div>

              {contactSearchResults.length > 0 ? (
                <ul className="divide-y divide-line rounded-lg border border-line text-sm">
                  {contactSearchResults.map((row) => (
                    <li
                      key={row.id}
                      className="flex items-center justify-between gap-3 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="font-medium">
                          {formatContactName(row.name, row.last_name) || '—'}
                        </p>
                        <p className="font-mono text-xs text-muted">
                          {row.phone}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="shrink-0 text-xs text-bad hover:underline"
                        onClick={() =>
                          addExcludeContact({
                            id: row.id,
                            name: formatContactName(row.name, row.last_name),
                            phone: row.phone,
                          })
                        }
                      >
                        Excluir
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={excludeServiceWindow}
                onChange={(e) => {
                  setExcludeServiceWindow(e.target.checked)
                  invalidateRecipients()
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
                        <button
                          type="button"
                          className="shrink-0 text-xs text-bad hover:underline"
                          onClick={() =>
                            addExcludeContact({
                              id: row.id,
                              name: row.name,
                              phone: row.phone,
                            })
                          }
                        >
                          Excluir
                        </button>
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
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[240px] flex-1 text-sm">
            <span className="text-muted">Seleccionar plantilla</span>
            <select
              className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2"
              value={templateId}
              onChange={(e) => {
                setTemplateId(e.target.value)
                setTemplateReady(false)
                setTemplateForm(emptyTemplateFormState())
              }}
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

        <CampaignTemplateFields
          templateId={templateId}
          attrDefs={attrDefs}
          form={templateForm}
          onFormChange={setTemplateForm}
          onReadyChange={setTemplateReady}
        />
      </section>

      <section className="space-y-3 rounded-xl border border-line bg-surface-strong p-4">
        {fieldLabel('Programación y envío', '4')}
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="scheduleMode"
              checked={scheduleMode === 'now'}
              onChange={() => setScheduleMode('now')}
            />
            Enviar ahora
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="scheduleMode"
              checked={scheduleMode === 'scheduled'}
              onChange={() => setScheduleMode('scheduled')}
            />
            Programar
          </label>
        </div>
        {scheduleMode === 'scheduled' ? (
          <label className="block text-sm">
            <span className="text-muted">Fecha y hora</span>
            <input
              type="datetime-local"
              className="mt-1 rounded-lg border border-line bg-surface px-3 py-2"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              required
            />
          </label>
        ) : null}
        <div className="flex flex-wrap gap-4 text-sm">
          <label>
            <span className="text-muted">Tamaño de lote</span>
            <input
              type="number"
              min={1}
              max={100}
              className="mt-1 block w-24 rounded-lg border border-line bg-surface px-2 py-1"
              value={batchSize}
              onChange={(e) => setBatchSize(Number(e.target.value))}
            />
          </label>
          <label>
            <span className="text-muted">Pausa entre lotes (ms)</span>
            <input
              type="number"
              min={0}
              max={60000}
              className="mt-1 block w-28 rounded-lg border border-line bg-surface px-2 py-1"
              value={batchDelayMs}
              onChange={(e) => setBatchDelayMs(Number(e.target.value))}
            />
          </label>
        </div>
      </section>

      <p className="text-sm text-muted">
        Resumen: {includeSegments.size} segmento(s) ·{' '}
        {excludedContacts.length > 0
          ? `${excludedContacts.length} excluido(s) · `
          : ''}
        {recipientsLoaded ? `${selectedIds.size} destinatarios` : 'sin lista'} ·{' '}
        {templateId ? selectedTemplate?.name || 'plantilla' : 'sin plantilla'} ·{' '}
        {scheduleMode === 'scheduled' ? 'programada' : 'envío inmediato'}.
      </p>

      <button
        type="button"
        className="rounded-lg bg-accent px-4 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50"
        disabled={!canSend || busy !== ''}
        onClick={() => handleSend()}
      >
        {busy === 'send'
          ? scheduleMode === 'scheduled'
            ? 'Programando…'
            : 'Enviando…'
          : scheduleMode === 'scheduled'
            ? 'Programar campaña'
            : 'Enviar campaña'}
      </button>
    </div>
    </CampaignShell>
  )
}
