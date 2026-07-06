import { useEffect, useState } from 'react'
import { Button } from '@/shared/ui/shadcn/button'
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

export type ConversationAssignee = {
  id: number
  label: string
  email: string
}

type InboxAssignDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  heading: string
  phone: string
  currentAssigneeId: number | null
  assignees: ConversationAssignee[]
  loading: boolean
  saving: boolean
  error: string
  onSave: (assignedUserId: number | null) => void
}

export function InboxAssignDialog({
  open,
  onOpenChange,
  heading,
  phone,
  currentAssigneeId,
  assignees,
  loading,
  saving,
  error,
  onSave,
}: InboxAssignDialogProps) {
  const [selectedId, setSelectedId] = useState<number | null>(currentAssigneeId)

  useEffect(() => {
    if (open) setSelectedId(currentAssigneeId)
  }, [open, currentAssigneeId])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(96vw,420px)]">
        <DialogHeader>
          <DialogTitle>Asignar chat</DialogTitle>
          <DialogDescription>
            {heading} · {phone}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          {loading ? (
            <p className="text-sm text-muted">Cargando asesores…</p>
          ) : (
            <div className="flex flex-col gap-1" role="radiogroup" aria-label="Asesor">
              <label className="inbox-assign-option">
                <input
                  type="radio"
                  name="assignee"
                  checked={selectedId == null}
                  onChange={() => setSelectedId(null)}
                />
                <span>Sin asignar</span>
              </label>
              {assignees.map((assignee) => (
                <label key={assignee.id} className="inbox-assign-option">
                  <input
                    type="radio"
                    name="assignee"
                    checked={selectedId === assignee.id}
                    onChange={() => setSelectedId(assignee.id)}
                  />
                  <span>
                    {assignee.label}
                    <span className="muted"> · {assignee.email}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
          {error ? <p className="text-sm text-bad">{error}</p> : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose disabled={saving}>Cancelar</DialogClose>
          <Button
            type="button"
            disabled={loading || saving}
            onClick={() => onSave(selectedId)}
          >
            {saving ? 'Guardando…' : 'Guardar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
