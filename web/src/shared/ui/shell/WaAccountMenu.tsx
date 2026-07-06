import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { apiClient, type AuthUser } from '@/shared/api'
import { areaLabel } from '@/features/admin/areaLabels'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/shadcn/popover'

type WaAccountMenuProps = {
  user: AuthUser
  onUserUpdate?: (user: AuthUser) => void
}

export function WaAccountMenu({ user, onUserUpdate }: WaAccountMenuProps) {
  const [open, setOpen] = useState(false)
  const [pendingArea, setPendingArea] = useState(user.area)
  const [switching, setSwitching] = useState(false)
  const railInitial = user.email ? user.email.charAt(0).toUpperCase() : '?'
  const showAreaSwitch = user.isMaster || user.allowedAreas.length > 1

  useEffect(() => {
    setPendingArea(user.area)
  }, [user.area])

  async function onConfirmAreaChange() {
    if (!pendingArea || pendingArea === user.area) return
    setSwitching(true)
    const result = await apiClient.switchArea(pendingArea)
    setSwitching(false)
    if (result.ok) {
      onUserUpdate?.(result.data.user)
      setOpen(false)
      window.location.assign('/campaigns')
    }
  }

  function onLogout() {
    apiClient.logout()
    window.location.href = '/login'
  }

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
      <PopoverContent side="right" align="end" className="wa-rail__account-popover w-64 p-0">
        <div className="border-b border-line px-4 py-3">
          <p className="truncate text-sm font-medium">{user.email}</p>
          <p className="mt-1 flex flex-wrap gap-1">
            <span className="area-pill area-pill--menu">{areaLabel(user.area)}</span>
            {user.isMaster ? (
              <span className="area-pill area-pill--master area-pill--menu">Master</span>
            ) : null}
          </p>
        </div>

        {showAreaSwitch ? (
          <div className="border-b border-line px-4 py-3">
            <label className="block text-xs font-medium text-muted">Cambiar área</label>
            <select
              value={pendingArea}
              onChange={(e) => setPendingArea(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
            >
              {user.allowedAreas.map((area) => (
                <option key={area} value={area}>
                  {areaLabel(area)}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={switching || pendingArea === user.area}
              onClick={() => void onConfirmAreaChange()}
              className="small-btn primary mt-2 w-full"
            >
              {switching ? 'Cambiando…' : 'Cambiar área'}
            </button>
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
              to="/admin/users"
              className="rounded-md px-2 py-1.5 text-sm hover:bg-accent-soft"
              onClick={() => setOpen(false)}
            >
              Admin
            </Link>
          ) : null}
        </div>

        <div className="border-t border-line p-2">
          <button type="button" className="wa-rail__logout-btn w-full" onClick={onLogout}>
            Cerrar sesión
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
