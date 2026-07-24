import { useParams } from 'react-router-dom'
import { MasterDetailShell } from '@/shared/ui/shell/MasterDetailShell'
import { FlowsListSidebar } from './FlowsListSidebar'

export function FlowsShell() {
  const { id } = useParams()
  const selectedId = id && id !== 'new' && /^\d+$/.test(id) ? Number(id) : null

  return <MasterDetailShell sidebar={<FlowsListSidebar selectedId={selectedId} />} />
}
