import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiClient, type AreaLineInfo, type AuthUser } from '@/shared/api'
import { areaLabel } from '@/features/admin/areaLabels'
import { PalettePicker } from '@/shared/theme/PalettePicker'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/shadcn/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/shared/ui/shadcn/tooltip'

type WaAccountMenuProps = {
  user: AuthUser
  onUserUpdate?: (user: AuthUser) => void
}

export function WaAccountMenu({ user, onUserUpdate }: WaAccountMenuProps) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [switching, setSwitching] = useState<string | null>(null)
  const [areaLines, setAreaLines] = useState<AreaLineInfo[]>([])
  const railInitial = user.email ? user.email.charAt(0).toUpperCase() : '?'
  const showAreaSwitch = user.isMaster || user.allowedAreas.length > 1

  useEffect(() => {
    if (!open || !showAreaSwitch) return
    let cancelled = false
    void (async () => {
      const result = await apiClient.getAreaLines()
      if (cancelled || !result.ok) return
      setAreaLines(result.data)
    })()
    return () => {
      cancelled = true
    }
  }, [open, showAreaSwitch])

  async function onSelectArea(area: string) {
    if (!area || area === user.area || switching) return
    setSwitching(area)
    const result = await apiClient.switchArea(area)
    setSwitching(null)
    if (result.ok) {
      onUserUpdate?.(result.data.user)
      setOpen(false)
      navigate('/conversations', { replace: true })
    }
  }

  async function onLogout() {
    setOpen(false)
    await apiClient.logout()
    navigate('/login', { replace: true })
  }

  const linesByArea = new Map(areaLines.map((line) => [line.area, line]))

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="wa-rail__profile-trigger"
          aria-label="Menú de cuenta"
        >
          <span className="wa-rail__avatar" aria-hidden="true">
            {user.picture ? (
              <img
                src={user.picture}
                alt=""
                className="wa-rail__avatar-img"
                referrerPolicy="no-referrer"
              />
            ) : (
              railInitial
            )}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="end"
        className="wa-rail__account-popover w-64 p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="border-b border-line px-4 py-3">
          <p className="truncate text-sm font-medium">{user.email}</p>
          <p className="mt-1 flex flex-wrap gap-1">
            <span className="area-pill area-pill--menu">{areaLabel(user.area)}</span>
            {user.isMaster ? (
              <span className="area-pill area-pill--master area-pill--menu">Master</span>
            ) : null}
          </p>
        </div>

        <PalettePicker />

        {showAreaSwitch ? (
          <div className="border-b border-line px-4 py-3">
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
        ) : null}

        <div className="flex flex-col gap-1 px-2 py-2">
          <Link
            to="/settings"
            className="rounded-md px-2 py-1.5 text-sm hover:bg-accent-soft"
            onClick={() => setOpen(false)}
          >
            Ajustes
          </Link>
          {user.isMaster ? (
            <Link
              to="/admin"
              className="rounded-md px-2 py-1.5 text-sm hover:bg-accent-soft"
              onClick={() => setOpen(false)}
            >
              Admin
            </Link>
          ) : null}
        </div>

        <div className="border-t border-line p-2">
          <button
            type="button"
            className="wa-rail__logout-btn w-full"
            onClick={() => void onLogout()}
          >
            Cerrar sesión
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
