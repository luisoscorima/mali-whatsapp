import { type FormEvent, useEffect, useState } from 'react'
import { notify } from '@/shared/notify'
import { apiClient } from '@/shared/api'
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
  can_manage_anuncios: boolean
  extra_areas: string[]
}

const PERM_FIELDS = [
  { key: 'can_view_integration', label: 'Ver integración' },
  { key: 'can_edit_ai_prompt', label: 'Editar prompt IA' },
  { key: 'can_edit_business_hours', label: 'Editar horario' },
  { key: 'can_view_audit_logs', label: 'Ver bitácora' },
  { key: 'can_view_reports', label: 'Ver reportería' },
  { key: 'can_assign_conversations', label: 'Asignar conversaciones' },
  { key: 'can_manage_attributes', label: 'Gestionar atributos' },
  { key: 'can_manage_segments', label: 'Gestionar segmentos' },
  { key: 'can_manage_anuncios', label: 'Gestionar anuncios' },
  { key: 'can_view_conversation_stats', label: 'Ver stats globales de conversaciones' },
  { key: 'can_view_campaign_stats', label: 'Ver stats de campañas' },
] as const

const EMPTY_PERMS: Record<string, boolean> = {
  can_view_integration: false,
  can_edit_ai_prompt: false,
  can_edit_business_hours: false,
  can_view_audit_logs: false,
  can_view_reports: false,
  can_assign_conversations: false,
  can_manage_attributes: false,
  can_manage_segments: false,
  can_view_conversation_stats: false,
  can_view_campaign_stats: false,
  can_manage_anuncios: false,
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
  const [isMaster, setIsMaster] = useState(false)
  const [extraAreas, setExtraAreas] = useState<string[]>([])
  const [perms, setPerms] = useState<Record<string, boolean>>(EMPTY_PERMS)

  useEffect(() => {
    if (!open) return

    let cancelled = false
    setLoadFailed(false)
    setSaving(false)

    if (isNew) {
      setLoading(false)
      setEmail('')
      setArea('ti')
      setIsMaster(false)
      setExtraAreas([])
      setPerms({ ...EMPTY_PERMS })
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
      setExtraAreas(user.extra_areas)
      setPerms({
        can_view_integration: user.can_view_integration,
        can_edit_ai_prompt: user.can_edit_ai_prompt,
        can_edit_business_hours: user.can_edit_business_hours,
        can_view_audit_logs: user.can_view_audit_logs,
        can_view_reports: user.can_view_reports,
        can_assign_conversations: user.can_assign_conversations,
        can_manage_attributes: user.can_manage_attributes,
        can_manage_segments: user.can_manage_segments,
        can_view_conversation_stats: user.can_view_conversation_stats,
        can_view_campaign_stats: user.can_view_campaign_stats,
        can_manage_anuncios: user.can_manage_anuncios,
      })
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
    const body = {
      area,
      is_master: isMaster,
      extra_areas: extraAreas.filter((slug) => slug !== area),
      ...perms,
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
                ? 'El usuario entrará con Google Workspace (@mali.pe).'
                : 'Actualiza área y permisos. El login sigue siendo con Google.'}
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

                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">Opciones</legend>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={isMaster}
                      onChange={(e) => setIsMaster(e.target.checked)}
                    />
                    Master
                  </label>
                </fieldset>

                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">Permisos de ajustes</legend>
                  {PERM_FIELDS.map((field) => (
                    <label key={field.key} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={perms[field.key]}
                        onChange={(e) =>
                          setPerms((current) => ({
                            ...current,
                            [field.key]: e.target.checked,
                          }))
                        }
                      />
                      {field.label}
                    </label>
                  ))}
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
