import { useMemo, useState } from 'react'

export type ConversationAssignee = {
  id: number
  label: string
  email: string
}

type InboxAssigneePickerProps = {
  assignees: ConversationAssignee[]
  currentAssigneeId: number | null
  allowUnassign?: boolean
  loading?: boolean
  busy?: boolean
  onSelect: (assignedUserId: number | null) => void
}

export function InboxAssigneePicker({
  assignees,
  currentAssigneeId,
  allowUnassign = true,
  loading = false,
  busy = false,
  onSelect,
}: InboxAssigneePickerProps) {
  const [query, setQuery] = useState('')
  const showSearch = assignees.length > 8
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return assignees
    return assignees.filter(
      (a) =>
        a.label.toLowerCase().includes(q) || a.email.toLowerCase().includes(q),
    )
  }, [assignees, query])

  if (loading) {
    return <p className="text-sm text-muted p-2">Cargando asesores…</p>
  }

  return (
    <div className="inbox-oneclick-picker">
      {showSearch ? (
        <input
          type="search"
          className="inbox-oneclick-picker__search"
          placeholder="Buscar asesor…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
      ) : null}
      <div
        className="inbox-oneclick-picker__list"
        role="listbox"
        aria-label="Asesor asignado"
      >
        {allowUnassign ? (
          <button
            type="button"
            role="option"
            aria-selected={currentAssigneeId == null}
            disabled={busy}
            className={`inbox-oneclick-picker__option${currentAssigneeId == null ? ' is-active' : ''}`}
            onClick={() => onSelect(null)}
          >
            Sin asignar
          </button>
        ) : null}
        {filtered.map((assignee) => (
          <button
            key={assignee.id}
            type="button"
            role="option"
            aria-selected={currentAssigneeId === assignee.id}
            disabled={busy}
            className={`inbox-oneclick-picker__option${currentAssigneeId === assignee.id ? ' is-active' : ''}`}
            onClick={() => onSelect(assignee.id)}
          >
            <span className="inbox-oneclick-picker__option-label">
              {assignee.label}
            </span>
            <span className="muted inbox-oneclick-picker__option-meta">
              {assignee.email}
            </span>
          </button>
        ))}
        {filtered.length === 0 ? (
          <p className="text-sm text-muted p-2">Sin resultados</p>
        ) : null}
      </div>
    </div>
  )
}
