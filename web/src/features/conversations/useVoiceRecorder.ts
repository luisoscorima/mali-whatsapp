import { useCallback, useEffect, useRef, useState } from 'react'

const MAX_DURATION_MS = 5 * 60 * 1000
const MAX_BYTES = 16 * 1024 * 1024
const RECORDING_TYPES = [
  'audio/webm;codecs=opus',
  'audio/ogg;codecs=opus',
  'audio/mp4',
]
const EXTENSIONS: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
}

type Capture = {
  stream?: MediaStream
  recorder?: MediaRecorder
  timer?: number
  limit?: number
}

type Status = 'idle' | 'requesting' | 'recording' | 'finishing'

function openMicrophone() {
  const shared = { echoCancellation: true, noiseSuppression: true }
  return navigator.mediaDevices.getUserMedia({
    audio: { ...shared, channelCount: { exact: 1 } },
  }).catch((reason: unknown) => {
    if (reason instanceof DOMException && reason.name === 'OverconstrainedError') {
      return navigator.mediaDevices.getUserMedia({
        audio: { ...shared, channelCount: { ideal: 1 } },
      })
    }
    throw reason
  })
}

export function useVoiceRecorder(enabled: boolean, onRecorded: (file: File) => void) {
  const captureRef = useRef<Capture | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [error, setError] = useState('')

  const releaseCapture = useCallback(() => {
    const capture = captureRef.current
    captureRef.current = null
    if (!capture) return
    window.clearInterval(capture.timer)
    window.clearTimeout(capture.limit)
    if (capture.recorder?.state === 'recording') capture.recorder.stop()
    capture.stream?.getTracks().forEach((track) => track.stop())
  }, [])

  useEffect(() => {
    if (!enabled) {
      setStatus('idle')
      setError('')
    }
    return releaseCapture
  }, [enabled, releaseCapture])

  function cancel() {
    releaseCapture()
    setStatus('idle')
  }

  function finish() {
    const capture = captureRef.current
    if (capture?.recorder?.state !== 'recording') return
    window.clearInterval(capture.timer)
    window.clearTimeout(capture.limit)
    setStatus('finishing')
    capture.recorder.stop()
  }

  async function start() {
    if (!enabled || captureRef.current) return
    const mimeType = typeof MediaRecorder === 'undefined'
      ? undefined
      : RECORDING_TYPES.find((type) => MediaRecorder.isTypeSupported(type))
    if (!navigator.mediaDevices?.getUserMedia || !mimeType) {
      setError('La grabación requiere un navegador compatible y una conexión HTTPS. Puedes adjuntar un audio.')
      return
    }

    const capture: Capture = {}
    captureRef.current = capture
    setElapsedSeconds(0)
    setError('')
    setStatus('requesting')
    try {
      const stream = await openMicrophone()
      if (captureRef.current !== capture) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }

      capture.stream = stream
      const recorder = new MediaRecorder(stream, { mimeType })
      capture.recorder = recorder
      const chunks: Blob[] = []
      let bytes = 0
      recorder.ondataavailable = ({ data }) => {
        if (captureRef.current !== capture || !data.size) return
        bytes += data.size
        if (bytes > MAX_BYTES) {
          cancel()
          setError('La grabación superó los 16 MB. Intenta con una nota más corta.')
          return
        }
        chunks.push(data)
      }
      recorder.onerror = () => {
        if (captureRef.current !== capture) return
        cancel()
        setError('El micrófono dejó de grabar. Intenta de nuevo.')
      }
      recorder.onstop = () => {
        if (captureRef.current !== capture) return
        const type = chunks[0]?.type || recorder.mimeType || mimeType
        cancel()
        const extension = EXTENSIONS[type.split(';')[0].trim().toLowerCase()]
        if (!chunks.length || !extension) {
          setError('No se capturó audio. Comprueba el micrófono e intenta de nuevo.')
          return
        }
        onRecorded(new File(chunks, `nota-de-voz.${extension}`, { type }))
      }
      recorder.start(1000)
      const startedAt = Date.now()
      capture.timer = window.setInterval(() => {
        setElapsedSeconds(Math.floor(Math.min(MAX_DURATION_MS, Date.now() - startedAt) / 1000))
      }, 250)
      capture.limit = window.setTimeout(finish, MAX_DURATION_MS)
      setStatus('recording')
    } catch (reason) {
      if (captureRef.current !== capture) return
      cancel()
      setError(reason instanceof DOMException && reason.name === 'NotAllowedError'
        ? 'El navegador bloqueó el micrófono. Permite el acceso para grabar una nota de voz.'
        : 'No se pudo iniciar el micrófono. Comprueba que esté conectado y disponible.')
    }
  }

  return { status, elapsedSeconds, error, start, finish, cancel }
}
