import { type FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { notify } from '@/shared/notify'
import { apiClient } from '../../shared/api'
import { AREA_OPTIONS } from './areaLabels'
import { useConfirmDialog } from '@/shared/ui/ConfirmDialog'

type AdminUserDetail = {
  id: number
  email: string
  area: string
  is_master: boolean
  must_change_password: boolean
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

export function AdminUserFormPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { confirm, confirmDialog } = useConfirmDialog()
  // Ruta `users/new` no define `:id`; `users/:id` puede traer id="new".
  const isNew = !id || id === 'new'
  const userId = isNew ? null : Number(id)

  const [loading, setLoading] = useState(!isNew)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [area, setArea] = useState('ti')
  const [isMaster, setIsMaster] = useState(false)
  const [mustChangePassword, setMustChangePassword] = useState(true)
  const [extraAreas, setExtraAreas] = useState<string[]>([])
  const [perms, setPerms] = useState<Record<string, boolean>>({
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
  })

  useEffect(() => {
    if (isNew || !userId || Number.isNaN(userId)) return
    apiClient.get<AdminUserDetail>(`/api/admin/users/${userId}`).then((result) => {
      setLoading(false)
      if (!result.ok) {
        notify.error(result.error)
        return
      }
      const user = result.data
      setEmail(user.email)
      setArea(user.area)
      setIsMaster(user.is_master)
      setMustChangePassword(user.must_change_password)
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
  }, [isNew, userId])

  function toggleExtraArea(slug: string) {
    setExtraAreas((current) =>
      current.includes(slug)
        ? current.filter((item) => item !== slug)
        : [...current, slug],
    )
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const body = {
      email: isNew ? email : undefined,
      password: password || undefined,
      area,
      is_master: isMaster,
      must_change_password: mustChangePassword,
      extra_areas: extraAreas.filter((slug) => slug !== area),
      ...perms,
    }

    const result = isNew
      ? await apiClient.post<AdminUserDetail>('/api/admin/users', {
          ...body,
          email,
          password,
        })
      : await apiClient.patch<AdminUserDetail>(`/api/admin/users/${userId}`, body)

    if (!result.ok) {
      notify.error(result.error)
      return
    }
    navigate('/admin/users', { replace: true })
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
    const result = await apiClient.delete(`/api/admin/users/${userId}`)
    if (!result.ok) {
      notify.error(result.error)
      return
    }
    navigate('/admin/users', { replace: true })
  }

  if (loading) return <p className="text-muted">Cargando…</p>

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="max-w-xl space-y-4">
      {confirmDialog}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          {isNew ? 'Nuevo usuario' : 'Editar usuario'}
        </h2>
        <Link to="/admin/users" className="text-sm text-accent underline">
          Volver
        </Link>
      </div>

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
        <span className="text-sm font-medium">
          {isNew ? 'Contraseña' : 'Nueva contraseña (opcional)'}
        </span>
        <input
          type="password"
          required={isNew}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-line px-3 py-2 text-sm"
        />
      </label>

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
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={mustChangePassword}
            onChange={(e) => setMustChangePassword(e.target.checked)}
          />
          Debe cambiar contraseña al entrar
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

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white"
        >
          Guardar
        </button>
        {!isNew ? (
          <button
            type="button"
            onClick={() => void onDelete()}
            className="rounded-lg border border-line px-4 py-2 text-sm text-bad hover:bg-bad/10"
          >
            Eliminar
          </button>
        ) : null}
      </div>
    </form>
  )
}
