import * as whatsappMeta from '../templates/whatsapp-meta.util';
import { uploadMediaToWhatsApp } from './conversation-whatsapp.util';
import { VOICE_NOTE_MIME } from './voice-note.util';

describe('WhatsApp media uploads', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([
    [VOICE_NOTE_MIME, 'audio/ogg', 'nota-de-voz.ogg'],
    ['audio/mpeg', 'audio/mpeg', 'audio.mp3'],
  ])('declares %s as base type %s', async (mimeType, wireType, filename) => {
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
});
