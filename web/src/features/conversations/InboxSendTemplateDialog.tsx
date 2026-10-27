import { useEffect, useState } from 'react'
import {
  TemplateParamRow,
  type AttributeOption,
  type WizardTemplateDefinition,
} from '@/features/campaigns/CampaignTemplateFields'
import { apiClient } from '@/shared/api'
import { notify } from '@/shared/notify'
import { Button } from '@/shared/ui/shadcn/button'
import { SearchableSelect } from '@/shared/ui/SearchableSelect'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/shadcn/dialog'

type TemplateItem = {
  id: number
  name: string
  language: string
  category?: string
  status: string
  active: boolean
}

type InboxSendTemplateDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  conversationId: number
  onSent: () => void
}

function headerMediaLabel(headerMedia: string | null): string {
  if (headerMedia === 'IMAGE') return 'URL imagen (cabecera)'
  if (headerMedia === 'VIDEO') return 'URL video (cabecera)'
  return 'URL documento (cabecera)'
}

export function InboxSendTemplateDialog({
  open,
  onOpenChange,
  conversationId,
  onSent,
}: InboxSendTemplateDialogProps) {
  const [templates, setTemplates] = useState<TemplateItem[]>([])
  const [templatesLoading, setTemplatesLoading] = useState(false)
  const [templatesError, setTemplatesError] = useState('')
  const [attrDefs, setAttrDefs] = useState<AttributeOption[]>([])
  const [templateId, setTemplateId] = useState('')
  const [def, setDef] = useState<WizardTemplateDefinition | null>(null)
  const [defLoading, setDefLoading] = useState(false)
  const [headerMediaUrl, setHeaderMediaUrl] = useState('')
  const [headerParams, setHeaderParams] = useState<string[]>([])
  const [bodyParams, setBodyParams] = useState<string[]>([])
  const [buttonParams, setButtonParams] = useState<string[]>([])
  const [headerParamSources, setHeaderParamSources] = useState<string[]>([])
  const [bodyParamSources, setBodyParamSources] = useState<string[]>([])
  const [buttonParamSources, setButtonParamSources] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setTemplateId('')
    setDef(null)
    setTemplates([])
    setAttrDefs([])
    setTemplatesLoading(true)
    setTemplatesError('')
    setHeaderMediaUrl('')
    setHeaderParams([])
    setBodyParams([])
    setButtonParams([])
    setHeaderParamSources([])
    setBodyParamSources([])
    setButtonParamSources([])
    void apiClient
      .get<TemplateItem[]>(
        `/api/templates/sendable?conversationId=${encodeURIComponent(String(conversationId))}`,
      )
      .then((res) => {
      setTemplatesLoading(false)
      if (!res.ok) {
        setTemplatesError(res.error)
        return
      }
      setTemplates(res.data)
    })
    void apiClient
      .get<(AttributeOption & { category?: string })[]>('/api/attribute-definitions')
      .then((res) => {
        if (res.ok) {
          setAttrDefs(
            res.data.map((attr) => ({
              slug: attr.slug,
              label: attr.label,
              category: attr.category,
            })),
          )
        }
      })
  }, [open, conversationId])

  useEffect(() => {
    if (!templateId) {
      setDef(null)
      setHeaderMediaUrl('')
      setHeaderParams([])
      setBodyParams([])
      setButtonParams([])
      setHeaderParamSources([])
      setBodyParamSources([])
      setButtonParamSources([])
      return
    }

    let cancelled = false
    setDefLoading(true)
    void apiClient
      .get<WizardTemplateDefinition>(`/api/templates/sendable/${templateId}/definition`)
      .then((res) => {
        if (cancelled) return
        setDefLoading(false)
        if (!res.ok) {
          setDef(null)
          notify.error(res.error)
          return
        }
        setDef(res.data)
        setHeaderMediaUrl('')
        setHeaderParams(Array(res.data.headerTextSlotCount).fill(''))
        setBodyParams(Array(res.data.bodySlotCount).fill(''))
        setButtonParams(Array(res.data.totalButtonParams).fill(''))
        setHeaderParamSources(Array(res.data.headerTextSlotCount).fill('static'))
        setBodyParamSources(Array(res.data.bodySlotCount).fill('static'))
        setButtonParamSources(Array(res.data.totalButtonParams).fill('static'))
      })

    return () => {
      cancelled = true
    }
  }, [templateId])

  function clientMissingFields(): string | null {
    if (!def) return 'Selecciona una plantilla'
    if (def.needsHeaderMedia && !headerMediaUrl.trim()) {
      return `Completa: ${headerMediaLabel(def.headerMedia)}`
    }
    for (let i = 0; i < def.headerTextSlotCount; i++) {
      if (
        (headerParamSources[i] || 'static') === 'static' &&
        !headerParams[i]?.trim()
      ) {
        return `Completa: ${def.headerParamDefs[i]?.label || `Texto cabecera (${i + 1})`}`
      }
    }
    for (let i = 0; i < def.bodySlotCount; i++) {
      if (
        (bodyParamSources[i] || 'static') === 'static' &&
        !bodyParams[i]?.trim()
      ) {
        return `Completa: ${def.bodyParamDefs[i]?.label || `Texto cuerpo (${i + 1})`}`
      }
    }
    for (let i = 0; i < def.totalButtonParams; i++) {
      if (
        (buttonParamSources[i] || 'static') === 'static' &&
        !buttonParams[i]?.trim()
      ) {
        return `Completa: ${def.buttonParamDefs[i]?.label || `Botón URL (${i + 1})`}`
      }
    }
    return null
  }

  async function handleSend() {
    const id = Number(templateId)
    if (!id || !def) return
    const missing = clientMissingFields()
    if (missing) {
      notify.error(missing)
      return
    }
    setBusy(true)
    const payload: Record<string, unknown> = {
      templateSyncId: id,
      headerMediaUrl: headerMediaUrl.trim(),
      headerParams: headerParams.map((v) => v.trim()),
      bodyParams: bodyParams.map((v) => v.trim()),
      buttonParams: buttonParams.map((v) => v.trim()),
    }
    headerParamSources.forEach((source, i) => {
      payload[`headerParamSource_${i}`] = source
    })
    bodyParamSources.forEach((source, i) => {
      payload[`bodyParamSource_${i}`] = source
    })
    buttonParamSources.forEach((source, i) => {
      payload[`buttonParamSource_${i}`] = source
    })
    const res = await apiClient.post(
      `/api/conversations/${conversationId}/send-template`,
      payload,
    )
    setBusy(false)
    if (!res.ok) {
      notify.error(res.error)
      return
    }
    onSent()
    onOpenChange(false)
  }

  const hasParams =
    def &&
    (def.needsHeaderMedia ||
      def.headerTextSlotCount > 0 ||
      def.bodySlotCount > 0 ||
      def.totalButtonParams > 0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(96vw,420px)]">
        <DialogHeader>
          <DialogTitle>Enviar plantilla</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <p className="muted text-sm">
            Solo disponible con ventana de 24 h cerrada, para reactivar la conversación.
          </p>
          <label className="block text-sm">
            Plantilla
            <SearchableSelect
              className="mt-1"
              value={templateId}
              onChange={setTemplateId}
              disabled={templatesLoading}
              placeholder={templatesLoading ? 'Cargando…' : 'Seleccionar…'}
              searchPlaceholder="Buscar plantilla…"
              clearOption={{
                label: templatesLoading ? 'Cargando…' : 'Seleccionar…',
              }}
              aria-label="Seleccionar plantilla"
              options={templates.map((t) => ({
                value: String(t.id),
                label: `${t.name} (${t.language})`,
                group: (t.category || '—').toUpperCase(),
                keywords: t.name,
              }))}
            />
          </label>

          {templatesError ? (
            <p className="text-sm text-danger">{templatesError}</p>
          ) : null}

          {!templatesLoading && !templatesError && templates.length === 0 ? (
            <p className="muted text-sm">No hay plantillas aprobadas y activas disponibles.</p>
          ) : null}

          {defLoading ? (
            <p className="muted text-sm">Cargando parámetros de plantilla…</p>
          ) : null}

          {def && !defLoading && !hasParams ? (
            <p className="muted text-sm">Esta plantilla no requiere parámetros variables.</p>
          ) : null}

          {def?.needsHeaderMedia ? (
            <label className="block text-sm">
              {headerMediaLabel(def.headerMedia)}
              <input
                type="url"
                required
                value={headerMediaUrl}
                onChange={(e) => setHeaderMediaUrl(e.target.value)}
                className="mt-1 w-full rounded-lg border border-line bg-bg px-2 py-1.5 text-sm"
                placeholder="https://…"
              />
            </label>
          ) : null}

          {def
            ? Array.from({ length: def.headerTextSlotCount }).map((_, i) => (
                <TemplateParamRow
                  key={`h-${i}`}
                  label={def.headerParamDefs[i]?.label || `Texto cabecera (${i + 1})`}
                  value={headerParams[i] || ''}
                  source={headerParamSources[i] || 'static'}
                  attrs={attrDefs}
                  onValueChange={(value) => {
                    const next = [...headerParams]
                    next[i] = value
                    setHeaderParams(next)
                  }}
                  onSourceChange={(source) => {
                    const next = [...headerParamSources]
                    next[i] = source
                    setHeaderParamSources(next)
                  }}
                />
              ))
            : null}

          {def
            ? Array.from({ length: def.bodySlotCount }).map((_, i) => (
                <TemplateParamRow
                  key={`b-${i}`}
                  label={def.bodyParamDefs[i]?.label || `Texto cuerpo (${i + 1})`}
                  value={bodyParams[i] || ''}
                  source={bodyParamSources[i] || 'static'}
                  attrs={attrDefs}
                  onValueChange={(value) => {
                    const next = [...bodyParams]
                    next[i] = value
                    setBodyParams(next)
                  }}
                  onSourceChange={(source) => {
                    const next = [...bodyParamSources]
                    next[i] = source
                    setBodyParamSources(next)
                  }}
                />
              ))
            : null}

          {def
            ? Array.from({ length: def.totalButtonParams }).map((_, i) => (
                <TemplateParamRow
                  key={`btn-${i}`}
                  label={def.buttonParamDefs[i]?.label || `Botón URL (${i + 1})`}
                  value={buttonParams[i] || ''}
                  source={buttonParamSources[i] || 'static'}
                  attrs={attrDefs}
                  onValueChange={(value) => {
                    const next = [...buttonParams]
                    next[i] = value
                    setButtonParams(next)
                  }}
                  onSourceChange={(source) => {
                    const next = [...buttonParamSources]
                    next[i] = source
                    setButtonParamSources(next)
                  }}
                />
              ))
            : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose>Cancelar</DialogClose>
          <Button
            type="button"
            disabled={busy || templatesLoading || !templateId || defLoading || !def}
            onClick={() => void handleSend()}
          >
            {busy ? 'Enviando…' : 'Enviar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
