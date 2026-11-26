import { execFile } from 'node:child_process';
import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';

export const VOICE_NOTE_MIME = 'audio/ogg; codecs=opus';
const MAX_VOICE_NOTE_BYTES = 16 * 1024 * 1024;

const inputFormats = new Map([
  ['audio/webm', 'matroska'],
  ['audio/ogg', 'ogg'],
  ['audio/mp4', 'mov'],
]);

export async function prepareVoiceNote(file: {
  buffer: Buffer;
  mimetype: string;
}): Promise<{ buffer: Buffer; mimetype: string; originalname: string }> {
  const mime = file.mimetype.split(';')[0].trim().toLowerCase();
  const format = inputFormats.get(mime);
  if (!format || !file.buffer.length) {
    throw new BadRequestException(
      'La grabación está vacía o el formato no es compatible.',
    );
  }
  if (file.buffer.length > MAX_VOICE_NOTE_BYTES) {
    throw new BadRequestException('La nota de voz supera los 16 MB.');
  }

  const buffer = await new Promise<Buffer>((resolve, reject) => {
    const ffmpeg = execFile(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-xerror',
        '-abort_on',
        'empty_output',
        '-nostdin',
        '-protocol_whitelist',
        'pipe',
        '-threads',
        '1',
        '-f',
        format,
        '-i',
        'pipe:0',
        '-map',
        '0:a:0',
        '-map_metadata',
        '-1',
        '-t',
        '301',
        '-ac',
        '1',
        '-c:a',
        'libopus',
        '-threads',
        '1',
        '-b:a',
        '32k',
        '-application',
        'voip',
        '-f',
        'ogg',
        'pipe:1',
      ],
      {
        encoding: 'buffer',
        timeout: 20_000,
        maxBuffer: MAX_VOICE_NOTE_BYTES,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error?.code === 'ENOENT') {
          reject(
            new ServiceUnavailableException(
              'El servidor no puede procesar notas de voz en este momento.',
            ),
          );
        } else if (error || !stdout.length) {
          reject(
            new BadRequestException(
              'No se pudo procesar la grabación. Vuelve a grabarla.',
            ),
          );
        } else {
          resolve(stdout);
        }
      },
    );
    // FFmpeg can close its input early if the file is invalid or exceeds the duration limit.
    ffmpeg.stdin?.on('error', () => {});
    ffmpeg.stdin?.end(file.buffer);
  });

  return { buffer, mimetype: VOICE_NOTE_MIME, originalname: 'nota-de-voz.ogg' };
}
