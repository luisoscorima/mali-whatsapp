import { useState } from 'react'
import type { AuthUser } from '@/shared/api'
import { areaLabel } from '@/features/admin/areaLabels'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/shadcn/popover'
import { canSwitchArea, WaAreaSwitchPanel } from './WaAreaSwitchPanel'

type WaAreaSwitchPillProps = {
  user: AuthUser
  onUserUpdate?: (user: AuthUser) => void
}

export function WaAreaSwitchPill({ user, onUserUpdate }: WaAreaSwitchPillProps) {
  const [open, setOpen] = useState(false)
  const label = areaLabel(user.area)

  if (!canSwitchArea(user)) {
    return (
      <span className="area-pill area-pill--rail" title={`Área activa: ${label}`}>
        {label}
      </span>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="area-pill area-pill--rail area-pill--rail-btn"
          title={`Área activa: ${label}. Clic para cambiar`}
          aria-label={`Área activa: ${label}. Cambiar área`}
        >
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        className="wa-rail__account-popover w-64 p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
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
