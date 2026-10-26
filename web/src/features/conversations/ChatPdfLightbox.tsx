import { useEffect, useState } from 'react'
import type { PDFDocumentLoadingTask, RenderTask } from 'pdfjs-dist'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from '@/shared/ui/shadcn/dialog'
import { fetchPdfBytes, isCancelledPdfError, openPdf } from './chatPdf'

const MIN_ZOOM = 1
const MAX_ZOOM = 3
const ZOOM_STEP = 0.5

type ChatPdfLightboxProps = {
  open: boolean
  downloadUrl: string
  onOpenChange: (open: boolean) => void
}

export function ChatPdfLightbox({ open, downloadUrl, onOpenChange }: ChatPdfLightboxProps) {
  const [zoom, setZoom] = useState(MIN_ZOOM)
  const [attempt, setAttempt] = useState(0)
  const [status, setStatus] = useState('')
  const [failed, setFailed] = useState(false)
  const [stageEl, setStageEl] = useState<HTMLDivElement | null>(null)
  const [pagesEl, setPagesEl] = useState<HTMLDivElement | null>(null)

  function setOpen(next: boolean) {
    if (!next) setZoom(MIN_ZOOM)
    onOpenChange(next)
  }

  function changeZoom(delta: number) {
    setZoom((current) =>
      Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round((current + delta) * 10) / 10)),
    )
  }

  useEffect(() => {
    if (!open || !stageEl) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      changeZoom(event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP)
    }
    stageEl.addEventListener('wheel', onWheel, { passive: false })
    return () => stageEl.removeEventListener('wheel', onWheel)
  }, [open, stageEl])

  useEffect(() => {
    if (!open || !pagesEl) return

    let cancelled = false
    const controller = new AbortController()
    let loadingTask: PDFDocumentLoadingTask | undefined
    const renderTasks: RenderTask[] = []
    pagesEl.replaceChildren()
    setFailed(false)
    setStatus('Cargando PDF…')

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

        const width = Math.min(pagesEl.clientWidth || 720, 920)
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          if (cancelled) return
          const page = await pdf.getPage(pageNumber)
          const base = page.getViewport({ scale: 1 })
          const viewport = page.getViewport({
            scale: (width / base.width) * pixelRatio,
          })
          const canvas = document.createElement('canvas')
          canvas.width = viewport.width
          canvas.height = viewport.height
          const renderTask = page.render({ canvas, viewport })
          renderTasks.push(renderTask)
          await renderTask.promise
          if (cancelled) return
          pagesEl.appendChild(canvas)
        }
        if (!cancelled) setStatus('')
      } catch (error) {
        if (cancelled || isCancelledPdfError(error)) return
        setFailed(true)
        setStatus(error instanceof Error ? error.message : 'No se pudo mostrar el PDF.')
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
      for (const renderTask of renderTasks) renderTask.cancel()
      void loadingTask?.destroy()
    }
  }, [open, downloadUrl, attempt, pagesEl])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="chat-image-lightbox inset-0 left-0 top-0 h-dvh w-screen max-h-none max-w-none translate-x-0 translate-y-0 rounded-none border-0 bg-transparent p-0 shadow-none"
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">PDF del chat</DialogTitle>
        <div
          ref={setStageEl}
          className="chat-image-lightbox__stage"
          onClick={() => setOpen(false)}
        >
          <div
            ref={setPagesEl}
            className="chat-pdf-lightbox__pages"
            style={{ width: `${92 * zoom}vw` }}
            onClick={(event) => event.stopPropagation()}
          />
          {status ? (
            <p
              className="chat-pdf-lightbox__status"
              role="status"
              onClick={(event) => event.stopPropagation()}
            >
              <span>{status}</span>
              {failed ? (
                <button type="button" onClick={() => setAttempt((current) => current + 1)}>
                  Reintentar
                </button>
              ) : null}
            </p>
          ) : null}
        </div>
        <DialogClose className="chat-image-lightbox__close" aria-label="Cerrar">
          ×
        </DialogClose>
        <div className="chat-image-lightbox__zoom" onClick={(event) => event.stopPropagation()}>
          <button type="button" onClick={() => changeZoom(-ZOOM_STEP)} disabled={zoom <= MIN_ZOOM}>
            −
          </button>
          <button type="button" onClick={() => setZoom(MIN_ZOOM)}>
            {Math.round(zoom * 100)}%
          </button>
          <button type="button" onClick={() => changeZoom(ZOOM_STEP)} disabled={zoom >= MAX_ZOOM}>
            +
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
