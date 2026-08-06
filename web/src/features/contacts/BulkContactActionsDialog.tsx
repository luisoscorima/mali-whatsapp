import { type FormEvent, useEffect, useState } from 'react'
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
  /** Si hay grupos, se renderizan como optgroup. */
  group?: string
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
}

const FIELD =
  'w-full rounded border border-line bg-bg px-2 py-1.5 text-sm'

export function BulkContactActionsDialog({
  open,
  onOpenChange,
  selectedCount,
  segments,
  attributeDefinitions,
  busy = false,
  onApplySegment,
  onApplyAttribute,
}: BulkContactActionsDialogProps) {
  const [segmentSlug, setSegmentSlug] = useState('')
  const [attrKey, setAttrKey] = useState('')
  const [attrValue, setAttrValue] = useState('')

  useEffect(() => {
    if (!open) {
      setSegmentSlug('')
      setAttrKey('')
      setAttrValue('')
    }
  }, [open])

  const attrDef =
    attributeDefinitions.find((d) => d.slug === attrKey) ?? null

  const segmentGroups = (() => {
    const hasGroups = segments.some((s) => Boolean(s.group))
    if (!hasGroups) return null
    const map = new Map<string, BulkSegmentOption[]>()
    for (const seg of segments) {
      const key = (seg.group ?? '').trim() || 'otros'
      const rows = map.get(key) ?? []
      rows.push(seg)
      map.set(key, rows)
    }
    return [...map.entries()]
  })()

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
          {segments.length > 0 ? (
            <form onSubmit={(e) => void submitSegment(e)} className="flex flex-col gap-2">
              <label className="text-sm font-medium text-ink">Segmento</label>
              <select
                value={segmentSlug}
                onChange={(e) => setSegmentSlug(e.target.value)}
                required
                className={FIELD}
              >
                <option value="">Elegir segmento</option>
                {segmentGroups
                  ? segmentGroups.map(([group, segs]) => (
                      <optgroup key={group} label={group}>
                        {segs.map((seg) => (
                          <option key={seg.slug} value={seg.slug}>
                            {seg.label}
                          </option>
                        ))}
                      </optgroup>
                    ))
                  : segments.map((seg) => (
                      <option key={seg.slug} value={seg.slug}>
                        {seg.label}
                      </option>
                    ))}
              </select>
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
              <select
                value={attrKey}
                onChange={(e) => {
                  setAttrKey(e.target.value)
                  setAttrValue('')
                }}
                required
                className={FIELD}
              >
                <option value="">Elegir atributo</option>
                {attributeDefinitions.map((def) => (
                  <option key={def.slug} value={def.slug}>
                    {def.label}
                  </option>
                ))}
              </select>
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
