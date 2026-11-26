import * as whatsappMeta from '../templates/whatsapp-meta.util';
import { compressConversationAttachment } from './conversation-attachment-compression.util';
import {
  classifyConversationUpload,
  getConversationUploadType,
  MAX_MEDIA_DOCUMENT_BYTES,
  uploadMediaToWhatsApp,
} from './conversation-whatsapp.util';
import { VOICE_NOTE_MIME } from './voice-note.util';

describe('WhatsApp media uploads', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([
    [VOICE_NOTE_MIME, VOICE_NOTE_MIME, 'nota-de-voz.ogg'],
    ['audio/ogg', VOICE_NOTE_MIME, 'nota.ogg'],
    ['audio/mpeg', 'audio/mpeg', 'audio.mp3'],
    ['application/octet-stream', 'audio/mpeg', 'audio.mp3'],
  ])('declares %s as %s', async (mimeType, wireType, filename) => {
    jest.spyOn(whatsappMeta, 'getWhatsAppCredentialsForArea').mockReturnValue({
      area: 'ti',
      phoneNumberId: '123',
      token: 'test-token',
    });
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({ id: 'media-123' }));

    await expect(
      uploadMediaToWhatsApp({
        area: 'ti',
        buffer: Buffer.from('test-audio-bytes'),
        mimeType,
        filename,
      }),
    ).resolves.toEqual({
      mediaId: 'media-123',
      waType: 'audio',
      safeFilename: filename,
    });

    const body = fetchMock.mock.calls[0][1]?.body;
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get('type')).toBe(wireType);
    const wire = await new Response(body).text();
    expect(wire).toContain(
      `filename="${filename}"\r\nContent-Type: ${wireType}\r\n`,
    );
  });

  it('accepts a PDF at the advertised file limit and rejects files above it', () => {
    expect(classifyConversationUpload('application/octet-stream', MAX_MEDIA_DOCUMENT_BYTES, 'test.pdf'))
      .toMatchObject({ waType: 'document', mime: 'application/pdf' });
    expect(() => classifyConversationUpload('application/pdf', MAX_MEDIA_DOCUMENT_BYTES + 1, 'test.pdf'))
      .toThrow('Archivo demasiado grande');
  });

  it('keeps explicit unsupported types invalid even with a supported extension', () => {
    expect(() => classifyConversationUpload('image/gif', 10, 'test.pdf'))
      .toThrow('Tipo de archivo no permitido');
  });

  it('preserves the original attachment when it fits', async () => {
    const file = { buffer: Buffer.from('test'), mimetype: 'audio/mpeg', originalname: 'test.mp3' };
    await expect(compressConversationAttachment(file, getConversationUploadType(file.mimetype)))
      .resolves.toBe(file);
  });

  it('refuses to rewrite a signed PDF above the limit', async () => {
    const buffer = Buffer.alloc(MAX_MEDIA_DOCUMENT_BYTES + 1);
    buffer.write('/ByteRange');
    const file = { buffer, mimetype: 'application/pdf', originalname: 'signed.pdf' };
    await expect(compressConversationAttachment(file, getConversationUploadType(file.mimetype)))
      .rejects.toThrow('invalidaría su firma digital');
  });
});
