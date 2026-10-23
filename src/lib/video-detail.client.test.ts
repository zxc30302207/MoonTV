import { getVideoDesc } from './video-detail.client';

describe('private video description cache', () => {
  beforeEach(() => {
    window.dispatchEvent(new Event('moontv:logout'));
    global.fetch = jest.fn();
  });

  it('deduplicates requests and clears cached descriptions on logout', async () => {
    (fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ desc: 'private description' }),
    });
    expect(
      await Promise.all([
        getVideoDesc('source', '1'),
        getVideoDesc('source', '1'),
      ])
    ).toEqual(['private description', 'private description']);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await getVideoDesc('source', '1')).toBe('private description');
    window.dispatchEvent(new Event('moontv:logout'));
    await getVideoDesc('source', '1');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not repopulate private cache from a request completing after logout', async () => {
    let resolveResponse!: (response: unknown) => void;
    (fetch as jest.Mock).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveResponse = resolve;
        })
    );
    const oldRequest = getVideoDesc('source', '1');
    window.dispatchEvent(new Event('moontv:logout'));
    resolveResponse({
      ok: true,
      json: async () => ({ desc: 'old private description' }),
    });
    expect(await oldRequest).toBe('');
    (fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ desc: 'new description' }),
    });
    expect(await getVideoDesc('source', '1')).toBe('new description');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('old completion cannot delete the new account inflight request', async () => {
    let resolveOld!: (response: unknown) => void;
    let resolveNew!: (response: unknown) => void;
    (fetch as jest.Mock)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveNew = resolve;
          })
      );
    const oldRequest = getVideoDesc('source', '1');
    window.dispatchEvent(new Event('moontv:logout'));
    const newRequest = getVideoDesc('source', '1');
    resolveOld({ ok: true, json: async () => ({ desc: 'old' }) });
    await oldRequest;
    await Promise.resolve();
    expect(getVideoDesc('source', '1')).toBe(newRequest);
    resolveNew({ ok: true, json: async () => ({ desc: 'new' }) });
    expect(await newRequest).toBe('new');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
