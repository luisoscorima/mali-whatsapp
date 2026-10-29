import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { categoryLabel } from '@/shared/area/useCategoryScope'
import { SearchableSelect } from '@/shared/ui/SearchableSelect'
import {
  inputTypeForField,
  type AttributeFieldDefinition,
} from './contactFormUtils'
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

export type BulkSegmentOption = {
  slug: string
  label: string
  /** Si hay grupos, se muestran como cabeceras en el selector. */
  group?: string
}

export type BulkAssigneeOption = {
  id: number
  label: string
  email: string
}

type BulkContactActionsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedCount: number
  segments: BulkSegmentOption[]
  attributeDefinitions: AttributeFieldDefinition[]
  busy?: boolean
  onApplySegment: (segmentSlug: string) => Promise<boolean>
  onApplyAttribute: (attrKey: string, attrValue: string) => Promise<boolean>
  assignees?: BulkAssigneeOption[]
  assigneesLoading?: boolean
  allowUnassign?: boolean
  onApplyAssign?: (assignedUserId: number | null) => Promise<boolean>
}

const FIELD =
  'w-full rounded border border-line bg-bg px-2 py-1.5 text-sm'

const UNASSIGN_VALUE = '__none__'

export function BulkContactActionsDialog({
  open,
  onOpenChange,
  selectedCount,
  segments,
  attributeDefinitions,
  busy = false,
  onApplySegment,
  onApplyAttribute,
  assignees = [],
  assigneesLoading = false,
  allowUnassign = true,
  onApplyAssign,
}: BulkContactActionsDialogProps) {
  const [segmentSlug, setSegmentSlug] = useState('')
  const [attrKey, setAttrKey] = useState('')
  const [attrValue, setAttrValue] = useState('')
  const [assigneeValue, setAssigneeValue] = useState('')

  const showAssign = typeof onApplyAssign === 'function'
  const showAttrCategory = useMemo(() => {
    const cats = new Set(
      attributeDefinitions.map((d) => d.category || 'general'),
    )
    return cats.size > 1
  }, [attributeDefinitions])

  const segmentOptions = useMemo(
    () =>
      segments.map((seg) => ({
        value: seg.slug,
        label: seg.label,
        group: seg.group,
      })),
    [segments],
  )

  const attributeOptions = useMemo(
    () =>
      attributeDefinitions.map((def) => ({
        value: def.slug,
        label: def.label,
        group: showAttrCategory
          ? categoryLabel(def.category)
          : undefined,
        keywords: def.slug,
      })),
    [attributeDefinitions, showAttrCategory],
  )

  const assigneeOptions = useMemo(() => {
    const options = assignees.map((a) => ({
      value: String(a.id),
      label: a.label,
      keywords: a.email,
    }))
    if (allowUnassign) {
      return [{ value: UNASSIGN_VALUE, label: 'Sin asignar' }, ...options]
    }
    return options
  }, [assignees, allowUnassign])

  useEffect(() => {
    if (!open) {
      setSegmentSlug('')
      setAttrKey('')
      setAttrValue('')
      setAssigneeValue('')
    }
  }, [open])

  const attrDef =
    attributeDefinitions.find((d) => d.slug === attrKey) ?? null

  async function submitSegment(e: FormEvent) {
    e.preventDefault()
    if (!segmentSlug || selectedCount === 0 || busy) return
    const ok = await onApplySegment(segmentSlug)
    if (ok) setSegmentSlug('')
  }

  async function submitAttribute(e: FormEvent) {
    e.preventDefault()
    if (!attrKey || selectedCount === 0 || busy) return
    const ok = await onApplyAttribute(attrKey, attrValue)
    if (ok) {
      setAttrKey('')
      setAttrValue('')
    }
  }

  async function submitAssign(e: FormEvent) {
    e.preventDefault()
    if (!onApplyAssign || !assigneeValue || selectedCount === 0 || busy) return
    const assignedUserId =
      assigneeValue === UNASSIGN_VALUE ? null : Number(assigneeValue)
    if (assignedUserId != null && !Number.isInteger(assignedUserId)) return
    const ok = await onApplyAssign(assignedUserId)
    if (ok) setAssigneeValue('')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(96vw,420px)]">
        <DialogHeader>
          <DialogTitle>Acciones masivas</DialogTitle>
          <DialogDescription>
            {selectedCount} contacto{selectedCount === 1 ? '' : 's'} seleccionado
            {selectedCount === 1 ? '' : 's'}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {showAssign ? (
            <form onSubmit={(e) => void submitAssign(e)} className="flex flex-col gap-2">
              <label className="text-sm font-medium text-ink">Asesor</label>
              {assigneesLoading ? (
                <p className="text-sm text-muted">Cargando asesores…</p>
              ) : (
                <SearchableSelect
                  value={assigneeValue}
                  onChange={setAssigneeValue}
                  placeholder="Elegir asesor"
                  searchPlaceholder="Buscar asesor…"
                  clearOption={{ label: 'Elegir asesor' }}
                  aria-label="Elegir asesor"
                  options={assigneeOptions}
                />
              )}
              <button
                type="submit"
                disabled={busy || assigneesLoading || !assigneeValue}
                className="small-btn primary self-start"
              >
                {busy ? '…' : 'Asignar'}
              </button>
            </form>
          ) : null}

          {segments.length > 0 ? (
            <form onSubmit={(e) => void submitSegment(e)} className="flex flex-col gap-2">
              <label className="text-sm font-medium text-ink">Segmento</label>
              <SearchableSelect
                value={segmentSlug}
                onChange={setSegmentSlug}
                placeholder="Elegir segmento"
                searchPlaceholder="Buscar segmento…"
                clearOption={{ label: 'Elegir segmento' }}
                aria-label="Elegir segmento"
                options={segmentOptions}
              />
              <button
                type="submit"
                disabled={busy || !segmentSlug}
                className="small-btn primary self-start"
              >
                {busy ? '…' : 'Aplicar segmento'}
              </button>
            </form>
          ) : null}

          {attributeDefinitions.length > 0 ? (
            <form
              onSubmit={(e) => void submitAttribute(e)}
              className="flex flex-col gap-2"
            >
              <label className="text-sm font-medium text-ink">Atributo</label>
              <SearchableSelect
                value={attrKey}
                onChange={(next) => {
                  setAttrKey(next)
                  setAttrValue('')
                }}
                placeholder="Elegir atributo"
                searchPlaceholder="Buscar atributo…"
                clearOption={{ label: 'Elegir atributo' }}
                aria-label="Elegir atributo"
                options={attributeOptions}
              />
              {attrDef?.field_type === 'select' ? (
                <select
                  value={attrValue}
                  onChange={(e) => setAttrValue(e.target.value)}
                  className={FIELD}
                >
                  <option value="">Valor</option>
                  {(attrDef.options ?? []).map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={inputTypeForField(attrDef?.field_type ?? 'text')}
                  value={attrValue}
                  onChange={(e) => setAttrValue(e.target.value)}
                  placeholder="Valor"
                  className={FIELD}
                />
              )}
              <button
                type="submit"
                disabled={busy || !attrKey}
                className="small-btn primary self-start"
              >
                {busy ? '…' : 'Aplicar atributo'}
              </button>
            </form>
          ) : null}
        </DialogBody>
        <DialogFooter className="justify-start">
          <DialogClose>Cerrar</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
