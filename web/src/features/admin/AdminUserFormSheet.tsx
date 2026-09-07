import { type FormEvent, useEffect, useState } from 'react'
import { notify } from '@/shared/notify'
import { apiClient } from '@/shared/api'
import { ROLE_OPTIONS } from '@/shared/auth/permissions'
import { useConfirmDialog } from '@/shared/ui/ConfirmDialog'
import {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/shared/ui/shadcn/sheet'
import { AREA_OPTIONS } from './areaLabels'

type AdminUserDetail = {
  id: number
  email: string
  area: string
  role_slug: string | null
  is_master: boolean
  can_edit_ai_prompt: boolean
  can_view_audit_logs: boolean
  can_view_integration: boolean
  can_edit_business_hours: boolean
  can_view_reports: boolean
  can_assign_conversations: boolean
  can_manage_attributes: boolean
  can_manage_segments: boolean
  can_view_conversation_stats: boolean
  can_view_campaign_stats: boolean
  can_manage_leads: boolean
  extra_areas: string[]
}

export type AdminUserFormSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'create' | 'edit'
  userId?: number | null
  onSaved: () => void
}

export function AdminUserFormSheet({
  open,
  onOpenChange,
  mode,
  userId = null,
  onSaved,
}: AdminUserFormSheetProps) {
  const isNew = mode === 'create'
  const { confirm, confirmDialog } = useConfirmDialog()

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [email, setEmail] = useState('')
  const [area, setArea] = useState('ti')
  const [roleSlug, setRoleSlug] = useState('asesor_comercial')
  const [isMaster, setIsMaster] = useState(false)
  const [extraAreas, setExtraAreas] = useState<string[]>([])

  useEffect(() => {
    if (!open) return

    let cancelled = false
    setLoadFailed(false)
    setSaving(false)

    if (isNew) {
      setLoading(false)
      setEmail('')
      setArea('ti')
      setRoleSlug('asesor_comercial')
      setIsMaster(false)
      setExtraAreas([])
      return
    }

    if (!userId) {
      setLoadFailed(true)
      return
    }

    setLoading(true)
    void apiClient.get<AdminUserDetail>(`/api/admin/users/${userId}`).then((result) => {
      if (cancelled) return
      setLoading(false)
      if (!result.ok) {
        notify.error(result.error)
        setLoadFailed(true)
        return
      }
      const user = result.data
      setEmail(user.email)
      setArea(user.area)
      setIsMaster(user.is_master)
      setRoleSlug(
        user.is_master
          ? 'master'
          : user.role_slug && ROLE_OPTIONS.some((r) => r.slug === user.role_slug)
            ? user.role_slug
            : 'asesor_comercial',
      )
      setExtraAreas(user.extra_areas)
    })

    return () => {
      cancelled = true
    }
  }, [open, isNew, userId])

  function toggleExtraArea(slug: string) {
    setExtraAreas((current) =>
      current.includes(slug)
        ? current.filter((item) => item !== slug)
        : [...current, slug],
    )
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    const effectiveRole = isMaster ? 'master' : roleSlug
    const body = {
      area,
      is_master: isMaster || effectiveRole === 'master',
      role_slug: effectiveRole,
      extra_areas: extraAreas.filter((slug) => slug !== area),
    }

    const result = isNew
      ? await apiClient.post<AdminUserDetail>('/api/admin/users', {
          ...body,
          email,
        })
      : await apiClient.patch<AdminUserDetail>(`/api/admin/users/${userId}`, body)

    setSaving(false)
    if (!result.ok) {
      notify.error(result.error)
      return
    }
    onOpenChange(false)
    onSaved()
  }

  async function onDelete() {
    if (isNew || !userId || !email) return
    if (
      !(await confirm({
        title: 'Eliminar usuario',
        description: `¿Eliminar ${email}?`,
        confirmLabel: 'Eliminar',
        tone: 'danger',
      }))
    ) {
      return
    }
    setSaving(true)
    const result = await apiClient.delete(`/api/admin/users/${userId}`)
    setSaving(false)
    if (!result.ok) {
      notify.error(result.error)
      return
    }
    onOpenChange(false)
    onSaved()
  }

  const ready = !loading && !loadFailed

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-[min(100%,32rem)]">
          <SheetHeader>
            <SheetTitle>{isNew ? 'Nuevo usuario' : 'Editar usuario'}</SheetTitle>
            <SheetDescription>
              {isNew
                ? 'El usuario entrará con Google Workspace (@mali.pe). El rol define los permisos.'
                : 'Área, áreas adicionales y rol. Los permisos salen de la plantilla del rol.'}
            </SheetDescription>
          </SheetHeader>

          <SheetBody>
            {loadFailed ? (
              <p className="text-sm text-muted">No se pudo cargar</p>
            ) : !ready ? (
              <p className="text-sm text-muted">Cargando…</p>
            ) : (
              <form
                id="admin-user-form"
                onSubmit={(e) => void onSubmit(e)}
                className="space-y-4"
              >
                {isNew ? (
                  <label className="block space-y-1">
                    <span className="text-sm font-medium">Correo @mali.pe</span>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full rounded-lg border border-line px-3 py-2 text-sm"
                    />
                  </label>
                ) : (
                  <p className="text-sm text-muted">{email}</p>
                )}

                <label className="block space-y-1">
                  <span className="text-sm font-medium">Área principal</span>
                  <select
                    value={area}
                    onChange={(e) => setArea(e.target.value)}
                    className="w-full rounded-lg border border-line px-3 py-2 text-sm"
                  >
                    {AREA_OPTIONS.map((item) => (
                      <option key={item.slug} value={item.slug}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>

                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">Áreas adicionales</legend>
                  <div className="flex flex-wrap gap-2">
                    {AREA_OPTIONS.filter((item) => item.slug !== area).map((item) => (
                      <label key={item.slug} className="flex items-center gap-1 text-sm">
                        <input
                          type="checkbox"
                          checked={extraAreas.includes(item.slug)}
                          onChange={() => toggleExtraArea(item.slug)}
                        />
                        {item.label}
                      </label>
                    ))}
                  </div>
                </fieldset>

                <label className="block space-y-1">
                  <span className="text-sm font-medium">Rol</span>
                  <select
                    value={isMaster ? 'master' : roleSlug}
                    disabled={isMaster}
                    onChange={(e) => {
                      const next = e.target.value
                      setRoleSlug(next)
                      if (next === 'master') setIsMaster(true)
                    }}
                    className="w-full rounded-lg border border-line px-3 py-2 text-sm disabled:opacity-60"
                  >
                    {ROLE_OPTIONS.map((item) => (
                      <option key={item.slug} value={item.slug}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                  <span className="text-xs text-muted">
                    Detalle de permisos: docs/ROLES-PERMISOS.md
                  </span>
                </label>

                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">Opciones</legend>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={isMaster}
                      onChange={(e) => {
                        const checked = e.target.checked
                        setIsMaster(checked)
                        if (checked) setRoleSlug('master')
                        else if (roleSlug === 'master') setRoleSlug('coordinador')
                      }}
                    />
                    Master (todos los permisos + admin)
                  </label>
                </fieldset>
              </form>
            )}
          </SheetBody>

          <SheetFooter>
            {!isNew && ready ? (
              <button
                type="button"
                disabled={saving}
                onClick={() => void onDelete()}
                className="mr-auto rounded-lg border border-line px-3 py-1.5 text-sm text-bad hover:bg-bad/10 disabled:opacity-50"
              >
                Eliminar
              </button>
            ) : null}
            <SheetClose disabled={saving}>Cerrar</SheetClose>
            {ready ? (
              <button
                type="submit"
                form="admin-user-form"
                disabled={saving}
                className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {saving ? 'Guardando…' : 'Guardar'}
              </button>
            ) : null}
          </SheetFooter>
        </SheetContent>
      </Sheet>
      {confirmDialog}
    </>
  )
}
