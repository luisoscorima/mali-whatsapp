import { useEffect, useState } from 'react'
import type { WizardTemplateDefinition } from '@/features/campaigns/CampaignTemplateFields'
import { apiClient } from '@/shared/api'
import { notify } from '@/shared/notify'
import { Button } from '@/shared/ui/shadcn/button'
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
  status: string
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
  const [templateId, setTemplateId] = useState('')
  const [def, setDef] = useState<WizardTemplateDefinition | null>(null)
  const [defLoading, setDefLoading] = useState(false)
  const [headerMediaUrl, setHeaderMediaUrl] = useState('')
  const [headerParams, setHeaderParams] = useState<string[]>([])
  const [bodyParams, setBodyParams] = useState<string[]>([])
  const [buttonParams, setButtonParams] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setTemplateId('')
    setDef(null)
    setHeaderMediaUrl('')
    setHeaderParams([])
    setBodyParams([])
    setButtonParams([])
    void apiClient.get<TemplateItem[]>('/api/templates').then((res) => {
      if (res.ok) {
        setTemplates(res.data.filter((t) => t.status === 'APPROVED'))
      }
    })
  }, [open])

  useEffect(() => {
    if (!templateId) {
      setDef(null)
      setHeaderMediaUrl('')
      setHeaderParams([])
      setBodyParams([])
      setButtonParams([])
      return
    }

    let cancelled = false
    setDefLoading(true)
    void apiClient
      .get<WizardTemplateDefinition>(`/api/templates/${templateId}/definition`)
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
      if (!headerParams[i]?.trim()) {
        return `Completa: ${def.headerParamDefs[i]?.label || `Texto cabecera (${i + 1})`}`
      }
    }
    for (let i = 0; i < def.bodySlotCount; i++) {
      if (!bodyParams[i]?.trim()) {
        return `Completa: ${def.bodyParamDefs[i]?.label || `Texto cuerpo (${i + 1})`}`
      }
    }
    for (let i = 0; i < def.totalButtonParams; i++) {
      if (!buttonParams[i]?.trim()) {
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
    const res = await apiClient.post(`/api/conversations/${conversationId}/send-template`, {
      templateSyncId: id,
      headerMediaUrl: headerMediaUrl.trim(),
      headerParams: headerParams.map((v) => v.trim()),
      bodyParams: bodyParams.map((v) => v.trim()),
      buttonParams: buttonParams.map((v) => v.trim()),
    })
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
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-line bg-bg px-2 py-1.5"
            >
              <option value="">Seleccionar…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.language})
                </option>
              ))}
            </select>
          </label>

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
                <label key={`h-${i}`} className="block text-sm">
                  {def.headerParamDefs[i]?.label || `Texto cabecera (${i + 1})`}
                  <input
                    type="text"
                    value={headerParams[i] || ''}
                    onChange={(e) => {
                      const next = [...headerParams]
                      next[i] = e.target.value
                      setHeaderParams(next)
                    }}
                    className="mt-1 w-full rounded-lg border border-line bg-bg px-2 py-1.5 text-sm"
                  />
                </label>
              ))
            : null}

          {def
            ? Array.from({ length: def.bodySlotCount }).map((_, i) => (
                <label key={`b-${i}`} className="block text-sm">
                  {def.bodyParamDefs[i]?.label || `Texto cuerpo (${i + 1})`}
                  <input
                    type="text"
                    value={bodyParams[i] || ''}
                    onChange={(e) => {
                      const next = [...bodyParams]
                      next[i] = e.target.value
                      setBodyParams(next)
                    }}
                    className="mt-1 w-full rounded-lg border border-line bg-bg px-2 py-1.5 text-sm"
                  />
                </label>
              ))
            : null}

          {def
            ? Array.from({ length: def.totalButtonParams }).map((_, i) => (
                <label key={`btn-${i}`} className="block text-sm">
                  {def.buttonParamDefs[i]?.label || `Botón URL (${i + 1})`}
                  <input
                    type="text"
                    value={buttonParams[i] || ''}
                    onChange={(e) => {
                      const next = [...buttonParams]
                      next[i] = e.target.value
                      setButtonParams(next)
                    }}
                    className="mt-1 w-full rounded-lg border border-line bg-bg px-2 py-1.5 text-sm"
                  />
                </label>
              ))
            : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose>Cancelar</DialogClose>
          <Button
            type="button"
            disabled={busy || !templateId || defLoading || !def}
            onClick={() => void handleSend()}
          >
            {busy ? 'Enviando…' : 'Enviar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
