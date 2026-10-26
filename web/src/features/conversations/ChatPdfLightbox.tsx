import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentLoadingTask } from 'pdfjs-dist'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from '@/shared/ui/shadcn/dialog'
import { getToken } from '../../shared/api/token'

const MIN_ZOOM = 1
const MAX_ZOOM = 3
const ZOOM_STEP = 0.5

type ChatPdfLightboxProps = {
  open: boolean
  downloadUrl: string
  onOpenChange: (open: boolean) => void
}

async function fetchPdfBytes(downloadUrl: string, signal: AbortSignal): Promise<ArrayBuffer> {
  const headers: HeadersInit = {}
  const isAbsolute = /^https?:\/\//i.test(downloadUrl)
  if (!isAbsolute) {
    const token = getToken()
    if (token) headers.Authorization = `Bearer ${token}`
  }
  const res = await fetch(downloadUrl, {
    headers,
    credentials: isAbsolute ? 'omit' : 'include',
    signal,
  })
  if (!res.ok) throw new Error('PDF no disponible')
  return res.arrayBuffer()
}

export function ChatPdfLightbox({ open, downloadUrl, onOpenChange }: ChatPdfLightboxProps) {
  const [zoom, setZoom] = useState(MIN_ZOOM)
  const [status, setStatus] = useState('')
  const stageRef = useRef<HTMLDivElement>(null)
  const pagesRef = useRef<HTMLDivElement>(null)

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
    const stage = stageRef.current
    if (!open || !stage) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      changeZoom(event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP)
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [open])

  useEffect(() => {
    const host = pagesRef.current
    if (!open || !host) return

    let cancelled = false
    const controller = new AbortController()
    let loadingTask: PDFDocumentLoadingTask | undefined
    host.replaceChildren()
    setStatus('Cargando PDF…')

    void (async () => {
      try {
        const [{ getDocument, GlobalWorkerOptions }, { default: pdfWorker }] =
          await Promise.all([
            import('pdfjs-dist'),
            import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
          ])
        if (cancelled) return
        GlobalWorkerOptions.workerSrc = pdfWorker
        const data = await fetchPdfBytes(downloadUrl, controller.signal)
        if (cancelled) return
        loadingTask = getDocument({ data })
        const pdf = await loadingTask.promise
        if (cancelled) return

        const width = Math.min(host.clientWidth || 720, 920)
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
          const context = canvas.getContext('2d')
          if (!context) continue
          await page.render({ canvasContext: context, viewport, canvas }).promise
          if (cancelled) return
          host.appendChild(canvas)
        }
        if (!cancelled) setStatus('')
      } catch {
        if (!cancelled) setStatus('No se pudo mostrar el PDF.')
      } finally {
        void loadingTask?.destroy()
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
      void loadingTask?.destroy()
    }
  }, [open, downloadUrl])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="chat-image-lightbox inset-0 left-0 top-0 h-dvh w-screen max-h-none max-w-none translate-x-0 translate-y-0 rounded-none border-0 bg-transparent p-0 shadow-none"
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">PDF del chat</DialogTitle>
        <div
          ref={stageRef}
          className="chat-image-lightbox__stage"
          onClick={() => setOpen(false)}
        >
          <div
            ref={pagesRef}
            className="chat-pdf-lightbox__pages"
            style={{ width: `${92 * zoom}vw` }}
            onClick={(event) => event.stopPropagation()}
          />
          {status ? (
            <p className="chat-pdf-lightbox__status" role="status">
              {status}
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
