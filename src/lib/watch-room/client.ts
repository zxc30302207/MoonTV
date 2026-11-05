import { RoomRequest, RoomResponse } from './types';

const REQUEST_TIMEOUT_MS = 6_000;

/**
 * 觀影室唯一請求入口。統一走 POST + no-store，避免被 PWA Service Worker
 * 或 CDN 緩存成舊狀態。
 */
export async function roomRequest(
  payload: RoomRequest | Record<string, unknown>
): Promise<RoomResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch('/api/watch-room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
    });

    let data: RoomResponse | null = null;
    try {
      data = (await res.json()) as RoomResponse;
    } catch {
      // middleware 回傳的是純文本 Unauthorized
      return {
        ok: false,
        error:
          res.status === 401
            ? '登錄狀態已失效，請重新登入'
            : `請求失敗 (${res.status})`,
      };
    }

    if (!res.ok && !data?.ok) {
      return { ok: false, error: data?.error || `請求失敗 (${res.status})` };
    }
    return data;
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return {
      ok: false,
      error: aborted ? '請求逾時，正在重試' : '網路連線異常',
    };
  } finally {
    clearTimeout(timer);
  }
}
