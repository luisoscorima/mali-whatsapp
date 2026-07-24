import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiClient } from '../../shared/api'
import { notify } from '@/shared/notify'
import { formatContactName } from '../contacts/contactName'
import { SegmentFilterSelect } from '../segments/SegmentFilterSelect'
import {
  CampaignTemplateFields,
  emptyTemplateFormState,
  type AttributeOption,
  type CampaignTemplateFormState,
} from './CampaignTemplateFields'

type SegmentDefinition = {
  id: number
  slug: string
  label: string
  color_key: string
  active: boolean
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

type ExcludedContact = {
  id: number
  name: string
  phone: string
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
  linkedFlowId: string
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
  if (input.linkedFlowId) {
    body.linked_flow_id = Number(input.linkedFlowId)
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
  const [loadFailed, setLoadFailed] = useState(false)
  const [busy, setBusy] = useState('')

  const [includeSegments, setIncludeSegments] = useState<Set<string>>(new Set())
  const [excludeSegments, setExcludeSegments] = useState<Set<string>>(new Set())
  const [excludeContactIds, setExcludeContactIds] = useState<Set<number>>(
    new Set(),
  )
  const [excludedContacts, setExcludedContacts] = useState<ExcludedContact[]>(
    [],
  )
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
  const [linkedFlowId, setLinkedFlowId] = useState('')
  const [flowOptions, setFlowOptions] = useState<
    { id: number; name: string; trigger_payload: string; status: string }[]
  >([])

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
    setLoadFailed(false)
    const [segResult, tplResult, attrResult, flowsResult] = await Promise.all([
      apiClient.get<SegmentDefinition[]>('/api/segments/active'),
      apiClient.get<TemplateListItem[]>('/api/templates'),
      apiClient.get<AttributeOption[]>('/api/attribute-definitions'),
      apiClient.get<
        { id: number; name: string; trigger_payload: string; status: string }[]
      >('/api/flows'),
    ])
    if (!segResult.ok) {
      notify.error(segResult.error)
      setLoadFailed(true)
      return
    }
    if (!tplResult.ok) {
      notify.error(tplResult.error)
      setLoadFailed(true)
      return
    }
    setSegments(segResult.data)
    setTemplates(tplResult.data)
    if (attrResult.ok) {
      setAttrDefs(
        attrResult.data.map((a) => ({ slug: a.slug, label: a.label })),
      )
    }
    if (flowsResult.ok) setFlowOptions(flowsResult.data)
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
  }

  async function handleSyncTemplates() {
    setBusy('sync')
    const result = await apiClient.post('/api/templates/sync', {})
    setBusy('')
    if (!result.ok) {
      notify.error(result.error)
      return
    }
    await loadWizardData()
  }

  async function handleLoadRecipients() {
    const segmentList = [...includeSegments]
    if (!segmentList.length) {
      notify.error('Marca al menos un segmento.')
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
      notify.error(result.error)
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
      linkedFlowId,
    })

    const result = await apiClient.post<{
      campaignId: number
      redirect: string
    }>('/api/campaigns/send', payload)
    setBusy('')

    if (!result.ok) {
      notify.error(result.error)
      return
    }

    navigate(`/campaigns/${result.data.campaignId}`)
  }

  const windowOpenCount = recipients.filter((r) => r.service_window_open).length

  if (loadFailed) {
    return <p className="text-muted">No se pudo cargar</p>
  }

  if (!segments.length && !templates.length) {
    return <p className="text-muted">Cargando wizard…</p>
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Nueva campaña</h1>
        <p className="text-sm text-muted">
          Elige audiencia, plantilla y parámetros. Puedes enviar ahora o programar.
        </p>
      </div>

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
            <SegmentFilterSelect
              variant="form"
              segments={segments}
              selectedSlugs={[...includeSegments]}
              onToggle={(slug) => toggleSegment(slug, setIncludeSegments)}
              onClearAll={() => {
                setIncludeSegments(new Set())
                invalidateRecipients()
              }}
            />

            <div className="space-y-2 border-t border-line pt-4">
              <p className="text-sm font-medium">Excluir segmentos (opcional)</p>
              <SegmentFilterSelect
                variant="form"
                segments={segments}
                selectedSlugs={[...excludeSegments]}
                onToggle={(slug) => toggleSegment(slug, setExcludeSegments)}
                onClearAll={() => {
                  setExcludeSegments(new Set())
                  invalidateRecipients()
                }}
              />
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
        <label className="block text-sm">
          <span className="text-muted">Flujo vinculado (opcional)</span>
          <select
            className="mt-1 block w-full max-w-md rounded-lg border border-line bg-surface px-2 py-2"
            value={linkedFlowId}
            onChange={(e) => setLinkedFlowId(e.target.value)}
          >
            <option value="">Sin flujo</option>
            {flowOptions.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name} · {f.trigger_payload}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted">
            Solo referencia. El trigger del flujo debe coincidir con el botón
            QUICK_REPLY de la plantilla.
          </p>
        </label>
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
  )
}
