import { MaliOneChannelEventService } from './mali-one-channel-event.service';

describe('durable channel delivery', () => {
  afterEach(() => jest.restoreAllMocks());
  it('retains failed delivery and retries the same event after restart', async () => {
    const row = { id: 1, event_id: 'stable-id', event_type: 'education.cycle.update',
      occurred_at: new Date(), payload: { wa_cycle_id: 20 } };
    const outbox = { findMany: jest.fn().mockResolvedValue([row]), updateMany: jest.fn().mockResolvedValue({ count: 1 }) };
    const config = { maliOneApiBaseUrl: 'https://example.invalid', maliOneCrmEducacionServiceToken: 'test' };
    const first = new MaliOneChannelEventService(config as never, { commercial_channel_outbox: outbox } as never);
    jest.spyOn(first, 'tryEmit').mockResolvedValue(null);
    await first.drain();
    expect(outbox.updateMany.mock.calls[0][0].data.delivered_at).toBeUndefined();
    const restarted = new MaliOneChannelEventService(config as never, { commercial_channel_outbox: outbox } as never);
    const send = jest.spyOn(restarted, 'tryEmit').mockResolvedValue({ ok: true });
    await restarted.drain();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ eventId: 'stable-id' }));
    expect(outbox.updateMany.mock.calls[1][0].data.delivered_at).toBeInstanceOf(Date);
  });
  it('does not drain without service configuration', async () => {
    const prisma = { commercial_channel_outbox: { findMany: jest.fn() } };
    const service = new MaliOneChannelEventService({} as never, prisma as never);
    await service.drain();
    expect(prisma.commercial_channel_outbox.findMany).not.toHaveBeenCalled();
  });
});
