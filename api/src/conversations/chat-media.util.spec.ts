import {
  extractStoredMediaDownloadRef,
  hasDownloadableMedia,
  readRoutingPhoneNumberId,
  withRoutingPhoneNumberId,
} from './chat-media.util';

describe('chat media line routing', () => {
  it('keeps the phone number id of the line that received the file', () => {
    const payload = {
      type: 'image',
      image: { id: 'media-ca' },
      _mali_routing: { phone_number_id: 'pid-ca' },
    };

    expect(readRoutingPhoneNumberId(payload)).toBe('pid-ca');
    expect(extractStoredMediaDownloadRef(payload)).toEqual({
      mediaId: 'media-ca',
      phoneNumberId: 'pid-ca',
    });
    expect(hasDownloadableMedia(payload)).toBe(true);
  });

  it('recovers an outbound upload even when S3 never stored a preview', () => {
    const payload = withRoutingPhoneNumberId(
      { upload_media_id: 'upload-1' },
      'pid-new',
    );

    expect(extractStoredMediaDownloadRef(payload)).toEqual({
      mediaId: 'upload-1',
      phoneNumberId: 'pid-new',
    });
    expect(hasDownloadableMedia({ type: 'text', text: { body: 'hola' } })).toBe(
      false,
    );
  });
});
