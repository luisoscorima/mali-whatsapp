import { useState } from 'react'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/shadcn/dialog'
import { cn } from '@/lib/utils'

export type ConfirmDialogOptions = {
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  /** Botón de confirmación en rojo (eliminaciones, etc.). */
  tone?: 'default' | 'danger'
}

type PendingConfirm = ConfirmDialogOptions & {
  resolve: (value: boolean) => void
}

/**
 * Reemplazo de `window.confirm` con Dialog shadcn.
 *
 * ```tsx
 * const { confirm, confirmDialog } = useConfirmDialog()
 * if (!(await confirm({ title: '…', description: '…' }))) return
 * // …
 * return <>…{confirmDialog}</>
 * ```
 */
export function useConfirmDialog() {
  const [pending, setPending] = useState<PendingConfirm | null>(null)

  function confirm(options: ConfirmDialogOptions): Promise<boolean> {
    return new Promise((resolve) => {
      setPending({ ...options, resolve })
    })
  }

  function settle(value: boolean) {
    pending?.resolve(value)
    setPending(null)
  }

  const confirmDialog = (
    <Dialog
      open={pending != null}
      onOpenChange={(open) => {
        if (!open) settle(false)
      }}
    >
      <DialogContent className="w-[min(96vw,420px)]">
        <DialogHeader>
          <DialogTitle>{pending?.title}</DialogTitle>
          <DialogDescription className="whitespace-pre-line">
            {pending?.description}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose>{pending?.cancelLabel || 'Cancelar'}</DialogClose>
          <button
            type="button"
            className={cn(
              'rounded-lg px-3 py-1.5 text-sm text-white',
              pending?.tone === 'danger'
                ? 'bg-bad hover:opacity-90'
                : 'bg-accent hover:opacity-90',
            )}
            onClick={() => settle(true)}
          >
            {pending?.confirmLabel || 'Confirmar'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  return { confirm, confirmDialog }
}
