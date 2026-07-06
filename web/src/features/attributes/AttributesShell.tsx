import { useParams } from 'react-router-dom'
import { MasterDetailShell } from '@/shared/ui/shell/MasterDetailShell'
import { AttributesListSidebar } from './AttributesListSidebar'

export function AttributesShell() {
  const { id } = useParams()
  const selectedId = id && id !== 'new' && /^\d+$/.test(id) ? Number(id) : null

  return <MasterDetailShell sidebar={<AttributesListSidebar selectedId={selectedId} />} />
}
