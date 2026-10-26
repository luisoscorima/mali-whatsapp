import { useRef, useState } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/shadcn/tooltip'

type ChatAudioPlayerProps = {
  src: string
  canDownload: boolean
  downloadHref: string
  onDownload: (event: { preventDefault: () => void }) => void
}

function formatAudioTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

export function ChatAudioPlayer({
  src,
  canDownload,
  downloadHref,
  onDownload,
}: ChatAudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)

  function toggle() {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) {
      document.querySelectorAll('audio').forEach((other) => {
        if (other !== audio) other.pause()
      })
      void audio.play()
      return
    }
    audio.pause()
  }

  return (
    <div className="chat-audio">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
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
      {canDownload ? (
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
