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
  onSelect,
  onBack,
}: InboxLeadStatusSheetProps) {
  const titleBlock = (
    <>
      <DialogTitle>Estado del lead</DialogTitle>
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
