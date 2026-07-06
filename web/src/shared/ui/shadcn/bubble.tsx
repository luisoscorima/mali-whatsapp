import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const bubbleVariants = cva(
  'max-w-[min(85%,32rem)] rounded-xl border px-3 py-2 text-sm shadow-sm',
  {
    variants: {
      variant: {
        default:
          'border-[var(--wa-bubble-out-border)] bg-[var(--wa-bubble-out)] text-ink',
        secondary:
          'border-[var(--wa-bubble-in-border)] bg-[var(--wa-bubble-in)] text-ink',
        muted: 'border-line bg-surface-strong text-ink',
        ghost: 'border-transparent bg-transparent shadow-none',
        destructive: 'border-bad/30 bg-bad/10 text-ink',
      },
      align: {
        start: 'self-start',
        end: 'self-end',
      },
    },
    defaultVariants: {
      variant: 'secondary',
      align: 'start',
    },
  },
)

type BubbleProps = React.ComponentProps<'div'> &
  VariantProps<typeof bubbleVariants> & {
    dashed?: boolean
  }

function Bubble({ className, variant, align, dashed, ...props }: BubbleProps) {
  return (
    <div
      className={cn(
        bubbleVariants({ variant, align }),
        dashed ? 'border-dashed' : null,
        className,
      )}
      {...props}
    />
  )
}

function BubbleContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('min-w-0 break-words', className)} {...props} />
}

export { Bubble, BubbleContent, bubbleVariants }
