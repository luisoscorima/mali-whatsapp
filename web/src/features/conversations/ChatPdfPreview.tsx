import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentLoadingTask } from 'pdfjs-dist'
import { getToken } from '../../shared/api/token'

const PREVIEW_MAX_HEIGHT = 180

type ChatPdfPreviewProps = {
  downloadUrl: string
}

export function ChatPdfPreview({ downloadUrl }: ChatPdfPreviewProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = useState(false)
  const [status, setStatus] = useState('')

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
    setStatus('Cargando vista previa…')
    void (async () => {
      try {
        const [{ getDocument, GlobalWorkerOptions }, { default: pdfWorker }] =
          await Promise.all([
            import('pdfjs-dist'),
            import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
          ])
        if (cancelled) return
        GlobalWorkerOptions.workerSrc = pdfWorker
        const headers: HeadersInit = {}
        const isAbsolute = /^https?:\/\//i.test(downloadUrl)
        if (!isAbsolute) {
          const token = getToken()
          if (token) headers.Authorization = `Bearer ${token}`
        }

        const res = await fetch(downloadUrl, {
          headers,
          credentials: isAbsolute ? 'omit' : 'include',
          signal: controller.signal,
        })
        if (cancelled) return
        if (!res.ok) throw new Error('PDF no disponible')

        const data = await res.arrayBuffer()
        if (cancelled) return

        loadingTask = getDocument({ data })
        const pdf = await loadingTask.promise
        if (cancelled) return

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

        const context = canvas.getContext('2d')
        if (!context || cancelled) return

        canvas.width = viewport.width
        canvas.height = viewport.height
        await page.render({ canvasContext: context, viewport, canvas }).promise
        if (!cancelled) setStatus('')
      } catch {
        if (!cancelled)
          setStatus('Vista previa no disponible.')
      } finally {
        void loadingTask?.destroy()
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
      void loadingTask?.destroy()
    }
  }, [visible, downloadUrl])

  return (
    <div ref={hostRef} className="chat-pdf-preview">
      {status ? (
        <p role="status" className="text-xs text-muted">
          {status}
        </p>
      ) : null}
      <canvas
        ref={canvasRef}
        hidden={!visible}
        className="chat-msg-media chat-msg-media--pdf"
      />
    </div>
  )
}
