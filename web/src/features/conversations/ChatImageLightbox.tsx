import { useEffect, useRef, useState } from 'react'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from '@/shared/ui/shadcn/dialog'

const MIN_ZOOM = 1
const MAX_ZOOM = 3
const ZOOM_STEP = 0.5

type ChatImageLightboxProps = {
  open: boolean
  src: string
  onOpenChange: (open: boolean) => void
}

export function ChatImageLightbox({ open, src, onOpenChange }: ChatImageLightboxProps) {
  const [zoom, setZoom] = useState(MIN_ZOOM)
  const stageRef = useRef<HTMLDivElement>(null)

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
      setZoom((current) =>
        Math.min(
          MAX_ZOOM,
          Math.max(
            MIN_ZOOM,
            Math.round((current + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP)) * 10) / 10,
          ),
        ),
      )
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [open])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="chat-image-lightbox inset-0 left-0 top-0 h-dvh w-screen max-h-none max-w-none translate-x-0 translate-y-0 rounded-none border-0 bg-transparent p-0 shadow-none"
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">Imagen del chat</DialogTitle>
        <div
          ref={stageRef}
          className="chat-image-lightbox__stage"
          onClick={() => setOpen(false)}
        >
          <img
            className="chat-image-lightbox__img"
            src={src}
            alt=""
            style={{
              maxWidth: `${92 * zoom}vw`,
              maxHeight: `${88 * zoom}vh`,
            }}
            onClick={(event) => event.stopPropagation()}
          />
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
