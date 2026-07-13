import { createPortal } from 'react-dom'
import { Toaster } from 'sonner'
import { AppRouter } from './app/router'

export default function App() {
  return (
    <>
      <AppRouter />
      {createPortal(
        <Toaster
          position="top-right"
          closeButton
          style={{ zIndex: 200, pointerEvents: 'auto' }}
          toastOptions={{
            classNames: {
              toast:
                'border border-line bg-surface-strong text-ink shadow-md !font-[inherit]',
              success: '!border-accent/30 !bg-accent-soft !text-accent',
              error: '!border-bad/30 !bg-bad/10 !text-bad',
              title: '!text-sm !font-medium',
              description: '!text-sm',
              closeButton: '!bg-surface !border-line !text-ink',
            },
          }}
        />,
        document.body,
      )}
    </>
  )
}
