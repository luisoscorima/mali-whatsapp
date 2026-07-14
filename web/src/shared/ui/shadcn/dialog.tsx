import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { cn } from '@/lib/utils'

function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root {...props} />
}

function DialogPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn('fixed inset-0 z-50 bg-black/45', className)}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  onCloseAutoFocus,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        className={cn(
          'campaign-drilldown-dialog fixed left-1/2 top-1/2 z-50 flex max-h-[min(88vh,720px)] w-[min(96vw,720px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-line bg-surface-strong shadow-lg',
          className,
        )}
        onCloseAutoFocus={(event) => {
          // ContextMenu/Dropdown can leave body pointer-events:none; Dialog may restore that.
          document.body.style.removeProperty('pointer-events')
          onCloseAutoFocus?.(event)
        }}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('border-b border-line px-5 py-4', className)} {...props} />
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn('text-base font-semibold text-ink', className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn('mt-1 text-sm text-muted', className)}
      {...props}
    />
  )
}

function DialogBody({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div className={cn('min-h-0 flex-1 overflow-y-auto px-5 py-4', className)} {...props} />
  )
}

function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3',
        className,
      )}
      {...props}
    />
  )
}

function DialogClose({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return (
    <DialogPrimitive.Close
      className={cn(
        'rounded-lg border border-line bg-surface px-3 py-1.5 text-sm hover:bg-accent-soft',
        className,
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
  DialogClose,
}
