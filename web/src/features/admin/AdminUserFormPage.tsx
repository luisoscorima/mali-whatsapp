import { type FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { apiClient } from '../../shared/api'
import { AREA_OPTIONS } from './areaLabels'

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
  extra_areas: string[]
}

const PERM_FIELDS = [
  { key: 'can_view_integration', label: 'Ver integración' },
  { key: 'can_edit_ai_prompt', label: 'Editar prompt IA' },
  { key: 'can_edit_business_hours', label: 'Editar horario' },
  { key: 'can_view_audit_logs', label: 'Ver bitácora' },
  { key: 'can_view_reports', label: 'Ver reportería' },
] as const

export function AdminUserFormPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isNew = id === 'new'
  const userId = isNew ? null : Number(id)

  const [loading, setLoading] = useState(!isNew)
  const [error, setError] = useState('')
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
  })

  useEffect(() => {
    if (isNew || !userId || Number.isNaN(userId)) return
    apiClient.get<AdminUserDetail>(`/api/admin/users/${userId}`).then((result) => {
      setLoading(false)
      if (!result.ok) {
        setError(result.error)
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
    setError('')
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
      setError(result.error)
      return
    }
    navigate('/admin/users')
  }

  if (loading) return <p className="text-muted">Cargando…</p>

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="max-w-xl space-y-4">
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

      {error ? <p className="text-bad">{error}</p> : null}

      <button
        type="submit"
        className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white"
      >
        Guardar
      </button>
    </form>
  )
}
