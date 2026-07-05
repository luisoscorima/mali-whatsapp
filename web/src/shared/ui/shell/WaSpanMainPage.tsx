import type { ReactNode } from 'react'
import { WaPageContents } from './WaLayout'
import { WaMainPane, WaMainHeader, WaMainBody } from './WaMainPane'
import { WaEmptyPane } from './WaEmptyPane'

type WaSpanMainPageProps = {
  title?: string
  children: ReactNode
  variant?: 'center' | 'history'
}

export function WaSpanMainPage({
  title,
  children,
  variant = 'history',
}: WaSpanMainPageProps) {
  return (
    <WaPageContents>
      <WaMainPane spanColumns>
        {title ? (
          <>
            <WaMainHeader>
              <h1 className="inbox-chat-heading">{title}</h1>
            </WaMainHeader>
            <WaMainBody variant="form">{children}</WaMainBody>
          </>
        ) : (
          <WaEmptyPane variant={variant}>{children}</WaEmptyPane>
        )}
      </WaMainPane>
    </WaPageContents>
  )
}
