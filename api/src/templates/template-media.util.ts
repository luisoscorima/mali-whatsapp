import {
  classifyTemplateHeaderUpload,
  type TemplateHeaderFormat,
} from './whatsapp-meta.util';

function guessFilenameFromUrl(urlStr: string, fallbackExt: string): string {
  try {
    const parsed = new URL(urlStr);
    const fromPath = parsed.pathname.split('/').pop() || '';
    if (fromPath && fromPath !== '/') return decodeURIComponent(fromPath);
  } catch {
    /* */
  }
  return `template-header${fallbackExt || ''}`;
}

export type DownloadedTemplateMedia = {
  buffer: Buffer;
  mimeType: string;
  format: TemplateHeaderFormat;
  filename: string;
};

export async function downloadTemplateMediaFromUrl(
  urlStr: string,
): Promise<DownloadedTemplateMedia> {
  let parsed: URL;
  try {
    parsed = new URL(String(urlStr || '').trim());
  } catch {
    throw new Error('La URL del archivo de ejemplo no es válida.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(
      'La URL del archivo de ejemplo debe empezar con http:// o https://',
    );
  }

  let response: Response;
  try {
    response = await fetch(parsed.toString(), {
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new Error('No se pudo descargar el archivo de ejemplo.');
  }

  if (!response.ok) {
    throw new Error(
      `No se pudo descargar el archivo de ejemplo (HTTP ${response.status}).`,
    );
  }

  const mimeType = String(response.headers.get('content-type') || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const { format } = classifyTemplateHeaderUpload(mimeType, buffer.byteLength);
  const fallbackExt =
    format === 'IMAGE' ? '.jpg' : format === 'VIDEO' ? '.mp4' : '.pdf';
  return {
    buffer,
    mimeType,
    format,
    filename: guessFilenameFromUrl(parsed.toString(), fallbackExt),
  };
}
