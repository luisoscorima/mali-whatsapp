import { useParams } from 'react-router-dom'
import { MasterDetailShell } from '@/shared/ui/shell/MasterDetailShell'
import { SegmentsListSidebar } from './SegmentsListSidebar'

export function SegmentsShell() {
  const { id } = useParams()
  const selectedId = id && id !== 'new' && /^\d+$/.test(id) ? Number(id) : null

  return <MasterDetailShell sidebar={<SegmentsListSidebar selectedId={selectedId} />} />
}
