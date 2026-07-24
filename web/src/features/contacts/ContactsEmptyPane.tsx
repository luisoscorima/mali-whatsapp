import { WaEmptyPane } from '@/shared/ui/shell/WaEmptyPane'

export function ContactsEmptyPane() {
  return (
    <WaEmptyPane
      heading="Contactos"
      text="Selecciona un contacto de la lista o usa el botón + para añadir uno nuevo, importar o exportar."
    />
  )
}
