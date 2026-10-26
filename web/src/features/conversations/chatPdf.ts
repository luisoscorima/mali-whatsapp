import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
} from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { getToken } from '../../shared/api/token'

GlobalWorkerOptions.workerSrc = pdfWorker

export async function fetchPdfBytes(
  downloadUrl: string,
  signal: AbortSignal,
): Promise<Uint8Array> {
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
  if (!res.ok) throw new Error(await readDownloadError(res))
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (!looksLikePdf(bytes)) {
    throw new Error('El archivo descargado no es un PDF legible.')
  }
  return bytes
}

export function openPdf(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  return getDocument({ data: bytes }).promise
}

export function isCancelledPdfError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const name = 'name' in error ? String(error.name) : ''
  const message = 'message' in error ? String(error.message) : ''
  return (
    name === 'AbortError' ||
    name === 'RenderingCancelledException' ||
    /Rendering cancelled/i.test(message)
  )
}

function looksLikePdf(bytes: Uint8Array): boolean {
  const head = new TextDecoder().decode(bytes.subarray(0, 1024))
  return head.includes('%PDF')
}

async function readDownloadError(res: Response): Promise<string> {
  const text = await res.text()
  try {
    const body = JSON.parse(text) as { message?: unknown }
    if (typeof body.message === 'string' && body.message.trim()) {
      return body.message.trim().slice(0, 180)
    }
    if (Array.isArray(body.message)) {
      return body.message.map(String).join(', ').slice(0, 180)
    }
  } catch {
    /* respuesta que no es JSON */
  }
  return 'No se pudo descargar el PDF.'
}
