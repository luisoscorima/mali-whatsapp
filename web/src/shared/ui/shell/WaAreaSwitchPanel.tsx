import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiClient, type AreaLineInfo, type AuthUser } from '@/shared/api'
import { areaLabel } from '@/features/admin/areaLabels'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/shared/ui/shadcn/tooltip'

type WaAreaSwitchPanelProps = {
  user: AuthUser
  onUserUpdate?: (user: AuthUser) => void
  onDone?: () => void
  className?: string
}

export function canSwitchArea(user: AuthUser): boolean {
  return user.isMaster || user.allowedAreas.length > 1
}

export function WaAreaSwitchPanel({
  user,
  onUserUpdate,
  onDone,
  className = '',
}: WaAreaSwitchPanelProps) {
  const navigate = useNavigate()
  const [switching, setSwitching] = useState<string | null>(null)
  const [areaLines, setAreaLines] = useState<AreaLineInfo[]>([])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const result = await apiClient.getAreaLines()
      if (cancelled || !result.ok) return
      setAreaLines(result.data)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function onSelectArea(area: string) {
    if (!area || area === user.area || switching) return
    setSwitching(area)
    const result = await apiClient.switchArea(area)
    setSwitching(null)
    if (result.ok) {
      onUserUpdate?.(result.data.user)
      onDone?.()
      navigate('/conversations', { replace: true })
    }
  }

  const linesByArea = new Map(areaLines.map((line) => [line.area, line]))

  return (
    <div className={className}>
      <p className="mb-1.5 text-xs font-medium text-muted">Cambiar área</p>
      <ul className="flex flex-col gap-0.5">
        {user.allowedAreas.map((area) => {
          const line = linesByArea.get(area)
          const label = line?.label || areaLabel(area)
          const phone = line?.display_phone_number?.trim() || ''
          const phoneId = line?.phone_number_id?.trim() || ''
          const isCurrent = area === user.area
          const isBusy = switching === area
          const tipLines = [
            label,
            phone || null,
            phoneId ? `ID: ${phoneId}` : null,
          ].filter(Boolean)

          return (
            <li key={area}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    disabled={!!switching || isCurrent}
                    onClick={() => void onSelectArea(area)}
                    className={
                      isCurrent
                        ? 'w-full rounded-md bg-accent-soft px-2 py-1.5 text-left text-sm'
                        : 'w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent-soft disabled:opacity-60'
                    }
                  >
                    <span className="block font-medium">{label}</span>
                    {phone ? (
                      <span className="mt-0.5 block text-xs text-muted">
                        {phone}
                      </span>
                    ) : null}
                    {isBusy ? (
                      <span className="mt-0.5 block text-xs text-muted">
                        Cambiando…
                      </span>
                    ) : null}
                  </button>
                </TooltipTrigger>
                {tipLines.length > 1 ? (
                  <TooltipContent side="right" className="max-w-xs whitespace-pre-line">
                    {tipLines.join('\n')}
                  </TooltipContent>
                ) : null}
              </Tooltip>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
