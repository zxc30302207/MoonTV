/** 有界 LRU 快取與並發去重；僅儲存成功結果，登出後清除所有資料。 */
export function memoizeAsync<TArgs extends unknown[], TResult>(
  keyFn: (...args: TArgs) => string,
  load: (...args: TArgs) => Promise<TResult>,
  limit = 200,
  invalidatedResult?: () => TResult
): (...args: TArgs) => Promise<TResult> {
  const cache = new Map<string, TResult>();
  const inflight = new Map<string, Promise<TResult>>();
  let generation = 0;

  if (typeof window !== 'undefined') {
    window.addEventListener('moontv:logout', () => {
      generation += 1;
      cache.clear();
      inflight.clear();
    });
  }

  return (...args: TArgs) => {
    const key = keyFn(...args);
    if (cache.has(key)) {
      const cached = cache.get(key) as TResult;
      cache.delete(key);
      cache.set(key, cached);
      return Promise.resolve(cached);
    }
    const pending = inflight.get(key);
    if (pending) return pending;

    const requestGeneration = generation;
    const request = load(...args).then((value) => {
      if (requestGeneration !== generation) {
        if (invalidatedResult) return invalidatedResult();
        throw new Error('簡介請求已因登出失效');
      }
      if (limit > 0) {
        if (cache.size >= limit) {
          const oldestKey = cache.keys().next().value;
          if (oldestKey !== undefined) cache.delete(oldestKey);
        }
        cache.set(key, value);
      }
      return value;
    });
    inflight.set(key, request);
    void request
      .catch(() => {
        // 呼叫端處理錯誤；不要永久保存失敗結果。
      })
      .finally(() => {
        // 舊帳號的完成事件不能刪除新帳號同一 key 的請求。
        if (inflight.get(key) === request) inflight.delete(key);
      });
    return request;
  };
}
