import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { insertAtSelection } from '@/shared/textSelection'
import { apiClient } from '../../shared/api'
import { notify } from '@/shared/notify'
import { categoryLabel } from '@/shared/area/useCategoryScope'
import { Button } from '@/shared/ui/shadcn/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/ui/shadcn/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/shadcn/popover'
import { useConfirmDialog } from '@/shared/ui/ConfirmDialog'

type AdvisorNote = {
  id: number
  title: string
  body: string
  sort_order: number
}

type AttrDef = { slug: string; label: string; category?: string }

type FixedVariable = {
  key: string
  label: string
  group: string
}

type InboxAdvisorNotesPopoverProps = {
  onInsert: (text: string) => void
  contactAttributes?: Record<string, string>
  contactName?: string
  contactPhone?: string
  contactEmail?: string
  contactDni?: string
  triggerIcon?: ReactNode
}

const CONTACT_NAME_KEY = 'contact.name'
const CONTACT_PHONE_KEY = 'contact.phone'
const CONTACT_EMAIL_KEY = 'contact.email'
const CONTACT_DNI_KEY = 'contact.dni'

function resolveNotePlaceholders(
  template: string,
  attrs: Record<string, string>,
  contact: {
    name: string
    phone: string
    email: string
    dni: string
  },
): string {
  return template.replace(
    /\{\{\s*([A-Za-z][A-Za-z0-9_.]*)\s*\}\}/g,
    (_m, key: string) => {
      if (key === CONTACT_NAME_KEY) return contact.name.trim()
      if (key === CONTACT_PHONE_KEY) return contact.phone.trim()
      if (key === CONTACT_EMAIL_KEY) {
        const native = contact.email.trim()
        if (native) return native
        return String(attrs.email || attrs.correo || '').trim()
      }
      if (key === CONTACT_DNI_KEY) {
        const native = contact.dni.trim()
        if (native) return native
        return String(attrs.dni || '').trim()
      }
      const v = attrs[key]
      return v != null && String(v).trim() ? String(v) : ''
    },
  )
}

export function InboxAdvisorNotesPopover({
  onInsert,
  contactAttributes = {},
  contactName = '',
  contactPhone = '',
  contactEmail = '',
  contactDni = '',
  triggerIcon,
}: InboxAdvisorNotesPopoverProps) {
  const { confirm, confirmDialog } = useConfirmDialog()
  const [open, setOpen] = useState(false)
  const [notes, setNotes] = useState<AdvisorNote[]>([])
  const [attrDefs, setAttrDefs] = useState<AttrDef[]>([])
  const [loading, setLoading] = useState(false)
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
      const ga = categoryLabel(a.category)
      const gb = categoryLabel(b.category)
      return ga.localeCompare(gb) || a.label.localeCompare(b.label)
    })
  }, [attrDefs, varQuery])

  const load = useCallback(async () => {
    setLoading(true)
    const [notesRes, attrsRes] = await Promise.all([
      apiClient.get<AdvisorNote[]>('/api/advisor-notes'),
      apiClient.get<{ slug: string; label: string; category?: string }[]>(
        '/api/attribute-definitions',
      ),
    ])
    setLoading(false)
    if (!notesRes.ok) {
      notify.error(notesRes.error)
      return
    }
    setNotes(notesRes.data)
    if (attrsRes.ok) {
      setAttrDefs(
        attrsRes.data.map((a) => ({
          slug: a.slug,
          label: a.label,
          category: a.category,
        })),
      )
    }
  }, [])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

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
    await load()
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
    await load()
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
    onInsert(
      resolveNotePlaceholders(noteBody, contactAttributes, {
        name: contactName,
        phone: contactPhone,
        email: contactEmail,
        dni: contactDni,
      }),
    )
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
          className="inbox-compose-notes-btn shrink-0 gap-1.5 px-2.5"
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
                  <div className="mt-1 flex gap-2">
                    <button
                      type="button"
                      className="text-[11px] text-muted hover:text-ink"
                      onClick={() => startEdit(note)}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className="text-[11px] text-bad"
                      onClick={() => void removeNote(note.id)}
                    >
                      Eliminar
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
                    className="w-full rounded-lg border border-line bg-bg px-2 py-1.5 text-sm"
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
                    ? categoryLabel(a.category)
                    : 'Atributos'
                  const prevGroup =
                    index === 0
                      ? null
                      : showAttrCategory
                        ? categoryLabel(filteredAttrs[index - 1]?.category)
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
            <div className="flex gap-2">
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
