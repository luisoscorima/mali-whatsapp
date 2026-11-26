import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { compressConversationAttachment } from './conversation-attachment-compression.util';
import { getConversationUploadType } from './conversation-whatsapp.util';

jest.mock('node:child_process', () => ({
  execFile: Object.assign(jest.fn(), { [Symbol.for('nodejs.util.promisify.custom')]: jest.fn() }),
}));

const execute = Reflect.get(execFile, promisify.custom) as jest.Mock;

function mockEncoding(outputBytes: number) {
  execute.mockImplementation(async (command: string, args: string[]) => {
    if (command === 'ffprobe') {
      return { stdout: '{"format":{"duration":"2"},"streams":[{"codec_type":"video"}]}' };
    }
    await writeFile(args[args.length - 1], Buffer.alloc(outputBytes));
    return { stdout: '' };
  });
}

describe('conversation attachment optimization', () => {
  beforeEach(() => execute.mockReset());

  it.each([
    { mimetype: 'image/jpeg', originalname: 'foto.jpg' },
    { mimetype: 'image/png', originalname: 'captura.png' },
    { mimetype: 'video/mp4', originalname: 'video.mp4' },
  ])('optimizes $mimetype even below the upload limit', async ({ mimetype, originalname }) => {
    mockEncoding(300_000);
    const file = { buffer: Buffer.alloc(600_000), mimetype, originalname };
    const output = await compressConversationAttachment(file, getConversationUploadType(mimetype));
    expect(execute).toHaveBeenCalledWith('ffmpeg', expect.any(Array), expect.any(Object));
    expect(output.buffer.length).toBe(300_000);
  });

  it('keeps a valid original if the optimized image is larger', async () => {
    mockEncoding(700_000);
    const file = { buffer: Buffer.alloc(600_000), mimetype: 'image/jpeg', originalname: 'foto.jpg' };
    await expect(compressConversationAttachment(file, getConversationUploadType(file.mimetype)))
      .resolves.toBe(file);
  });

  it('keeps a valid original if video optimization fails', async () => {
    execute.mockRejectedValue(new Error('ffprobe failed'));
    const file = { buffer: Buffer.alloc(600_000), mimetype: 'video/mp4', originalname: 'video.mp4' };
    await expect(compressConversationAttachment(file, getConversationUploadType(file.mimetype)))
      .resolves.toBe(file);
  });
});
