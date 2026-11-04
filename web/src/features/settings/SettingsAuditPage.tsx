import { AuditLogPanel } from '../reports/AuditLogPanel'

export function SettingsAuditPage() {
  return (
    <AuditLogPanel
      title="Bitácora del área"
      intro="Eventos de auditoría limitados a su área."
      optionsPath="/api/reports/audit-logs/options"
      listPath="/api/reports/audit-logs"
      exportPath="/api/reports/audit-logs/export"
    />
  )
}
