import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';

export const VOICE_NOTE_MIME = 'audio/ogg; codecs=opus';
const MAX_VOICE_NOTE_BYTES = 16 * 1024 * 1024;

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

  const dir = await mkdtemp(join(tmpdir(), 'mali-voice-'));
  const inputPath = join(dir, `in.${extension}`);
  const outputPath = join(dir, 'nota-de-voz.ogg');
  try {
    await writeFile(inputPath, file.buffer);
    await transcodeVoiceNote(inputPath, outputPath);
    const buffer = await readFile(outputPath);
    if (!buffer.length || buffer.length > MAX_VOICE_NOTE_BYTES) {
      throw new BadRequestException(
        'No se pudo procesar la grabación. Vuelve a grabarla.',
      );
    }
    return { buffer, mimetype: VOICE_NOTE_MIME, originalname: 'nota-de-voz.ogg' };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function transcodeVoiceNote(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-nostdin',
        '-i',
        inputPath,
        '-map',
        '0:a:0',
        '-map_metadata',
        '-1',
        '-vn',
        '-t',
        '301',
        '-ac',
        '1',
        '-ar',
        '48000',
        '-c:a',
        'libopus',
        '-b:a',
        '32k',
        '-application',
        'voip',
        '-frame_duration',
        '20',
        '-f',
        'ogg',
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
}
