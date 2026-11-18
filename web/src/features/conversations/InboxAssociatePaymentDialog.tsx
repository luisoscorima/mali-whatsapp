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

type PaymentHit = {
  provider: string
  providerPaymentId: string
  transactionCode: string
  amount: number
  currency: string
  status: string
  customerName: string | null
  customerEmail: string | null
  transactedAt: string | null
}

type InboxAssociatePaymentDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  cycleId: number
  contactId: number
  contactLabel?: string
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

/** Modal asesor: buscar cobro en Treasury (vía ONE) y asociarlo al ciclo actual. */
export function InboxAssociatePaymentDialog({
  open,
  onOpenChange,
  cycleId,
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
      if (!list.length) notify.error('Sin coincidencias en Treasury')
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
      notify.success('Pago asociado a esta oportunidad')
      onOpenChange(false)
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'No se pudo asociar')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(96vw,480px)]">
        <DialogHeader>
          <DialogTitle>Asociar pago</DialogTitle>
          <DialogDescription>
            Busca en Treasury sin salir del chat
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
                return (
                  <li key={`${hit.provider}-${hit.providerPaymentId}`}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setSelectedCode(hit.transactionCode)
                        setCode(hit.transactionCode)
                      }}
                      className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                        active
                          ? 'border-accent bg-accent/10'
                          : 'border-line bg-bg hover:bg-surface-strong'
                      }`}
                    >
                      <span className="font-medium">
                        {providerLabel(hit.provider)} · {hit.transactionCode}
                      </span>
                      <br />
                      <span className="muted">
                        {formatMoney(hit.amount, hit.currency)} · {hit.status}
                        {hit.customerName ? ` · ${hit.customerName}` : ''}
                        {hit.customerEmail ? ` · ${hit.customerEmail}` : ''}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose disabled={busy}>Cancelar</DialogClose>
          <button
            type="button"
            disabled={busy || (!selectedCode && code.trim().length < 4)}
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
