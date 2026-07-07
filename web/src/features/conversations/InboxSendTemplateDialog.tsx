import { useEffect, useState } from 'react'
import { apiClient } from '@/shared/api'
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

export function InboxSendTemplateDialog({
  open,
  onOpenChange,
  conversationId,
  onSent,
}: InboxSendTemplateDialogProps) {
  const [templates, setTemplates] = useState<TemplateItem[]>([])
  const [templateId, setTemplateId] = useState('')
  const [bodyParams, setBodyParams] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    void apiClient.get<TemplateItem[]>('/api/templates').then((res) => {
      if (res.ok) {
        setTemplates(res.data.filter((t) => t.status === 'APPROVED'))
      }
    })
  }, [open])

  async function handleSend() {
    const id = Number(templateId)
    if (!id) return
    setBusy(true)
    setError('')
    const params = bodyParams
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    const res = await apiClient.post(`/api/conversations/${conversationId}/send-template`, {
      templateSyncId: id,
      bodyParams: params,
    })
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    onSent()
    onOpenChange(false)
  }

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
          <label className="block text-sm">
            Parámetros del cuerpo (uno por línea)
            <textarea
              value={bodyParams}
              onChange={(e) => setBodyParams(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-lg border border-line bg-bg px-2 py-1.5 font-mono text-sm"
              placeholder="Opcional"
            />
          </label>
          {error ? <p className="text-sm text-bad">{error}</p> : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose>Cancelar</DialogClose>
          <Button type="button" disabled={busy || !templateId} onClick={() => void handleSend()}>
            {busy ? 'Enviando…' : 'Enviar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
