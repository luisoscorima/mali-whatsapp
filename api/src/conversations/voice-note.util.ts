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
 * Safari < 18.4 no reproduce Ogg: la bandeja usa AAC/MP4 como vista previa.
 */
export const VOICE_NOTE_MIME = 'audio/ogg; codecs=opus';
export const VOICE_PLAYBACK_MIME = 'audio/mp4';
const MAX_VOICE_NOTE_BYTES = 16 * 1024 * 1024;
const logger = new Logger('VoiceNote');

const inputExtensions = new Map([
  ['audio/webm', 'webm'],
  ['audio/ogg', 'ogg'],
  ['audio/mp4', 'm4a'],
  ['audio/x-m4a', 'm4a'],
  ['audio/m4a', 'm4a'],
]);

export type PreparedVoiceNote = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  /** Copia AAC/MP4 para reproducir en la bandeja (Safari < 18.4). */
  playback: { buffer: Buffer; mimetype: string };
};

export async function prepareVoiceNote(file: {
  buffer: Buffer;
  mimetype: string;
}): Promise<PreparedVoiceNote> {
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

  const { ogg, playback } = await transcodeVoiceNote(file.buffer, extension);
  if (
    ogg.length < 4
    || ogg.subarray(0, 4).toString() !== 'OggS'
    || ogg.length > MAX_VOICE_NOTE_BYTES
  ) {
    throw new BadRequestException(
      'No se pudo procesar la grabación. Vuelve a grabarla.',
    );
  }
  if (!playback.length || playback.length > MAX_VOICE_NOTE_BYTES) {
    throw new BadRequestException(
      'No se pudo procesar la grabación. Vuelve a grabarla.',
    );
  }
  logger.log(
    `Nota de voz ${mime} -> ogg ${ogg.length} bytes, playback ${playback.length} bytes`,
  );
  return {
    buffer: ogg,
    mimetype: VOICE_NOTE_MIME,
    originalname: 'nota-de-voz.ogg',
    playback: { buffer: playback, mimetype: VOICE_PLAYBACK_MIME },
  };
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    execFile(
      'ffmpeg',
      args,
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

async function transcodeVoiceNote(
  buffer: Buffer,
  extension: string,
): Promise<{ ogg: Buffer; playback: Buffer }> {
  const dir = await mkdtemp(join(tmpdir(), 'mali-voice-'));
  const inputPath = join(dir, `in.${extension}`);
  const oggPath = join(dir, 'nota-de-voz.ogg');
  const m4aPath = join(dir, 'nota-de-voz.m4a');
  try {
    await writeFile(inputPath, buffer);
    const audioOptions = [
      '-map', '0:a:0', '-af', 'aresample=first_pts=0',
      '-vn', '-t', '301', '-ac', '1', '-ar', '48000',
    ];
    await runFfmpeg([
      '-hide_banner', '-loglevel', 'error', '-y', '-nostdin',
      '-i', inputPath,
      ...audioOptions,
      '-c:a', 'libopus',
      '-b:a', '32k',
      '-frame_duration', '20',
      '-f', 'ogg',
      oggPath,
      ...audioOptions,
      '-c:a', 'aac',
      '-b:a', '64k',
      '-movflags', '+faststart',
      '-f', 'ipod',
      m4aPath,
    ]);
    const [ogg, playback] = await Promise.all([readFile(oggPath), readFile(m4aPath)]);
    return { ogg, playback };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
