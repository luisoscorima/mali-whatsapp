import { useEffect, useState } from 'react'
import type { AuthUser } from '@/shared/api'
import { areaLabel } from '@/features/admin/areaLabels'
import {
  canonicalArea,
  onCategorySelection,
  readCategorySelection,
} from '@/shared/area/category-selection'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/shadcn/popover'
import { WaAreaSwitchPanel } from './WaAreaSwitchPanel'

type WaAreaSwitchPillProps = {
  user: AuthUser
  onUserUpdate?: (user: AuthUser) => void
}

export function WaAreaSwitchPill({ user, onUserUpdate }: WaAreaSwitchPillProps) {
  const [open, setOpen] = useState(false)
  const [selection, setSelection] = useState<string[] | null>(null)
  const area = canonicalArea(user.area)
  const label = areaLabel(area)

  useEffect(() => {
    const sync = () => setSelection(readCategorySelection(user.id, area))
    sync()
    return onCategorySelection(sync)
  }, [user.id, area])

  const detail = area === 'educacion' && selection?.length
    ? selection.map((slug) => (slug === 'general' ? 'General' : slug.toUpperCase())).join(' ')
    : ''

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="area-pill area-pill--rail area-pill--rail-btn"
          title={detail ? `${label}. ${detail}` : label}
          aria-label={detail ? `${label}. ${detail}` : label}
        >
          <span>{label}</span>
          {detail ? <span className="area-pill__phone">{detail}</span> : null}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        className="wa-rail__account-popover w-64 p-0"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <WaAreaSwitchPanel
          user={user}
          onUserUpdate={onUserUpdate}
          onDone={() => setOpen(false)}
          className="px-4 py-3"
        />
      </PopoverContent>
    </Popover>
  )
}
