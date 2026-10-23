describe('Douban description cache', () => {
  beforeEach(() => {
    jest.resetModules();
    localStorage.clear();
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ desc: '簡介' }) });
  });

  it('deduplicates concurrent requests and reuses the result', async () => {
    const { getDoubanDetail } = await import('./douban.client');
    const first = getDoubanDetail('1');
    expect(getDoubanDetail('1')).toBe(first);
    expect((await first).intro).toBe('簡介');
    await getDoubanDetail('1');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('evicts the least recently used result after 200 entries', async () => {
    const { getDoubanDetail } = await import('./douban.client');
    for (let id = 0; id < 200; id += 1) await getDoubanDetail(String(id));
    await getDoubanDetail('0');
    await getDoubanDetail('200');
    await getDoubanDetail('0');
    expect(fetch).toHaveBeenCalledTimes(201);
    await getDoubanDetail('1');
    expect(fetch).toHaveBeenCalledTimes(202);
  });

  it('clears failed inflight requests so the user can retry', async () => {
    const { getDoubanDetail } = await import('./douban.client');
    (fetch as jest.Mock).mockRejectedValueOnce(new Error('network'));
    await expect(getDoubanDetail('1')).rejects.toThrow('network');
    await Promise.resolve();
    expect((await getDoubanDetail('1')).intro).toBe('簡介');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

export {};
