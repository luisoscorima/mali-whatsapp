import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiClient, type AuthUser } from '@/shared/api'
import { areaLabel } from '@/features/admin/areaLabels'
import {
  canonicalArea,
  readCategorySelection,
  writeCategorySelection,
} from '@/shared/area/category-selection'

const AREA_ORDER = ['ti', 'pam', 'patronato', 'educacion']

type CategoryOption = { slug: string; label: string }

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
  const [categories, setCategories] = useState<CategoryOption[]>([])
  const [selected, setSelected] = useState<string[] | null>(null)
  const currentArea = canonicalArea(user.area)
  const areas = [...new Set(user.allowedAreas.map(canonicalArea))].sort(
    (left, right) => AREA_ORDER.indexOf(left) - AREA_ORDER.indexOf(right),
  )

  useEffect(() => {
    if (currentArea !== 'educacion') {
      setCategories([])
      return
    }
    let cancelled = false
    void apiClient.getEducationCategories().then((result) => {
      if (cancelled || !result.ok) return
      setCategories(result.data)
      setSelected(readCategorySelection(user.id, 'educacion'))
    }).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [currentArea, user.id])

  async function onSelectArea(area: string) {
    if (!area || area === user.area || switching) return
    setSwitching(area)
    const result = await apiClient.switchArea(area)
    setSwitching(null)
    if (result.ok) {
      writeCategorySelection(user.id, area, null)
      onUserUpdate?.(result.data.user)
      onDone?.()
      navigate('/conversations', { replace: true })
    }
  }

  function onToggleCategory(slug: string) {
    const allowed = categories.map((item) => item.slug)
    const current = (selected ?? allowed).filter((item) => allowed.includes(item))
    const next = current.includes(slug)
      ? current.filter((item) => item !== slug)
      : [...current, slug]
    if (!next.length) return
    const every = allowed.every((item) => next.includes(item))
    writeCategorySelection(user.id, 'educacion', every ? null : next)
    setSelected(every ? null : next)
  }

  const chosen = selected ?? categories.map((item) => item.slug)

  return (
    <div className={className}>
      <p className="mb-1.5 text-xs font-medium text-muted">Área</p>
      <ul className="flex flex-col gap-0.5">
        {areas.map((area) => {
          const isCurrent = currentArea === area
          const isBusy = switching === area
          return (
            <li key={area}>
              <button
                type="button"
                disabled={!!switching || (isCurrent && user.area === area)}
                onClick={() => void onSelectArea(area)}
                className={
                  isCurrent
                    ? 'w-full rounded-md bg-accent-soft px-2 py-1.5 text-left text-sm'
                    : 'w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent-soft disabled:opacity-60'
                }
              >
                <span className="block font-medium">{areaLabel(area)}</span>
                {isBusy ? <span className="mt-0.5 block text-xs text-muted">Cambiando…</span> : null}
              </button>
            </li>
          )
        })}
      </ul>
      {currentArea === 'educacion' && categories.length > 1 ? (
        <div className="mt-3">
          <p className="mb-1.5 text-xs font-medium text-muted">Categoría</p>
          <div className="flex flex-wrap gap-1">
            {categories.map((category) => {
              const on = chosen.includes(category.slug)
              return (
                <button
                  key={category.slug}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onToggleCategory(category.slug)}
                  className={
                    on
                      ? 'rounded-full bg-accent-soft px-2 py-1 text-xs font-medium'
                      : 'rounded-full px-2 py-1 text-xs text-muted hover:bg-accent-soft'
                  }
                >
                  {category.label}
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}
