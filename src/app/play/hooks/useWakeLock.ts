'use client';

import { useCallback, useEffect, useRef } from 'react';

interface WakeLockSentinel {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}

type WakeLockNavigator = Navigator & {
  wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinel> };
};

/** 屏幕常亮：重複播放事件不重複取鎖，暫停/卸載會取消仍在等待的請求。 */
export function useWakeLock() {
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const generationRef = useRef(0);
  const pendingRef = useRef<number | null>(null);

  const requestWakeLock = useCallback(async () => {
    if (
      document.hidden ||
      pendingRef.current !== null ||
      (wakeLockRef.current && !wakeLockRef.current.released)
    )
      return;
    const wakeLock = (navigator as WakeLockNavigator).wakeLock;
    if (!wakeLock) return;
    const generation = ++generationRef.current;
    pendingRef.current = generation;
    try {
      const sentinel = await wakeLock.request('screen');
      if (generation !== generationRef.current || document.hidden) {
        await sentinel.release();
        return;
      }
      wakeLockRef.current = sentinel;
      sentinel.addEventListener('release', () => {
        if (wakeLockRef.current === sentinel) wakeLockRef.current = null;
      });
    } catch {
      // 不支援、權限限制或省電模式不影響正常播放。
    } finally {
      if (pendingRef.current === generation) pendingRef.current = null;
    }
  }, []);

  const releaseWakeLock = useCallback(async () => {
    generationRef.current += 1;
    pendingRef.current = null;
    const sentinel = wakeLockRef.current;
    wakeLockRef.current = null;
    try {
      await sentinel?.release();
    } catch {
      // 系統可能已自動釋放。
    }
  }, []);

  useEffect(
    () => () => {
      void releaseWakeLock();
    },
    [releaseWakeLock]
  );
  return { requestWakeLock, releaseWakeLock };
}
