import { memoizeAsync } from './async-cache';

describe('shared asynchronous cache', () => {
  it('reuses undefined success values and evicts least recently used entries', async () => {
    const load = jest.fn(async (_key: string) => undefined);
    const cached = memoizeAsync((key: string) => key, load, 2);
    await cached('a');
    await cached('b');
    await cached('a');
    await cached('c');
    await cached('a');
    expect(load).toHaveBeenCalledTimes(3);
    await cached('b');
    expect(load).toHaveBeenCalledTimes(4);
  });

  it('keeps a new account request when an old request settles', async () => {
    let resolveOld!: (value: string) => void;
    let resolveNew!: (value: string) => void;
    const load = jest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            resolveOld = resolve;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            resolveNew = resolve;
          })
      );
    const cached = memoizeAsync((key: string) => key, load);
    const oldRequest = cached('a');
    window.dispatchEvent(new Event('moontv:logout'));
    const newRequest = cached('a');
    resolveOld('old');
    await expect(oldRequest).rejects.toThrow('登出');
    await Promise.resolve();
    expect(cached('a')).toBe(newRequest);
    resolveNew('new');
    expect(await newRequest).toBe('new');
    expect(await cached('a')).toBe('new');
    expect(load).toHaveBeenCalledTimes(2);
  });
});
