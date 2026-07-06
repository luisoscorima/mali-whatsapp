import * as React from 'react'
import { cn } from '@/lib/utils'

type MessageProps = React.ComponentProps<'div'> & {
  align?: 'start' | 'end'
}

function Message({ className, align = 'start', ...props }: MessageProps) {
  return (
    <div
      className={cn(
        'flex w-full',
        align === 'end' ? 'justify-end' : 'justify-start',
        className,
      )}
      {...props}
    />
  )
}

function MessageContent({
  className,
  align = 'start',
  ...props
}: React.ComponentProps<'div'> & { align?: 'start' | 'end' }) {
  return (
    <div
      className={cn(
        'flex min-w-0 max-w-[min(85%,32rem)] flex-col',
        align === 'end' ? 'items-end' : 'items-start',
        className,
      )}
      {...props}
    />
  )
}

function MessageFooter({
  className,
  align = 'start',
  ...props
}: React.ComponentProps<'div'> & { align?: 'start' | 'end' }) {
  return (
    <div
      className={cn(
        'mt-0.5 px-1 text-[0.68rem] text-muted',
        align === 'end' ? 'text-right' : 'text-left',
        className,
      )}
      {...props}
    />
  )
}

export { Message, MessageContent, MessageFooter }
