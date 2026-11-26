import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BadRequestException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

/**
 * Meta: OGG Opus mono + voice:true. Subida con `audio/ogg; codecs=opus`.
 * El WebM de Chrome suele arrancar con PTS negativo; sin `aresample=first_pts=0`
 * Graph responde 131053 (mediaEngineStatus: 0).
 */
export const VOICE_NOTE_MIME = 'audio/ogg; codecs=opus';
const MAX_VOICE_NOTE_BYTES = 16 * 1024 * 1024;
const logger = new Logger('VoiceNote');

const inputExtensions = new Map([
  ['audio/webm', 'webm'],
  ['audio/ogg', 'ogg'],
  ['audio/mp4', 'm4a'],
]);

export async function prepareVoiceNote(file: {
  buffer: Buffer;
  mimetype: string;
}): Promise<{ buffer: Buffer; mimetype: string; originalname: string }> {
  const mime = file.mimetype.split(';')[0].trim().toLowerCase();
  const extension = inputExtensions.get(mime);
  if (!extension || !file.buffer.length) {
    throw new BadRequestException(
      'La grabación está vacía o el formato no es compatible.',
    );
  }
  if (file.buffer.length > MAX_VOICE_NOTE_BYTES) {
    throw new BadRequestException('La nota de voz supera los 16 MB.');
  }

  const buffer = await transcodeVoiceNote(file.buffer, extension);
  if (
    buffer.length < 4
    || buffer.subarray(0, 4).toString() !== 'OggS'
    || buffer.length > MAX_VOICE_NOTE_BYTES
  ) {
    throw new BadRequestException(
      'No se pudo procesar la grabación. Vuelve a grabarla.',
    );
  }
  logger.log(`Nota de voz ${mime} -> ogg ${buffer.length} bytes`);
  return { buffer, mimetype: VOICE_NOTE_MIME, originalname: 'nota-de-voz.ogg' };
}

async function transcodeVoiceNote(buffer: Buffer, extension: string): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'mali-voice-'));
  const inputPath = join(dir, `in.${extension}`);
  const outputPath = join(dir, 'nota-de-voz.ogg');
  try {
    await writeFile(inputPath, buffer);
    await new Promise<void>((resolve, reject) => {
      // first_pts=0 va justo después de -i (DeskcommCRM #4994).
      execFile(
        'ffmpeg',
        [
          '-hide_banner', '-loglevel', 'error', '-y', '-nostdin',
          '-i', inputPath,
          '-af', 'aresample=first_pts=0',
          '-vn', '-t', '301',
          '-c:a', 'libopus',
          '-ac', '1',
          '-ar', '48000',
          '-b:a', '32k',
          '-frame_duration', '20',
          '-f', 'ogg',
          outputPath,
        ],
        { timeout: 20_000, windowsHide: true },
        (error) => {
          if (error?.code === 'ENOENT') {
            reject(
              new ServiceUnavailableException(
                'El servidor no puede procesar notas de voz en este momento.',
              ),
            );
          } else if (error) {
            reject(
              new BadRequestException(
                'No se pudo procesar la grabación. Vuelve a grabarla.',
              ),
            );
          } else {
            resolve();
          }
        },
      );
    });
    return await readFile(outputPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
