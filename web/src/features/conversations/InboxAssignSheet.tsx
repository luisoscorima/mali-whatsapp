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
import {
  InboxAssigneePicker,
  type ConversationAssignee,
} from './InboxAssigneePicker'

type InboxAssignSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  heading: string
  phone: string
  currentAssigneeId: number | null
  allowUnassign?: boolean
  assignees: ConversationAssignee[]
  loading: boolean
  busy: boolean
  onSelect: (assignedUserId: number | null) => void | Promise<boolean>
  onBack?: () => void
}

/** Overlay one-click para asignar desde lista / ⋮ (mejor que popover anclado en móvil). */
export function InboxAssignSheet({
  open,
  onOpenChange,
  heading,
  phone,
  currentAssigneeId,
  allowUnassign = true,
  assignees,
  loading,
  busy,
  onSelect,
  onBack,
}: InboxAssignSheetProps) {
  const titleBlock = (
    <>
      <DialogTitle>Asignar asesor</DialogTitle>
      <DialogDescription>
        {heading} · {chatSecondaryLabel(phone)}
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
          <InboxAssigneePicker
            assignees={assignees}
            currentAssigneeId={currentAssigneeId}
            allowUnassign={allowUnassign}
            loading={loading}
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
