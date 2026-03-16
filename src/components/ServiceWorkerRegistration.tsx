'use client';

import { useEffect } from 'react';

import { detectStreamingCapability } from '@/lib/stream-saver-fallback';

export default function ServiceWorkerRegistration({
  enabled = true,
}: {
  enabled?: boolean;
}) {
  useEffect(() => {
    if (typeof window === 'undefined' || !enabled) {
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

    const startRegistration = () => {
      if (cancelled) {
        return;
      }

      const capability = detectStreamingCapability();

      if (capability.method === 'service-worker') {
        fetch('/sw.js', { method: 'HEAD' })
          .then((response) => {
            if (!response.ok) {
              throw new Error('Service Worker not available');
            }

            return navigator.serviceWorker.register('/sw.js', {
              scope: '/',
              updateViaCache: 'none',
            });
          })
          .then((registration) => {
            registration.addEventListener('updatefound', () => {
              // eslint-disable-next-line no-console
              console.log('Service Worker update found');
            });
          })
          .catch((error) => {
            // eslint-disable-next-line no-console
            console.warn('Service Worker registration skipped:', error.message);
          });
        return;
      }

      if (capability.method === 'file-system-access') {
        // eslint-disable-next-line no-console
        console.log('Using File System Access API for downloads');
        return;
      }

      if (capability.method === 'blob') {
        // eslint-disable-next-line no-console
        console.warn(
          `Fallback to Blob download mode: ${capability.limitation || 'unknown limitation'}`
        );
      }
    };

    if (idleWindow.requestIdleCallback) {
      idleHandle = idleWindow.requestIdleCallback(startRegistration, {
        timeout: 2000,
      });
    } else {
      timeoutHandle = window.setTimeout(startRegistration, 1200);
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
  }, [enabled]);

  return null;
}
