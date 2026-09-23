import { TikTokLeadgenService } from './tiktok-leadgen.service';

describe('TikTokLeadgenService webhook parsing', () => {
  const service = new TikTokLeadgenService({} as never, {} as never);

  it('parses the official Subscription API lead payload', () => {
    const notices = service.extractLeadNotices({
      object: 1,
      entry: [
        {
          id: 'lead-123',
          page_id: 'form-456',
          ad_id: 'ad-789',
          adv_id: 'adv-001',
          create_time: 1760000000,
          changes: [
            { field: 'phone_number', value: '+51999999999' },
            { field: 'email', value: { value: 'lead@example.com' } },
          ],
        },
      ],
    });

    expect(notices).toEqual([
      expect.objectContaining({
        lead_id: 'lead-123',
        form_id: 'form-456',
        advertiser_id: 'adv-001',
        ad_id: 'ad-789',
        inline_fields: {
          phone_number: '+51999999999',
          email: 'lead@example.com',
        },
      }),
    ]);
  });
});
