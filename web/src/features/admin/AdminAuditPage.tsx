import { AuditLogPanel } from '../reports/AuditLogPanel'

export function AdminAuditPage() {
  return (
    <AuditLogPanel
      title="Bitácora global"
      intro="Todos los eventos del sistema (solo master)."
      optionsPath="/api/admin/audit-logs/options"
      listPath="/api/admin/audit-logs"
      exportPath="/api/admin/audit-logs/export"
    />
  )
}
