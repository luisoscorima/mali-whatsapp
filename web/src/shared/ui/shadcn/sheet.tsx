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
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close {...props} />
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
  side = 'left',
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
          side === 'left' && 'inset-y-0 left-0 h-full w-[min(100%,22rem)] border-r border-line',
          side === 'right' && 'inset-y-0 right-0 h-full w-[min(100%,22rem)] border-l border-line',
          className,
        )}
        {...props}
      >
        {children}
      </SheetPrimitive.Content>
    </SheetPortal>
  )
}

export { Sheet, SheetTrigger, SheetClose, SheetContent }
