import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiClient } from '@/shared/api'
import { notify } from '@/shared/notify'
import { withCategoryQuery } from '@/shared/area/useCategoryScope'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/shadcn/dialog'

export type OpenChatLine = {
  id: number
  label: string
  phone: string | null
  category: string
  category_label: string
}

function lineCaption(line: OpenChatLine): string {
  const parts = [line.category_label, line.label]
  if (line.phone) parts.push(line.phone)
  return parts.join(' · ')
}

type OpenChatNavigate = (conversationId: number) => void

type UseOpenContactChatOptions = {
  /** Query de categorías del riel (`category=…`), vacío = todas las autorizadas. */
  categoryQuery?: string
}

type OpenContactChatOptions = {
  navigateTo?: OpenChatNavigate
  onCancel?: () => void
  /** Sobrescribe el filtro de categorías del hook ('' = todas las autorizadas). */
  categoryQuery?: string
  /** Línea del chat actual; se marca en el picker y evita reabrir la misma. */
  currentLineId?: number | null
  title?: string
  description?: string
}

/**
 * Abre o crea el chat de un contacto eligiendo línea cuando hay varias.
 * Las líneas vienen de `/open-lines` (solo activas y autorizadas al usuario).
 */
export function useOpenContactChat(options: UseOpenContactChatOptions = {}) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [picker, setPicker] = useState<{
    contactId: number
    lines: OpenChatLine[]
    currentLineId: number | null
    title: string
    description: string
  } | null>(null)
  const pendingNav = useRef<OpenChatNavigate | null>(null)
  const pendingCancel = useRef<(() => void) | null>(null)

  async function ensureConversation(
    contactId: number,
    whatsappLineId: number,
  ): Promise<number | null> {
    const res = await apiClient.post<{ id: number }>(
      `/api/conversations/from-contact/${contactId}`,
      { whatsappLineId },
    )
    if (!res.ok) {
      notify.error(res.error)
      return null
    }
    return res.data.id
  }

  function go(conversationId: number) {
    const custom = pendingNav.current
    clearPending()
    if (custom) custom(conversationId)
    else navigate(`/conversations/${conversationId}`)
  }

  function clearPending() {
    pendingNav.current = null
    pendingCancel.current = null
  }

  /**
   * @returns `'opened'` | `'picking'` | `'failed'` | `'same'`
   */
  async function openContactChat(
    contactId: number,
    openOpts?: OpenContactChatOptions | OpenChatNavigate,
  ): Promise<'opened' | 'picking' | 'failed' | 'same'> {
    if (!contactId || busy) return 'failed'
    const opts: OpenContactChatOptions =
      typeof openOpts === 'function' ? { navigateTo: openOpts } : openOpts ?? {}
    pendingNav.current = opts.navigateTo ?? null
    pendingCancel.current = opts.onCancel ?? null
    const currentLineId = opts.currentLineId ?? null
    const title = opts.title ?? 'Elegir línea'
    const description =
      opts.description ?? 'Desde qué número de WhatsApp quieres escribirle.'
    setBusy(true)
    const categoryQuery =
      opts.categoryQuery !== undefined
        ? opts.categoryQuery
        : options.categoryQuery || ''
    const linesUrl = withCategoryQuery(
      '/api/conversations/open-lines',
      categoryQuery,
    )
    const linesRes = await apiClient.get<OpenChatLine[]>(linesUrl)
    if (!linesRes.ok) {
      setBusy(false)
      clearPending()
      notify.error(linesRes.error)
      return 'failed'
    }
    const lines = linesRes.data
    if (!lines.length) {
      setBusy(false)
      clearPending()
      notify.error('No hay una línea activa autorizada para escribir')
      return 'failed'
    }
    if (lines.length === 1) {
      if (currentLineId != null && lines[0].id === currentLineId) {
        setBusy(false)
        clearPending()
        return 'same'
      }
      const id = await ensureConversation(contactId, lines[0].id)
      setBusy(false)
      if (id == null) {
        clearPending()
        return 'failed'
      }
      go(id)
      return 'opened'
    }
    setBusy(false)
    setPicker({ contactId, lines, currentLineId, title, description })
    return 'picking'
  }

  async function chooseLine(lineId: number) {
    if (!picker || busy) return
    if (picker.currentLineId != null && lineId === picker.currentLineId) {
      pendingCancel.current = null
      setPicker(null)
      clearPending()
      return
    }
    setBusy(true)
    const { contactId } = picker
    const id = await ensureConversation(contactId, lineId)
    setBusy(false)
    if (id == null) return
    // Evitar que el cierre del diálogo dispare onCancel.
    pendingCancel.current = null
    setPicker(null)
    go(id)
  }

  const linePickerDialog = (
    <Dialog
      open={picker != null}
      onOpenChange={(open) => {
        if (!open) {
          setPicker(null)
          const cancel = pendingCancel.current
          clearPending()
          cancel?.()
        }
      }}
    >
      <DialogContent className="w-[min(96vw,420px)]">
        <DialogHeader>
          <DialogTitle>{picker?.title ?? 'Elegir línea'}</DialogTitle>
          <DialogDescription>
            {picker?.description ??
              'Desde qué número de WhatsApp quieres escribirle.'}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <ul className="space-y-1.5">
            {picker?.lines.map((line) => {
              const isCurrent =
                picker.currentLineId != null && line.id === picker.currentLineId
              return (
                <li key={line.id}>
                  <button
                    type="button"
                    disabled={busy}
                    aria-current={isCurrent ? 'true' : undefined}
                    className={`w-full rounded-lg border border-line bg-surface px-3 py-2 text-left text-sm hover:bg-accent-soft disabled:opacity-60${
                      isCurrent ? ' is-active border-accent' : ''
                    }`}
                    onClick={() => void chooseLine(line.id)}
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span>{lineCaption(line)}</span>
                      {isCurrent ? (
                        <span className="muted shrink-0 text-xs">Actual</span>
                      ) : null}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </DialogBody>
        <DialogFooter>
          <DialogClose>Cancelar</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  return { openContactChat, linePickerDialog, busy, pickerOpen: picker != null }
}
