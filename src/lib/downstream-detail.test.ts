import { getDetailFromApi } from './downstream';

jest.mock('@/lib/config', () => ({
  API_CONFIG: { detail: { path: '?id=', headers: {} } },
}));

const source = { key: 'test', name: 'Test', api: 'https://source.example/' };

describe('detail request cancellation', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  it.each([false, true])(
    'forwards cancellation for special source=%s',
    async (special) => {
      const controller = new AbortController();
      global.fetch = jest.fn(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => reject(new DOMException('aborted', 'AbortError')),
              { once: true }
            );
          })
      );
      const pending = getDetailFromApi(
        special ? { ...source, detail: 'https://detail.example' } : source,
        '1',
        { signal: controller.signal }
      );
      controller.abort();
      await expect(pending).rejects.toThrow('請求超時');
    }
  );

  it('applies the optional timeout without changing default callers', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true }
          );
        })
    );
    const pending = getDetailFromApi(source, '1', { timeout: 7000 });
    jest.advanceTimersByTime(7000);
    await expect(pending).rejects.toThrow('請求超時');
  });
});
