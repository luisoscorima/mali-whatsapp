import { resolveCampaignRetryRecipient } from './campaign-retry-recipient.util';

describe('campaign retry recipient', () => {
  it('uses the corrected contact phone and marks a changed target', () => {
    expect(resolveCampaignRetryRecipient('55999134343', '51999134343')).toEqual(
      { phone: '51999134343', targetChanged: true },
    );
  });

  it('keeps the stored phone when the contact has no usable phone', () => {
    expect(resolveCampaignRetryRecipient('51999134343', null)).toEqual({
      phone: '51999134343',
      targetChanged: false,
    });
  });

  it('normalizes equivalent phones without treating them as changed', () => {
    expect(
      resolveCampaignRetryRecipient('+51 999 134 343', '51999134343'),
    ).toEqual({ phone: '51999134343', targetChanged: false });
  });
});
