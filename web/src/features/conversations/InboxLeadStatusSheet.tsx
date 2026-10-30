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
}: InboxLeadStatusSheetProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(96vw,380px)]">
        <DialogHeader>
          <DialogTitle>Estado del lead</DialogTitle>
          <DialogDescription>
            {heading} · {chatSecondaryLabel(phone)}
            {currentStatusLabel ? ` · ${currentStatusLabel}` : ''}
          </DialogDescription>
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
