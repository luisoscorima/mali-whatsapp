import { useEffect, useState } from 'react'
import { apiClient, type AreaLineInfo, type AuthUser } from '@/shared/api'
import { areaLabel } from '@/features/admin/areaLabels'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/shadcn/popover'
import { WaAreaSwitchPanel } from './WaAreaSwitchPanel'

type WaAreaSwitchPillProps = {
  user: AuthUser
  onUserUpdate?: (user: AuthUser) => void
}

export function WaAreaSwitchPill({ user, onUserUpdate }: WaAreaSwitchPillProps) {
  const [open, setOpen] = useState(false)
  const [areaLines, setAreaLines] = useState<AreaLineInfo[]>([])
  const allowedAreasKey = user.allowedAreas.join(',')
  const line = areaLines.find((item) => item.area === user.area)
  const label = line?.label || areaLabel(user.area)
  const phone = line?.display_phone_number?.trim() || ''
  const activeLabel = `Área activa: ${label}${phone ? ` · ${phone}` : ''}`

  useEffect(() => {
    let cancelled = false
    setAreaLines([])
    void apiClient.getAreaLines().then((result) => {
      if (!cancelled && result.ok) setAreaLines(result.data)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [user.id, allowedAreasKey])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="area-pill area-pill--rail area-pill--rail-btn"
          title={`${activeLabel}. Ver áreas`}
          aria-label={`${activeLabel}. Ver áreas`}
        >
          <span>{label}</span>
          {phone ? <span className="area-pill__phone">{phone.replace(/\D/g, '')}</span> : null}
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
          areaLines={areaLines}
          onUserUpdate={onUserUpdate}
          onDone={() => setOpen(false)}
          className="px-4 py-3"
        />
      </PopoverContent>
    </Popover>
  )
}
