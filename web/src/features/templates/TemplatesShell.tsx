import { useParams } from 'react-router-dom'
import { MasterDetailShell } from '@/shared/ui/shell/MasterDetailShell'
import { TemplatesListSidebar } from './TemplatesListSidebar'

export function TemplatesShell() {
  const { id } = useParams()
  const selectedId = id && id !== 'new' && /^\d+$/.test(id) ? Number(id) : null

  return <MasterDetailShell sidebar={<TemplatesListSidebar selectedId={selectedId} />} />
}
