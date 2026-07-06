import { useParams } from 'react-router-dom'
import { MasterDetailShell } from '@/shared/ui/shell/MasterDetailShell'
import { MetaAdsListSidebar } from './MetaAdsListSidebar'

export function MetaAdsShell() {
  const { id } = useParams()
  const selectedId = id && /^\d+$/.test(id) ? Number(id) : null

  return <MasterDetailShell sidebar={<MetaAdsListSidebar selectedId={selectedId} />} />
}
