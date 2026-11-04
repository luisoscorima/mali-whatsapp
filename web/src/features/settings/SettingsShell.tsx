import { ModulesShell, type SettingsModule } from './ModulesShell'

export type { SettingsModule }

export function SettingsShell() {
  return (
    <ModulesShell
      navGroup="ajustes"
      title="Ajustes"
      emptyMessage="No tienes acceso a ningún módulo de ajustes."
      loadErrorMessage="No se pudieron cargar los ajustes."
      backLabel="Volver a Ajustes"
      rootPath="/settings"
    />
  )
}
