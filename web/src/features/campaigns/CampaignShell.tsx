import type { ReactNode } from 'react'
import { WaPageContents } from '@/shared/ui/shell/WaLayout'
import { WaMainPane, WaMainBody } from '@/shared/ui/shell/WaMainPane'
import { CampaignListSidebar } from '@/features/campaigns/CampaignListSidebar'

type CampaignShellProps = {
  selectedId?: number | null
  children: ReactNode
}

export function CampaignShell({ selectedId, children }: CampaignShellProps) {
  return (
    <WaPageContents>
      <CampaignListSidebar selectedId={selectedId} />
      <WaMainPane>
        <WaMainBody variant="form">{children}</WaMainBody>
      </WaMainPane>
    </WaPageContents>
  )
}
