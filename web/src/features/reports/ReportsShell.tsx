import { ModulesShell } from '../settings/ModulesShell'

export function ReportsShell() {
  return (
    <ModulesShell
      navGroup="reportes"
      title="Reportes"
      emptyMessage="No tienes acceso a ningún módulo de reportes."
      loadErrorMessage="No se pudieron cargar los reportes."
      backLabel="Volver a Reportes"
      rootPath="/reports"
    />
  )
}
