import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/shared/ui/shadcn/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/shadcn/dialog'

const LIMA_OFFSET = '-05:00'

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

function defaultScheduleFields() {
  const today = limaDate()
  // Mañana (día actual + 1) a las 8:00 a. m. (Lima).
  const next = new Date(`${today}T12:00:00${LIMA_OFFSET}`)
  next.setUTCDate(next.getUTCDate() + 1)
  return { date: limaDate(next), time: '08:00' }
}

export function scheduledAtToIso(date: string, time: string): string {
  const iso = `${date}T${time.length === 5 ? `${time}:00` : time}${LIMA_OFFSET}`
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) throw new Error('Fecha inválida')
  return parsed.toISOString()
}

type InboxScheduleMessageDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  busy?: boolean
  onConfirm: (scheduledAtIso: string) => void | Promise<void>
}

export function InboxScheduleMessageDialog({
  open,
  onOpenChange,
  busy = false,
  onConfirm,
}: InboxScheduleMessageDialogProps) {
  const defaults = useMemo(() => defaultScheduleFields(), [open])
  const [date, setDate] = useState(defaults.date)
  const [time, setTime] = useState(defaults.time)

  useEffect(() => {
    if (!open) return
    const next = defaultScheduleFields()
    setDate(next.date)
    setTime(next.time)
  }, [open])

  async function submit() {
    const iso = scheduledAtToIso(date, time)
    await onConfirm(iso)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(96vw,420px)]">
        <DialogHeader className="flex items-center justify-between gap-3">
          <DialogTitle>Programar mensaje</DialogTitle>
          <DialogClose className="border-0 px-2">✕</DialogClose>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div>
            <p className="mb-2 text-xs text-muted">Fecha y hora</p>
            <div className="flex flex-wrap gap-4">
              <label className="min-w-[11rem] flex-1">
                <span className="sr-only">Fecha</span>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full border-0 border-b border-line bg-transparent px-0 py-2 text-sm text-ink outline-none focus:border-accent"
                />
              </label>
              <label className="w-28">
                <span className="sr-only">Hora</span>
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="w-full border-0 border-b border-line bg-transparent px-0 py-2 text-sm text-ink outline-none focus:border-accent"
                />
              </label>
            </div>
          </div>
          <div className="flex justify-end pt-2">
            <Button
              type="button"
              size="icon"
              className="inbox-compose-primary"
              disabled={busy || !date || !time}
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
