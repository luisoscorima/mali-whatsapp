import { Link, useOutletContext } from 'react-router-dom'
import type { SettingsModule } from './SettingsShell'

type SettingsOutletContext = {
  modules: SettingsModule[]
}

export function SettingsIndexPage() {
  const ctx = useOutletContext<SettingsOutletContext | null>()
  const modules = ctx?.modules ?? []

  if (!modules.length) {
    return <p className="text-muted">Selecciona un módulo en el menú.</p>
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Ajustes</h1>
        <p className="text-sm text-muted">Elige un módulo para configurar.</p>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {modules.map((mod) => (
          <li key={mod.id}>
            <Link
              to={mod.path}
              className="block rounded-lg border border-line bg-surface-strong px-3 py-3 hover:border-accent"
            >
              <span className="font-medium text-ink">{mod.title}</span>
              {mod.preview ? (
                <span className="mt-1 block text-sm text-muted">{mod.preview}</span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
