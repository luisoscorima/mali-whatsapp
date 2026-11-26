import { useId, useState } from 'react'
import { Button } from '@/shared/ui/shadcn/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/shadcn/dialog'

const LIMA_OFFSET = '-05:00'
const MINUTE_MS = 60_000

/** Fecha local de Lima a partir de un instante. */
function limaDate(from = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(from)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

function limaTime(from: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Lima',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(from)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('hour')}:${get('minute')}`
}

function fieldsFromInstant(at: Date) {
  return { date: limaDate(at), time: limaTime(at) }
}

function scheduleBounds(endsAt: number, now: number) {
  return {
    earliest: Math.ceil((now + MINUTE_MS) / MINUTE_MS) * MINUTE_MS,
    latest: Math.floor((endsAt - 1) / MINUTE_MS) * MINUTE_MS,
  }
}

function defaultScheduleFields(endsAt: number, now: number) {
  const { earliest, latest } = scheduleBounds(endsAt, now)
  if (!Number.isFinite(latest) || earliest > latest) return { date: '', time: '' }
  const today = limaDate(new Date(now))
  const next = new Date(`${today}T12:00:00${LIMA_OFFSET}`)
  next.setUTCDate(next.getUTCDate() + 1)
  const preferred = new Date(`${limaDate(next)}T08:00:00${LIMA_OFFSET}`)
  const at = Math.max(earliest, Math.min(preferred.getTime(), latest - MINUTE_MS))
  return fieldsFromInstant(new Date(at))
}

export function scheduledAtToIso(date: string, time: string): string {
  const iso = `${date}T${time.length === 5 ? `${time}:00` : time}${LIMA_OFFSET}`
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) throw new Error('Fecha inválida')
  return parsed.toISOString()
}

type InboxScheduleMessageDialogProps = {
  onOpenChange: (open: boolean) => void
  busy?: boolean
  serviceWindowEndsAt: string | null
  restoreFocus: () => void
  onConfirm: (scheduledAtIso: string) => void | Promise<void>
}

export function InboxScheduleMessageDialog({
  onOpenChange,
  busy = false,
  serviceWindowEndsAt,
  restoreFocus,
  onConfirm,
}: InboxScheduleMessageDialogProps) {
  const endsAt = serviceWindowEndsAt ? Date.parse(serviceWindowEndsAt) : NaN
  const [fields, setFields] = useState(() => defaultScheduleFields(endsAt, Date.now()))
  const { date, time } = fields
  const [error, setError] = useState('')
  const errorId = useId()
  const { earliest, latest } = scheduleBounds(endsAt, Date.now())
  const hasSlot = Number.isFinite(latest) && earliest <= latest
  const message = error || (!hasSlot ? 'Ya no queda un horario disponible en la ventana de atención.' : '')

  async function submit() {
    setError('')
    let iso: string
    try {
      iso = scheduledAtToIso(date, time)
    } catch {
      setError('Fecha u hora inválida')
      return
    }
    const at = new Date(iso).getTime()
    if (at < Date.now() + MINUTE_MS) {
      setError('Elige una hora al menos 1 minuto en el futuro')
      return
    }
    if (!Number.isFinite(endsAt) || at >= endsAt) {
      setError('Esa hora queda fuera de la ventana de atención')
      return
    }
    await onConfirm(iso)
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[min(96vw,420px)]"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          restoreFocus()
        }}
      >
        <DialogHeader className="flex items-center justify-between gap-3">
          <DialogTitle>Programar mensaje</DialogTitle>
          <DialogClose className="border-0 px-2" aria-label="Cerrar">✕</DialogClose>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div>
            <DialogDescription className="mb-2 text-xs">Fecha y hora de Lima</DialogDescription>
            <div className="flex flex-wrap gap-4">
              <label className="min-w-[11rem] flex-1">
                <span className="sr-only">Fecha</span>
                <input
                  type="date"
                  value={date}
                  min={hasSlot ? limaDate(new Date(earliest)) : undefined}
                  max={hasSlot ? limaDate(new Date(latest)) : undefined}
                  disabled={busy || !hasSlot}
                  aria-invalid={Boolean(error)}
                  aria-describedby={message ? errorId : undefined}
                  onChange={(e) => {
                    setFields({ ...fields, date: e.target.value })
                    setError('')
                  }}
                  className="w-full border-0 border-b border-line bg-transparent px-0 py-2 text-sm text-ink outline-none focus:border-accent"
                />
              </label>
              <label className="w-28">
                <span className="sr-only">Hora</span>
                <input
                  type="time"
                  value={time}
                  disabled={busy || !hasSlot}
                  aria-invalid={Boolean(error)}
                  aria-describedby={message ? errorId : undefined}
                  onChange={(e) => {
                    setFields({ ...fields, time: e.target.value })
                    setError('')
                  }}
                  className="w-full border-0 border-b border-line bg-transparent px-0 py-2 text-sm text-ink outline-none focus:border-accent"
                />
              </label>
            </div>
            {message ? <p id={errorId} role="alert" className="mt-2 text-xs text-bad">{message}</p> : null}
          </div>
          <div className="flex justify-end pt-2">
            <Button
              type="button"
              size="icon"
              className="inbox-compose-primary"
              disabled={busy || !hasSlot || !date || !time}
              aria-label="Programar envío"
              title="Programar envío"
              onClick={() => void submit()}
            >
              {busy ? '…' : (
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M21 3l-6.5 18-3.6-7.9L3 9.5 21 3ZM10.9 13.1 21 3" />
                </svg>
              )}
            </Button>
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
