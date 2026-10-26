import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentLoadingTask, RenderTask } from 'pdfjs-dist'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/shadcn/tooltip'
import { fetchPdfBytes, isCancelledPdfError, openPdf } from './chatPdf'

const PREVIEW_MAX_HEIGHT = 180

type ChatPdfPreviewProps = {
  downloadUrl: string
}

export function ChatPdfPreview({ downloadUrl }: ChatPdfPreviewProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [status, setStatus] = useState('')
  const [failed, setFailed] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const host = hostRef.current
    if (!host || visible) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setVisible(true)
    })
    observer.observe(host)
    return () => observer.disconnect()
  }, [visible])

  useEffect(() => {
    if (!visible) return
    const canvas = canvasRef.current
    const host = hostRef.current
    if (!canvas || !host) return

    let cancelled = false
    const controller = new AbortController()
    let loadingTask: PDFDocumentLoadingTask | undefined
    let renderTask: RenderTask | undefined
    setFailed(false)
    setReady(false)
    setStatus('Cargando vista previa…')

    void (async () => {
      try {
        const bytes = await fetchPdfBytes(downloadUrl, controller.signal)
        if (cancelled) return
        const pdf = await openPdf(bytes)
        loadingTask = pdf.loadingTask
        if (cancelled) {
          void loadingTask.destroy()
          return
        }

        const page = await pdf.getPage(1)
        if (cancelled) return

        const width = host.clientWidth || 260
        const baseViewport = page.getViewport({ scale: 1 })
        let scale = width / baseViewport.width
        let viewport = page.getViewport({ scale })
        if (viewport.height > PREVIEW_MAX_HEIGHT) {
          scale = PREVIEW_MAX_HEIGHT / baseViewport.height
          viewport = page.getViewport({ scale })
        }

        canvas.width = viewport.width
        canvas.height = viewport.height
        renderTask = page.render({ canvas, viewport })
        await renderTask.promise
        if (!cancelled) {
          setReady(true)
          setStatus('')
        }
      } catch (error) {
        if (cancelled || isCancelledPdfError(error)) return
        setReady(false)
        setFailed(true)
        setStatus(error instanceof Error ? error.message : 'Vista previa no disponible.')
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
      renderTask?.cancel()
      void loadingTask?.destroy()
    }
  }, [visible, downloadUrl, attempt])

  return (
    <div ref={hostRef} className="chat-pdf-preview">
      {status ? (
        <p role="status" className="chat-pdf-preview__status">
          <span>{status}</span>
          {failed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="chat-pdf-preview__retry"
                  aria-label="Reintentar"
                  onClick={() => setAttempt((current) => current + 1)}
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                    <path d="M21 12a9 9 0 1 1-2.6-6.3" />
                    <path d="M21 3v6h-6" />
                  </svg>
                </button>
              </TooltipTrigger>
              <TooltipContent>Reintentar</TooltipContent>
            </Tooltip>
          ) : null}
        </p>
      ) : null}
      <canvas
        ref={canvasRef}
        hidden={!ready}
        className="chat-msg-media chat-msg-media--pdf"
      />
    </div>
  )
}
