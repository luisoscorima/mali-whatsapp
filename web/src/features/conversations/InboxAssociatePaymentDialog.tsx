import { useEffect, useState } from 'react'
import { apiClient } from '@/shared/api'
import { notify } from '@/shared/notify'
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

type SettlementKind =
  | 'positive'
  | 'authorized'
  | 'in_progress'
  | 'negative'
  | 'unknown'

type PaymentHit = {
  provider: string
  providerPaymentId: string
  transactionCode: string
  amount: number
  currency: string
  status: string
  settlementKind?: SettlementKind
  customerName: string | null
  customerEmail: string | null
  transactedAt: string | null
}

function settlementKindOf(hit: PaymentHit): SettlementKind {
  if (hit.settlementKind) return hit.settlementKind
  const key = hit.status
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
  if (['liquidada', 'pagado', 'paid', 'approved', 'success', 'successful', 'completed'].includes(key)) {
    return 'positive'
  }
  // Alineado a ONE: Autorizada cierra ciclo + obs; Por pagar no cierra.
  if (['autorizada', 'authorized', 'processing'].includes(key)) {
    return 'authorized'
  }
  if (['por_pagar', 'pending', 'in_process', 'mediation'].includes(key)) {
    return 'in_progress'
  }
  if (
    [
      'anulada',
      'denegada',
      'expirado',
      'expired',
      'rejected',
      'cancelled',
      'canceled',
      'refunded',
      'failed',
      'denied',
    ].includes(key)
  ) {
    return 'negative'
  }
  return 'unknown'
}

type InboxAssociatePaymentDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  cycleId: number
  contactId: number
  contactLabel?: string
  onAssociated?: () => void
}

const PROVIDERS = [
  { id: 'all', label: 'Todas las fuentes' },
  { id: 'niubiz', label: 'Niubiz' },
  { id: 'paycash', label: 'PagoEfectivo' },
  { id: 'mercadopago', label: 'Mercado Pago' },
] as const

function providerLabel(id: string) {
  return PROVIDERS.find((p) => p.id === id)?.label ?? id
}

function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat('es-PE', {
      style: 'currency',
      currency: currency || 'PEN',
    }).format(amount)
  } catch {
    return `${amount} ${currency}`
  }
}

/** Misma lógica visual que TreasuryStatusBadge en MALI ONE. */
function treasuryStatusClass(status: string): string {
  const key = status
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
  if (key === 'liquidada' || key === 'pagado') {
    return 'border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
  }
  if (key === 'autorizada') {
    return 'border-sky-500/30 bg-sky-500/15 text-sky-700 dark:text-sky-300'
  }
  if (key === 'por pagar') {
    return 'border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-300'
  }
  if (key === 'anulada' || key === 'denegada' || key === 'expirado') {
    return 'border-red-500/30 bg-red-500/15 text-red-700 dark:text-red-300'
  }
  return 'border-line bg-surface-strong text-muted'
}

function TreasuryStatusChip({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium ${treasuryStatusClass(status)}`}
    >
      {status}
    </span>
  )
}

/** Modal asesor: buscar cobro y asociarlo al ciclo actual. */
export function InboxAssociatePaymentDialog({
  open,
  onOpenChange,
  cycleId,
  onAssociated,
  contactId,
  contactLabel,
}: InboxAssociatePaymentDialogProps) {
  const [provider, setProvider] = useState<string>('all')
  const [code, setCode] = useState('')
  const [hits, setHits] = useState<PaymentHit[]>([])
  const [selectedCode, setSelectedCode] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) {
      setCode('')
      setHits([])
      setSelectedCode(null)
      setProvider('all')
      setBusy(false)
    }
  }, [open])

  async function lookup() {
    const q = code.trim()
    if (q.length < 4) {
      notify.error('Escribe al menos 4 caracteres del código')
      return
    }
    setBusy(true)
    setSelectedCode(null)
    try {
      const qs = new URLSearchParams({ code: q })
      if (provider !== 'all') qs.set('provider', provider)
      const res = await apiClient.get<{ hits?: PaymentHit[] }>(
        `/api/leads/payments/lookup?${qs}`,
      )
      if (!res.ok) {
        notify.error(res.error || 'No se pudo buscar el pago')
        setHits([])
        return
      }
      const list = Array.isArray(res.data?.hits) ? res.data.hits : []
      setHits(list)
      if (!list.length) notify.error('Sin coincidencias')
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Error al buscar')
      setHits([])
    } finally {
      setBusy(false)
    }
  }

  async function associate() {
    const transactionCode = selectedCode || code.trim()
    if (!transactionCode) {
      notify.error('Elige una coincidencia o escribe el código')
      return
    }
    setBusy(true)
    try {
      const res = await apiClient.post('/api/leads/payments/associate', {
        waCycleId: cycleId,
        waContactId: contactId,
        transactionCode,
      })
      if (!res.ok) {
        notify.error(res.error || 'No se pudo asociar el pago')
        return
      }
      const closesCycle = Boolean(
        (res.data as { closesCycle?: boolean } | undefined)?.closesCycle,
      )
      const kind = (res.data as { settlementKind?: SettlementKind } | undefined)
        ?.settlementKind
      notify.success(
        closesCycle
          ? kind === 'authorized'
            ? 'Pago autorizado asociado. Ciclo cerrado (queda observación en caja).'
            : 'Pago asociado. Ciclo cerrado.'
          : 'Pago asociado (pendiente de confirmación). El ciclo sigue abierto.',
      )
      onOpenChange(false)
      onAssociated?.()
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'No se pudo asociar')
    } finally {
      setBusy(false)
    }
  }

  const selectedHit = hits.find((h) => h.transactionCode === selectedCode)
  const selectedKind = selectedHit ? settlementKindOf(selectedHit) : null
  const selectedBlocked = selectedKind === 'negative'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(96vw,480px)]">
        <DialogHeader>
          <DialogTitle>Asociar pago</DialogTitle>
          <DialogDescription>
            Busca el código de pago sin salir del chat
            {contactLabel ? ` · ${contactLabel}` : ''}. Ciclo #{cycleId}.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <label className="block space-y-1 text-sm">
            <span className="font-medium">Fuente</span>
            <select
              className="w-full rounded-lg border border-line bg-bg px-3 py-2"
              value={provider}
              disabled={busy}
              onChange={(e) => setProvider(e.target.value)}
            >
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium">Código / pedido / CIP</span>
            <input
              className="w-full rounded-lg border border-line bg-bg px-3 py-2"
              value={code}
              disabled={busy}
              placeholder="Primeros dígitos o código completo"
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void lookup()
                }
              }}
            />
          </label>
          <button
            type="button"
            disabled={busy || code.trim().length < 4}
            className="rounded-lg border border-line bg-surface-strong px-3 py-1.5 text-sm disabled:opacity-60"
            onClick={() => void lookup()}
          >
            {busy ? 'Buscando…' : 'Buscar'}
          </button>
          {hits.length > 0 ? (
            <ul className="max-h-56 space-y-2 overflow-y-auto">
              {hits.map((hit) => {
                const active = selectedCode === hit.transactionCode
                const kind = settlementKindOf(hit)
                const blocked = kind === 'negative'
                return (
                  <li key={`${hit.provider}-${hit.providerPaymentId}`}>
                    <button
                      type="button"
                      disabled={busy || blocked}
                      onClick={() => {
                        if (blocked) return
                        setSelectedCode(hit.transactionCode)
                        setCode(hit.transactionCode)
                      }}
                      className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                        blocked
                          ? 'cursor-not-allowed border-line bg-bg opacity-60'
                          : active
                            ? 'border-accent bg-accent/10'
                            : 'border-line bg-bg hover:bg-surface-strong'
                      }`}
                    >
                      <span className="flex flex-wrap items-center gap-2 font-medium">
                        <span>
                          {providerLabel(hit.provider)} · {hit.transactionCode}
                        </span>
                        <TreasuryStatusChip status={hit.status} />
                      </span>
                      <span className="muted mt-0.5 block">
                        {formatMoney(hit.amount, hit.currency)}
                        {hit.customerName ? ` · ${hit.customerName}` : ''}
                        {hit.customerEmail ? ` · ${hit.customerEmail}` : ''}
                        {blocked
                          ? ' · No asociable (denegado/anulado)'
                          : kind === 'authorized'
                            ? ' · Se asociará y cerrará el ciclo (obs. en caja)'
                            : kind === 'in_progress' || kind === 'unknown'
                              ? ' · Se asociará sin cerrar el ciclo'
                              : ''}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : null}
          {selectedKind === 'authorized' ? (
            <p className="muted text-sm">
              Cobro autorizado: se asociará, cerrará el ciclo y dejará
              observación en caja.
            </p>
          ) : null}
          {selectedKind === 'in_progress' || selectedKind === 'unknown' ? (
            <p className="muted text-sm">
              Este cobro aún no está confirmado: se asociará con observación y el
              ciclo permanecerá abierto hasta confirmación.
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose disabled={busy}>Cancelar</DialogClose>
          <button
            type="button"
            disabled={
              busy ||
              selectedBlocked ||
              (!selectedCode && code.trim().length < 4)
            }
            className="rounded-lg bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-60"
            onClick={() => void associate()}
          >
            {busy ? 'Asociando…' : 'Asociar a esta oportunidad'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
