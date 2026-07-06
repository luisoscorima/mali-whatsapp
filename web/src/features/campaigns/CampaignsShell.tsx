import { useParams } from 'react-router-dom'
import { MasterDetailShell } from '@/shared/ui/shell/MasterDetailShell'
import { CampaignListSidebar } from './CampaignListSidebar'

export function CampaignsShell() {
  const { id } = useParams()
  const selectedId =
    id && id !== 'new' && /^\d+$/.test(id) ? Number(id) : null

  return (
    <MasterDetailShell
      sidebar={<CampaignListSidebar selectedId={selectedId} />}
    />
  )
}
