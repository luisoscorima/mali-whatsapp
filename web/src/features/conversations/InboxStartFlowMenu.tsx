import { useEffect, useState } from 'react'
import { apiClient } from '../../shared/api'
import { notify } from '@/shared/notify'
import { Button } from '@/shared/ui/shadcn/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/ui/shadcn/dropdown-menu'

type FlowOption = {
  id: number
  name: string
  status: string
  trigger_payload: string
}

type InboxStartFlowMenuProps = {
  conversationId: number
  disabled?: boolean
  onStarted?: () => void
}

export function InboxStartFlowMenu({
  conversationId,
  disabled,
  onStarted,
}: InboxStartFlowMenuProps) {
  const [flows, setFlows] = useState<FlowOption[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    apiClient.get<FlowOption[]>('/api/flows').then((res) => {
      if (res.ok) {
        setFlows(res.data.filter((f) => f.status === 'active'))
      }
    })
  }, [])

  async function startFlow(flowId: number) {
    setBusy(true)
    const result = await apiClient.post<{ flow_id: number; flow_name: string }>(
      `/api/conversations/${conversationId}/start-flow`,
      { flow_id: flowId },
    )
    setBusy(false)
    if (!result.ok) {
      notify.error(result.error)
      return
    }
    notify.success(`Flujo «${result.data.flow_name}» iniciado`)
    onStarted?.()
  }

  if (flows.length === 0) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled || busy}
        >
          {busy ? 'Iniciando…' : 'Iniciar flujo'}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-w-xs">
        {flows.map((f) => (
          <DropdownMenuItem
            key={f.id}
            disabled={busy}
            onSelect={() => void startFlow(f.id)}
          >
            <span className="flex flex-col gap-0.5">
              <span>{f.name}</span>
              <span className="font-mono text-[10px] text-muted">
                {f.trigger_payload}
              </span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
