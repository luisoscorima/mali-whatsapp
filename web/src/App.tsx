import { createPortal } from 'react-dom'
import { Toaster } from 'sonner'
import { AppRouter } from './app/router'

export default function App() {
  return (
    <>
      <AppRouter />
      {createPortal(
        <Toaster
          theme="system"
          position="top-right"
          closeButton
          offset={16}
          gap={10}
          visibleToasts={4}
          style={{ zIndex: 500, pointerEvents: 'auto' }}
          toastOptions={{
            unstyled: true,
            classNames: {
              toast: 'mali-toast',
              title: 'mali-toast__title',
              description: 'mali-toast__desc',
              actionButton: 'mali-toast__action',
              cancelButton: 'mali-toast__cancel',
              closeButton: 'mali-toast__close',
              icon: 'mali-toast__icon',
              success: 'mali-toast--success',
              error: 'mali-toast--error',
              info: 'mali-toast--info',
              warning: 'mali-toast--warning',
            },
          }}
        />,
        document.body,
      )}
    </>
  )
}
