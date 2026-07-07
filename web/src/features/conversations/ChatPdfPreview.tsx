import { useEffect, useRef, useState } from 'react'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'

GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

const PREVIEW_MAX_HEIGHT = 180

type ChatPdfPreviewProps = {
  url: string
}

export function ChatPdfPreview({ url }: ChatPdfPreviewProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '120px' },
    )
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return
    const canvas = canvasRef.current
    const host = hostRef.current
    if (!canvas || !host) return

    let cancelled = false
    void (async () => {
      try {
        const pdf = await getDocument({ url, withCredentials: true }).promise
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
      } catch {
        // Sin vista previa: Abrir/Descargar siguen disponibles.
      }
    })()

    return () => {
      cancelled = true
    }
  }, [visible, url])

  return (
    <div ref={hostRef} className="chat-pdf-preview" aria-hidden="true">
      <canvas ref={canvasRef} className="chat-msg-media chat-msg-media--pdf" />
    </div>
  )
}
