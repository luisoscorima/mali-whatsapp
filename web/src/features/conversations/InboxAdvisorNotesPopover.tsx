import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { insertAtSelection } from '@/shared/textSelection'
import { apiClient } from '../../shared/api'
import { notify } from '@/shared/notify'
import { categoryLabel, useCategoryScope } from '@/shared/area/useCategoryScope'
import { Button } from '@/shared/ui/shadcn/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/ui/shadcn/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/shadcn/popover'
import { useConfirmDialog } from '@/shared/ui/ConfirmDialog'
import {
  CONTACT_DNI_KEY,
  CONTACT_EMAIL_KEY,
  CONTACT_NAME_KEY,
  CONTACT_PHONE_KEY,
  type AdvisorNote,
} from './advisorNotes'

type AttrDef = { slug: string; label: string; category?: string }

type FixedVariable = {
  key: string
  label: string
  group: string
}

type InboxAdvisorNotesPopoverProps = {
  onInsert: (text: string) => void
  resolveText: (text: string) => string
  notes: AdvisorNote[]
  loading: boolean
  loadNotes: () => Promise<void>
  triggerIcon?: ReactNode
}

export function InboxAdvisorNotesPopover({
  onInsert,
  resolveText,
  notes,
  loading,
  loadNotes,
  triggerIcon,
}: InboxAdvisorNotesPopoverProps) {
  const categoryScope = useCategoryScope()
  const { confirm, confirmDialog } = useConfirmDialog()
  const [open, setOpen] = useState(false)
  const [attrDefs, setAttrDefs] = useState<AttrDef[]>([])
  const [editingId, setEditingId] = useState<number | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [varQuery, setVarQuery] = useState('')
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  const fixedVariables: FixedVariable[] = useMemo(
    () => [
      { key: CONTACT_NAME_KEY, label: 'Nombre del contacto', group: 'Contacto' },
      {
        key: CONTACT_PHONE_KEY,
        label: 'Teléfono del contacto',
        group: 'Contacto',
      },
      { key: CONTACT_EMAIL_KEY, label: 'Email del contacto', group: 'Contacto' },
      { key: CONTACT_DNI_KEY, label: 'DNI del contacto', group: 'Contacto' },
    ],
    [],
  )

  const showAttrCategory = useMemo(() => {
    return new Set(attrDefs.map((a) => a.category || 'general')).size > 1
  }, [attrDefs])

  const filteredFixed = useMemo(() => {
    const q = varQuery.trim().toLowerCase()
    if (!q) return fixedVariables
    return fixedVariables.filter(
      (v) =>
        v.label.toLowerCase().includes(q) ||
        v.key.toLowerCase().includes(q) ||
        v.group.toLowerCase().includes(q),
    )
  }, [fixedVariables, varQuery])

  const filteredAttrs = useMemo(() => {
    const q = varQuery.trim().toLowerCase()
    const list = !q
      ? attrDefs
      : attrDefs.filter(
          (a) =>
            a.label.toLowerCase().includes(q) ||
            a.slug.toLowerCase().includes(q) ||
            Boolean(a.category?.toLowerCase().includes(q)),
        )
    return [...list].sort((a, b) => {
      const ga = categoryLabel(a.category, categoryScope.options)
      const gb = categoryLabel(b.category, categoryScope.options)
      return ga.localeCompare(gb) || a.label.localeCompare(b.label)
    })
  }, [attrDefs, varQuery, categoryScope.options])

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    void loadNotes()
    void apiClient.get<AttrDef[]>('/api/attribute-definitions', { signal: controller.signal })
      .then((result) => {
        if (result.ok && !controller.signal.aborted) setAttrDefs(result.data)
      })
      .catch(() => {})
    return () => controller.abort()
  }, [open, loadNotes])

  function resetForm() {
    setEditingId(null)
    setTitle('')
    setBody('')
  }

  async function saveNote() {
    const t = title.trim()
    const b = body.trim()
    if (!t || !b) {
      notify.error('Título y texto son obligatorios')
      return
    }
    setSaving(true)
    const result = editingId
      ? await apiClient.patch<AdvisorNote>(`/api/advisor-notes/${editingId}`, {
          title: t,
          body: b,
        })
      : await apiClient.post<AdvisorNote>('/api/advisor-notes', {
          title: t,
          body: b,
        })
    setSaving(false)
    if (!result.ok) {
      notify.error(result.error)
      return
    }
    resetForm()
    await loadNotes()
  }

  async function removeNote(id: number) {
    if (
      !(await confirm({
        title: 'Eliminar nota',
        description: '¿Eliminar esta nota?',
        confirmLabel: 'Eliminar',
        tone: 'danger',
      }))
    ) {
      return
    }
    const result = await apiClient.delete<{ deleted: true }>(
      `/api/advisor-notes/${id}`,
    )
    if (!result.ok) {
      notify.error(result.error)
      return
    }
    if (editingId === id) resetForm()
    await loadNotes()
  }

  function startEdit(note: AdvisorNote) {
    setEditingId(note.id)
    setTitle(note.title)
    setBody(note.body)
  }

  function insertVariable(key: string) {
    insertAtSelection(bodyRef.current, `{{${key}}}`, body, setBody)
  }

  function insertNoteIntoComposer(noteBody: string) {
    onInsert(resolveText(noteBody))
    setOpen(false)
  }

  return (
    <>
      {confirmDialog}
      <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="inbox-compose-notes-btn h-8 shrink-0 gap-1.5 px-2.5"
          title="Mis notas"
          aria-label="Mis notas"
        >
          {triggerIcon ?? <span aria-hidden>N</span>}
          <span className="inbox-compose-notes-btn__label">Notas</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-3">
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium">Mis notas</p>
            <p className="text-xs text-muted">
              Privadas para ti. Clic para pegar en el mensaje.
            </p>
          </div>

          {loading ? (
            <p className="text-xs text-muted">Cargando…</p>
          ) : notes.length === 0 && !editingId ? (
            <p className="text-xs text-muted">Aún no tienes notas.</p>
          ) : (
            <ul className="max-h-48 space-y-1.5 overflow-y-auto">
              {notes.map((note) => (
                <li
                  key={note.id}
                  className="rounded-lg border border-line bg-surface px-2 py-1.5"
                >
                  <button
                    type="button"
                    className="w-full text-left"
                    onClick={() => insertNoteIntoComposer(note.body)}
                  >
                    <span className="block text-sm font-medium">{note.title}</span>
                    <span className="mt-0.5 line-clamp-2 block text-xs text-muted">
                      {note.body}
                    </span>
                  </button>
                  <div className="mt-1 flex gap-1">
                    <button
                      type="button"
                      className="rounded p-0.5 text-muted hover:text-ink"
                      title="Editar"
                      aria-label="Editar"
                      onClick={() => startEdit(note)}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden
                      >
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="rounded p-0.5 text-bad"
                      title="Eliminar"
                      aria-label="Eliminar"
                      onClick={() => void removeNote(note.id)}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden
                      >
                        <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5" />
                      </svg>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="space-y-2 border-t border-line pt-2">
            <p className="text-xs font-medium">
              {editingId ? 'Editar nota' : 'Nueva nota'}
            </p>
            <input
              className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
              placeholder="Título"
              value={title}
              maxLength={120}
              onChange={(e) => setTitle(e.target.value)}
            />
            <textarea
              ref={bodyRef}
              className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
              placeholder="Texto a insertar… Usa {{variable}} si hace falta."
              rows={3}
              value={body}
              maxLength={4000}
              onChange={(e) => setBody(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <DropdownMenu
                onOpenChange={(next) => {
                  if (!next) setVarQuery('')
                }}
              >
                <DropdownMenuTrigger asChild>
                  <Button type="button" size="sm" variant="outline">
                    Variable
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="max-h-64 w-64 overflow-y-auto p-1"
                >
                  <div
                    className="sticky top-0 z-10 bg-surface-strong p-1"
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <input
                      type="search"
                      value={varQuery}
                      onChange={(e) => setVarQuery(e.target.value)}
                      placeholder="Buscar variable…"
                      className="inbox-search-input"
                      onClick={(e) => e.stopPropagation()}
                      onPointerDown={(e) => e.stopPropagation()}
                    />
                  </div>
                  {filteredFixed.map((v, index) => (
                    <div key={v.key}>
                      {index === 0 ||
                      filteredFixed[index - 1].group !== v.group ? (
                        <div className="mt-2 mb-1 border-t border-line px-2 pt-2 text-xs font-bold text-muted">
                          {v.group}
                        </div>
                      ) : null}
                      <DropdownMenuItem onSelect={() => insertVariable(v.key)}>
                        <span className="flex flex-col">
                          <span>{v.label}</span>
                          <span className="font-mono text-[10px] text-muted">
                            {`{{${v.key}}}`}
                          </span>
                        </span>
                      </DropdownMenuItem>
                    </div>
                  ))}
                  {filteredAttrs.map((a, index) => {
                    const group = showAttrCategory
                      ? categoryLabel(a.category, categoryScope.options)
                      : 'Atributos'
                    const prevGroup =
                      index === 0
                        ? null
                        : showAttrCategory
                          ? categoryLabel(
                              filteredAttrs[index - 1]?.category,
                              categoryScope.options,
                            )
                          : 'Atributos'
                    const showHeader = index === 0 || prevGroup !== group
                    return (
                      <div key={a.slug}>
                        {showHeader ? (
                          <div className="mt-2 mb-1 border-t border-line px-2 pt-2 text-xs font-bold text-muted">
                            {group}
                          </div>
                        ) : null}
                        <DropdownMenuItem onSelect={() => insertVariable(a.slug)}>
                          <span className="flex flex-col">
                            <span>Atributo: {a.label}</span>
                            <span className="font-mono text-[10px] text-muted">
                              {`{{${a.slug}}}`}
                            </span>
                          </span>
                        </DropdownMenuItem>
                      </div>
                    )
                  })}
                  {filteredFixed.length === 0 && filteredAttrs.length === 0 ? (
                    <p className="px-2 py-2 text-xs text-muted">Sin coincidencias</p>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                type="button"
                size="sm"
                disabled={saving}
                onClick={() => void saveNote()}
              >
                {saving ? '…' : editingId ? 'Guardar' : 'Añadir'}
              </Button>
              {editingId ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={resetForm}
                >
                  Cancelar
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
    </>
  )
}
