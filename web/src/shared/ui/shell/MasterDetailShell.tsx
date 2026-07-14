import { Outlet, useOutletContext } from 'react-router-dom'
import type { ReactNode } from 'react'
import { WaPageContents } from '@/shared/ui/shell/WaLayout'
import { WaMainPane, WaMainBody } from '@/shared/ui/shell/WaMainPane'

type MasterDetailShellProps = {
  sidebar: ReactNode
}

export function MasterDetailShell({ sidebar }: MasterDetailShellProps) {
  const context = useOutletContext()
  return (
    <WaPageContents>
      {sidebar}
      <WaMainPane>
        <WaMainBody variant="form">
          <Outlet context={context} />
        </WaMainBody>
      </WaMainPane>
    </WaPageContents>
  )
}
