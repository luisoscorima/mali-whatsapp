import { useEffect, useRef, useState } from 'react'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { getToken } from '../../shared/api/token'

GlobalWorkerOptions.workerSrc = pdfWorker

const PREVIEW_MAX_HEIGHT = 180

type ChatPdfPreviewProps = {
  downloadUrl: string
}

export function ChatPdfPreview({ downloadUrl }: ChatPdfPreviewProps) {
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
        const headers: HeadersInit = {}
        const isAbsolute = /^https?:\/\//i.test(downloadUrl)
        if (!isAbsolute) {
          const token = getToken()
          if (token) headers.Authorization = `Bearer ${token}`
        }

        const res = await fetch(downloadUrl, {
          headers,
          credentials: isAbsolute ? 'omit' : 'include',
        })
        if (!res.ok || cancelled) return

        const data = await res.arrayBuffer()
        if (cancelled) return

        const pdf = await getDocument({ data }).promise
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
  }, [visible, downloadUrl])

  return (
    <div ref={hostRef} className="chat-pdf-preview" aria-hidden="true">
      <canvas ref={canvasRef} className="chat-msg-media chat-msg-media--pdf" />
    </div>
  )
}
