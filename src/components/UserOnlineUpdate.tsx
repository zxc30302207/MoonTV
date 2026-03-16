'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

const UPDATE_INTERVAL_MS = 5 * 60 * 1000;

export default function UserOnlineUpdate() {
  const pathname = usePathname();

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      pathname.startsWith('/login') ||
      pathname.startsWith('/warning')
    ) {
      return;
    }

    const lastUpdatedAt = Number(
      window.sessionStorage.getItem('userOnlineUpdatedAt') || '0'
    );
    if (Date.now() - lastUpdatedAt < UPDATE_INTERVAL_MS) {
      return;
    }

    let cancelled = false;
    const idleWindow = window as Window & {
      requestIdleCallback?: (
        callback: IdleRequestCallback,
        options?: IdleRequestOptions
      ) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    let idleHandle: number | null = null;
    let timeoutHandle: number | null = null;

    const updateOnline = async () => {
      if (cancelled || document.visibilityState === 'hidden') {
        return;
      }

      try {
        const response = await fetch('/api/user/online', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
          cache: 'no-store',
          keepalive: true,
        });

        if (!response.ok) {
          const body = await response.text().catch(() => '');
          // eslint-disable-next-line no-console
          console.error('Failed to update user online status', {
            status: response.status,
            statusText: response.statusText,
            body,
          });
          return;
        }

        window.sessionStorage.setItem(
          'userOnlineUpdatedAt',
          Date.now().toString()
        );
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Network error while updating user online status', error);
      }
    };

    if (idleWindow.requestIdleCallback) {
      idleHandle = idleWindow.requestIdleCallback(updateOnline, {
        timeout: 2000,
      });
    } else {
      timeoutHandle = window.setTimeout(updateOnline, 1200);
    }

    return () => {
      cancelled = true;
      if (idleHandle !== null && idleWindow.cancelIdleCallback) {
        idleWindow.cancelIdleCallback(idleHandle);
      }
      if (timeoutHandle !== null) {
        window.clearTimeout(timeoutHandle);
      }
    };
  }, [pathname]);

  return null;
}
