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

function MessageContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('min-w-0 max-w-full', className)} {...props} />
}

function MessageFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('mt-0.5 px-1 text-[0.68rem] text-muted', className)}
      {...props}
    />
  )
}

export { Message, MessageContent, MessageFooter }
