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
import { WaBackButton, WaBackHeading } from '@/shared/ui/shell/WaBackLink'
import { chatSecondaryLabel } from './whatsappIdentity'
import { InboxLeadStatusPicker } from './InboxLeadStatusPicker'

type InboxLeadStatusSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  heading: string
  phone: string
  currentStatusId: number | null
  currentStatusLabel?: string | null
  busy?: boolean
  needsStartAttention?: boolean
  needsAssociatePayment?: boolean
  closedStatusLabel?: string | null
  onStartAttention?: () => void | Promise<boolean>
  onAssociatePayment?: () => void
  onCloseWithoutPayment?: (input: {
    reason: string
    note?: string
  }) => void | Promise<boolean>
  onSelect: (statusId: number) => void | Promise<boolean>
  onBack?: () => void
}

/** Overlay one-click para estado del lead desde lista / ⋮. */
export function InboxLeadStatusSheet({
  open,
  onOpenChange,
  heading,
  phone,
  currentStatusId,
  currentStatusLabel,
  busy = false,
  needsStartAttention = false,
  needsAssociatePayment = false,
  closedStatusLabel = null,
  onStartAttention,
  onAssociatePayment,
  onCloseWithoutPayment,
  onSelect,
  onBack,
}: InboxLeadStatusSheetProps) {
  const titleBlock = (
    <>
      <DialogTitle>
        {needsStartAttention
          ? 'Iniciar ciclo'
          : needsAssociatePayment
            ? 'Venta · pago'
            : 'Estado del lead'}
      </DialogTitle>
      <DialogDescription>
        {heading} · {chatSecondaryLabel(phone)}
        {currentStatusLabel ? ` · ${currentStatusLabel}` : ''}
      </DialogDescription>
    </>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(96vw,380px)]">
        <DialogHeader>
          {onBack ? (
            <WaBackHeading
              back={<WaBackButton onClick={onBack} label="Atrás" />}
            >
              {titleBlock}
            </WaBackHeading>
          ) : (
            titleBlock
          )}
        </DialogHeader>
        <DialogBody className="p-0">
          <InboxLeadStatusPicker
            currentStatusId={currentStatusId}
            busy={busy}
            needsStartAttention={needsStartAttention}
            needsAssociatePayment={needsAssociatePayment}
            closedStatusLabel={closedStatusLabel}
            onStartAttention={
              onStartAttention
                ? () =>
                    void Promise.resolve(onStartAttention()).then((ok) => {
                      if (ok !== false) onOpenChange(false)
                    })
                : undefined
            }
            onAssociatePayment={
              onAssociatePayment
                ? () => {
                    onOpenChange(false)
                    onAssociatePayment()
                  }
                : undefined
            }
            onCloseWithoutPayment={
              onCloseWithoutPayment
                ? (input) =>
                    void Promise.resolve(onCloseWithoutPayment(input)).then(
                      (ok) => {
                        if (ok !== false) onOpenChange(false)
                      },
                    )
                : undefined
            }
            onSelect={(id) => {
              void Promise.resolve(onSelect(id)).then((ok) => {
                if (ok !== false) onOpenChange(false)
              })
            }}
          />
        </DialogBody>
        <DialogFooter>
          <DialogClose disabled={busy}>Cerrar</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
