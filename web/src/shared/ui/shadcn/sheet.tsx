import * as React from 'react'
import * as SheetPrimitive from '@radix-ui/react-dialog'
import { cn } from '@/lib/utils'

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root {...props} />
}

function SheetTrigger({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger {...props} />
}

function SheetClose({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return (
    <SheetPrimitive.Close
      className={cn(
        'rounded-lg border border-line bg-surface px-3 py-1.5 text-sm hover:bg-accent-soft',
        className,
      )}
      {...props}
    />
  )
}

function SheetPortal({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal {...props} />
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      className={cn('fixed inset-0 z-50 bg-black/40', className)}
      {...props}
    />
  )
}

function SheetContent({
  className,
  children,
  side = 'right',
  onCloseAutoFocus,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: 'left' | 'right'
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        className={cn(
          'fixed z-50 flex flex-col bg-wa-list-bg shadow-lg transition ease-in-out',
          side === 'left' &&
            'inset-y-0 left-0 h-full w-[min(100%,22rem)] border-r border-line',
          side === 'right' &&
            'inset-y-0 right-0 h-full w-[min(100%,32rem)] border-l border-line',
          className,
        )}
        onCloseAutoFocus={(event) => {
          document.body.style.removeProperty('pointer-events')
          onCloseAutoFocus?.(event)
        }}
        {...props}
      >
        {children}
      </SheetPrimitive.Content>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div className={cn('shrink-0 border-b border-line px-5 py-4', className)} {...props} />
  )
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      className={cn('text-base font-semibold text-ink', className)}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      className={cn('mt-1 text-sm text-muted', className)}
      {...props}
    />
  )
}

function SheetBody({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div className={cn('min-h-0 flex-1 overflow-y-auto px-5 py-4', className)} {...props} />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3',
        className,
      )}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetBody,
  SheetFooter,
}
