import { useEffect, useRef, useState } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/shadcn/tooltip'

type ChatAudioPlayerProps = {
  src: string
  canDownload?: boolean
  downloadHref?: string
  onDownload?: (event: { preventDefault: () => void }) => void
}

function formatAudioTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

function readFiniteDuration(audio: HTMLAudioElement): number {
  const value = audio.duration
  return Number.isFinite(value) && value > 0 ? value : 0
}

/** WebM/blob de MediaRecorder a menudo reporta Infinity hasta forzar un seek. */
function resolveDuration(audio: HTMLAudioElement, onResolved: (seconds: number) => void) {
  const known = readFiniteDuration(audio)
  if (known) {
    onResolved(known)
    return
  }

  const finish = () => {
    audio.removeEventListener('seeked', finish)
    audio.removeEventListener('durationchange', finish)
    const next = readFiniteDuration(audio)
    if (next) onResolved(next)
    if (audio.currentTime !== 0) audio.currentTime = 0
  }

  audio.addEventListener('seeked', finish)
  audio.addEventListener('durationchange', finish)
  try {
    audio.currentTime = Number.MAX_SAFE_INTEGER
  } catch {
    audio.removeEventListener('seeked', finish)
    audio.removeEventListener('durationchange', finish)
  }
}

export function ChatAudioPlayer({
  src,
  canDownload = false,
  downloadHref = '',
  onDownload,
}: ChatAudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    setPlaying(false)
    setCurrent(0)
    setDuration(0)
    setError('')
  }, [src])

  function toggle() {
    const audio = audioRef.current
    if (!audio || error) return
    if (audio.paused) {
      document.querySelectorAll('audio').forEach((other) => {
        if (other !== audio) other.pause()
      })
      void audio.play().catch((cause: unknown) => {
        if (audioRef.current !== audio || audio.getAttribute('src') !== src) return
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        setPlaying(false)
        setError('No se puede reproducir este audio en este navegador')
      })
      return
    }
    audio.pause()
  }

  if (error) {
    return (
      <div className="chat-audio">
        <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
          {error}
          {canDownload && onDownload ? ' · puedes descargarlo' : ''}
        </p>
        {canDownload && onDownload ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <a
                className="chat-audio__btn"
                href={downloadHref}
                aria-label="Descargar"
                onClick={onDownload}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="M12 4v12" />
                  <path d="m7 12 5 5 5-5" />
                  <path d="M5 20h14" />
                </svg>
              </a>
            </TooltipTrigger>
            <TooltipContent>Descargar</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    )
  }

  return (
    <div className="chat-audio">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onError={() => {
          setPlaying(false)
          setError('No se puede reproducir este audio en este navegador')
        }}
        onLoadedMetadata={(event) => {
          resolveDuration(event.currentTarget, setDuration)
        }}
        onDurationChange={(event) => {
          const next = readFiniteDuration(event.currentTarget)
          if (next) setDuration(next)
        }}
        onTimeUpdate={(event) => {
          const audio = event.currentTarget
          setCurrent(audio.currentTime)
          const next = readFiniteDuration(audio)
          if (next) setDuration((prev) => (prev === next ? prev : next))
        }}
        onEnded={(event) => {
          event.currentTarget.currentTime = 0
          setPlaying(false)
          setCurrent(0)
        }}
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="chat-audio__btn"
            aria-label={playing ? 'Pausar' : 'Reproducir'}
            onClick={toggle}
          >
            {playing ? (
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                <rect x="6" y="5" width="4" height="14" rx="1" />
                <rect x="14" y="5" width="4" height="14" rx="1" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                <path d="M8 5.5v13l11-6.5-11-6.5Z" />
              </svg>
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent>{playing ? 'Pausar' : 'Reproducir'}</TooltipContent>
      </Tooltip>
      <div className="chat-audio__track">
        <input
          className="chat-audio__bar"
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(current, duration || 0)}
          aria-label="Posición del audio"
          disabled={!duration}
          onChange={(event) => {
            const next = Number(event.target.value)
            const audio = audioRef.current
            if (audio) audio.currentTime = next
            setCurrent(next)
          }}
        />
        <span className="chat-audio__time">
          {formatAudioTime(current)} / {formatAudioTime(duration)}
        </span>
      </div>
      {canDownload && onDownload ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <a
              className="chat-audio__btn"
              href={downloadHref}
              aria-label="Descargar"
              onClick={onDownload}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M12 4v12" />
                <path d="m7 12 5 5 5-5" />
                <path d="M5 20h14" />
              </svg>
            </a>
          </TooltipTrigger>
          <TooltipContent>Descargar</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  )
}
