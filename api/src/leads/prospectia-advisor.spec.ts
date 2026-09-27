import { ProspectiaAdvisorService } from './prospectia-advisor.service';

describe('Prospectia advisor lookup', () => {
  const originalToken = process.env.PROSPECTIA_API_ACCESS_TOKEN;
  const originalFetch = global.fetch;

  afterEach(() => {
    if (originalToken === undefined) delete process.env.PROSPECTIA_API_ACCESS_TOKEN;
    else process.env.PROSPECTIA_API_ACCESS_TOKEN = originalToken;
    global.fetch = originalFetch;
  });

  it('uses an exact phone match and the most recent active conversation', async () => {
    process.env.PROSPECTIA_API_ACCESS_TOKEN = 'test-token';
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ meta: { count: 2 }, payload: [
        { id: 1, phone_number: '+51999999998' }, { id: 2, phone_number: '+51999999999' },
      ] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ payload: [
        { status: 'resolved', last_activity_at: 30, meta: { assignee: { email: 'old@mali.pe' } } },
        { status: 'open', last_activity_at: 10, meta: { assignee: { email: 'new@mali.pe' } } },
      ] }) }) as typeof fetch;
    const email = await new ProspectiaAdvisorService().advisorEmail('+51 999 999 999');
    expect(email).toBe('new@mali.pe');
    expect(String((global.fetch as jest.Mock).mock.calls[0][0])).toContain('q=%2B51999999999');
    expect(String((global.fetch as jest.Mock).mock.calls[1][0])).toContain('/contacts/2/conversations');
  });

  it('accepts the E.164 number stored without a plus sign', async () => {
    process.env.PROSPECTIA_API_ACCESS_TOKEN = 'test-token';
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ meta: { count: 1 }, payload: [
        { id: 2, phone_number: '+51999999999' },
      ] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ payload: [
        { status: 'pending', last_activity_at: 10, meta: { assignee: { email: 'new@mali.pe' } } },
      ] }) }) as typeof fetch;
    expect(await new ProspectiaAdvisorService().advisorEmail('51999999999')).toBe('new@mali.pe');
    expect(String((global.fetch as jest.Mock).mock.calls[0][0])).toContain('q=%2B51999999999');
  });

  it('skips a search without an exact match and does not query conversations', async () => {
    process.env.PROSPECTIA_API_ACCESS_TOKEN = 'test-token';
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({
      meta: { count: 1 }, payload: [{ id: 1, phone_number: '+51999999998' }],
    }) }) as typeof fetch;
    expect(await new ProspectiaAdvisorService().advisorEmail('+51999999999')).toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not assign from a truncated search page', async () => {
    process.env.PROSPECTIA_API_ACCESS_TOKEN = 'test-token';
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({
      meta: { count: 20 }, payload: [{ id: 2, phone_number: '+51999999999' }],
    }) }) as typeof fetch;
    expect(await new ProspectiaAdvisorService().advisorEmail('51999999999')).toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('reports exists, missing and unverified without calling conversations', async () => {
    process.env.PROSPECTIA_API_ACCESS_TOKEN = 'test-token';
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({
        meta: { count: 1 }, payload: [{ id: 2, phone_number: '+51999999999' }],
      }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({
        meta: { count: 1 }, payload: [{ id: 1, phone_number: '+51999999998' }],
      }) })
      .mockRejectedValueOnce(new Error('network')) as typeof fetch;
    const result = await new ProspectiaAdvisorService().checkPhones([
      '51999999999', '51988888888', '51977777777',
    ]);
    expect(result).toEqual({
      enabled: true,
      matches: {
        '51999999999': 'exists',
        '51988888888': 'missing',
        '51977777777': 'unverified',
      },
    });
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it('marks every phone unverified when Prospectia is not configured', async () => {
    delete process.env.PROSPECTIA_API_ACCESS_TOKEN;
    global.fetch = jest.fn() as typeof fetch;
    const result = await new ProspectiaAdvisorService().checkPhones(['51999999999']);
    expect(result).toEqual({ enabled: false, matches: { '51999999999': 'unverified' } });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
