import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { promisify } from 'node:util';
import { BadRequestException, HttpException, ServiceUnavailableException } from '@nestjs/common';
import {
  getConversationUploadType,
  MAX_CONVERSATION_ATTACHMENT_INPUT_BYTES,
} from './conversation-whatsapp.util';

type Attachment = { buffer: Buffer; mimetype: string; originalname: string };
type UploadType = ReturnType<typeof getConversationUploadType>;

const execute = promisify(execFile);
const MAX_CONCURRENT_COMPRESSIONS = 2;
const MAX_DECODED_IMAGE_PIXELS = 50_000_000;
let activeCompressions = 0;

const audioFormats = new Map([
  ['audio/mpeg', 'mp3'],
  ['audio/mp3', 'mp3'],
  ['audio/ogg', 'ogg'],
  ['application/ogg', 'ogg'],
  ['audio/aac', 'aac'],
  ['audio/mp4', 'mov'],
  ['audio/x-m4a', 'mov'],
  ['audio/m4a', 'mov'],
]);

async function runMediaTool(command: string, args: string[], timeout: number) {
  try {
    const { stdout } = await execute(command, args, {
      timeout,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      throw new ServiceUnavailableException('El compresor de adjuntos no está disponible en este servidor.');
    }
    throw error;
  }
}

function scaleWithin(size: number, even = false): string {
  return `scale=w='min(iw,${size})':h='min(ih,${size})':force_original_aspect_ratio=decrease${even ? ':force_divisible_by=2' : ''}`;
}

function isAnimatedPng(buffer: Buffer): boolean {
  for (let offset = 8; offset + 12 <= buffer.length;) {
    const chunkType = buffer.toString('ascii', offset + 4, offset + 8);
    if (chunkType === 'acTL') return true;
    if (chunkType === 'IDAT') return false;
    offset += buffer.readUInt32BE(offset) + 12;
  }
  return false;
}

async function runFfmpeg(input: string, demuxer: string, output: string, args: string[]) {
  await runMediaTool('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-xerror',
    '-protocol_whitelist', 'file', '-f', demuxer,
    '-threads', '2', '-filter_threads', '1',
    '-max_pixels', String(MAX_DECODED_IMAGE_PIXELS), '-i', input,
    '-map_metadata', '-1', '-map_chapters', '-1', '-threads', '2',
    ...args, output,
  ], 90_000);
}

async function compressImage(input: string, output: string, png: boolean, targetBytes: number) {
  const encoder = png
    ? ['-c:v', 'png', '-compression_level', '9', '-pred', 'mixed']
    : ['-c:v', 'mjpeg', '-q:v', '5'];
  for (const size of [1600, 1280, 1024]) {
    await runFfmpeg(input, png ? 'png_pipe' : 'jpeg_pipe', output, [
      '-map', '0:v:0', '-frames:v', '1', '-vf', scaleWithin(size),
      ...encoder, '-update', '1', '-f', 'image2',
    ]);
    if ((await stat(output)).size <= targetBytes) return;
  }
}

async function compressRecording(
  input: string,
  output: string,
  type: UploadType,
  originalBytes: number,
): Promise<boolean> {
  const video = type.waType === 'video';
  const demuxer = video ? 'mov' : audioFormats.get(type.mime);
  if (!demuxer) throw new BadRequestException('Formato de audio no compatible con la compresión.');

  const metadata = JSON.parse(await runMediaTool('ffprobe', [
    '-v', 'error', '-protocol_whitelist', 'file', '-f', demuxer,
    '-show_entries', 'format=duration:stream=codec_type,channels',
    '-of', 'json', input,
  ], 10_000)) as {
    format?: { duration?: string };
    streams?: { codec_type?: string; channels?: number }[];
  };
  const duration = Number(metadata.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new BadRequestException('No se pudo leer la duración del archivo para comprimirlo.');
  }
  const audio = metadata.streams?.find((stream) => stream.codec_type === 'audio');
  const targetBytes = video
    ? Math.min(type.maxBytes * 0.90, originalBytes * 0.80)
    : type.maxBytes * 0.90;
  const budget = Math.floor(targetBytes * 8 / duration);
  const audioRate = audio ? Math.min(video ? 64_000 : 96_000, budget) : 0;
  const audioOptions = audio
    ? ['-map', '0:a:0', '-c:a', 'aac', '-b:a', String(audioRate),
      '-ac', audioRate < 64_000 || audio.channels === 1 ? '1' : '2']
    : [];

  if (!video) {
    if (audioRate < 32_000) {
      throw new BadRequestException('El audio es demasiado largo para ajustarlo al límite. Recórtalo o divídelo.');
    }
    await runFfmpeg(input, demuxer, output, [
      ...audioOptions, '-vn', '-movflags', '+faststart', '-f', 'ipod',
    ]);
    return true;
  }

  const videoRate = Math.min(3_000_000, budget - audioRate);
  if (videoRate < 120_000) {
    if (originalBytes <= type.maxBytes) return false;
    throw new BadRequestException('El video es demasiado largo para ajustarlo al límite. Recórtalo o divídelo.');
  }
  const maxSide = videoRate >= 1_500_000 ? 1280 : videoRate >= 600_000 ? 960 : 480;
  await runFfmpeg(input, demuxer, output, [
    '-map', '0:V:0', '-vf', scaleWithin(maxSide, true), '-fpsmax', '30',
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    '-b:v', String(videoRate), '-maxrate', String(videoRate), '-bufsize', String(videoRate * 2),
    ...audioOptions, '-movflags', '+faststart', '-f', 'mp4',
  ]);
  return true;
}

async function compressPdf(input: string, output: string) {
  const metadata = JSON.parse(await runMediaTool('qpdf', [
    '--json=2', '--json-key=acroform', '--json-key=encrypt', input,
  ], 15_000)) as {
    acroform?: { hasacroform?: boolean };
    encrypt?: { encrypted?: boolean };
  };
  if (metadata.acroform?.hasacroform || metadata.encrypt?.encrypted) {
    throw new BadRequestException('El PDF está protegido o contiene un formulario. Adjunta una copia más pequeña sin modificar el original.');
  }
  await runMediaTool('qpdf', [
    '--object-streams=generate', '--recompress-flate', '--compression-level=9', input, output,
  ], 45_000);
}

export async function compressConversationAttachment(file: Attachment, type: UploadType): Promise<Attachment> {
  if (!file.buffer.length) throw new BadRequestException('El archivo está vacío.');
  if (file.buffer.length > MAX_CONVERSATION_ATTACHMENT_INPUT_BYTES) {
    throw new BadRequestException('El archivo supera los 50 MB admitidos para la compresión.');
  }
  const fitsOriginal = file.buffer.length <= type.maxBytes;
  const optimizeAlways = type.waType === 'image' || type.waType === 'video';
  if (fitsOriginal && !optimizeAlways) return file;
  if (type.mime === 'image/png' && isAnimatedPng(file.buffer)) {
    if (fitsOriginal) return file;
    throw new BadRequestException('El PNG animado supera los 5 MB. Usa una versión más pequeña para conservar la animación.');
  }
  if (type.waType === 'document' && file.buffer.includes('/ByteRange')) {
    throw new BadRequestException('El PDF supera los 25 MB. La compresión invalidaría su firma digital.');
  }
  if (activeCompressions >= MAX_CONCURRENT_COMPRESSIONS) {
    if (fitsOriginal) return file;
    throw new ServiceUnavailableException('Se están comprimiendo otros adjuntos. Intenta enviar el archivo en un momento.');
  }

  activeCompressions++;
  let directory: string | undefined;
  const limitMb = type.maxBytes / (1024 * 1024);
  try {
    directory = await mkdtemp(join(tmpdir(), 'mali-attachment-'));
    const input = join(directory, 'original');
    const png = type.mime === 'image/png';
    const outputExtension = type.waType === 'document' ? '.pdf'
      : type.waType === 'image' ? (png ? '.png' : '.jpg')
        : type.waType === 'video' ? '.mp4' : '.m4a';
    const output = join(directory, `comprimido${outputExtension}`);
    await writeFile(input, file.buffer);
    if (type.waType === 'image') {
      await compressImage(input, output, png, Math.min(type.maxBytes, file.buffer.length - 1));
    } else if (type.waType === 'document') await compressPdf(input, output);
    else if (!(await compressRecording(input, output, type, file.buffer.length))) return file;

    const { size } = await stat(output);
    if (fitsOriginal && size >= file.buffer.length) return file;
    if (!size || size > type.maxBytes) {
      throw new BadRequestException(`El archivo sigue superando los ${limitMb} MB después de comprimirlo. Usa una versión más pequeña.`);
    }
    const buffer = await readFile(output);
    if (type.waType !== 'audio') return { ...file, buffer };
    const extension = extname(file.originalname);
    const name = extension ? file.originalname.slice(0, -extension.length) : file.originalname;
    return { buffer, mimetype: 'audio/mp4', originalname: `${name || 'audio'}${outputExtension}` };
  } catch (error) {
    if (fitsOriginal) return file;
    if (error instanceof HttpException) throw error;
    throw new BadRequestException(`No se pudo comprimir el archivo. Usa otro archivo de hasta ${limitMb} MB.`);
  } finally {
    activeCompressions--;
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}
