import { Link } from 'react-router-dom'
import { WaEmptyPane } from '@/shared/ui/shell/WaEmptyPane'

export function FlowsEmptyPane() {
  return (
    <WaEmptyPane>
      <div className="inbox-empty-hint">
        <h2 className="inbox-empty-heading">Respuestas automatizadas</h2>
        <p className="inbox-empty-text">
          Configura flujos que se activan con el payload de un botón QUICK_REPLY o
          interactivo. Prioridad: flujo → fuera de horario → IA.
        </p>
        <Link to="/flows/new" className="small-btn primary mt-3 inline-block">
          Crear flujo
        </Link>
      </div>
    </WaEmptyPane>
  )
}
