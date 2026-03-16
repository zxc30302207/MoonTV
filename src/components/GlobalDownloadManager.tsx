'use client';

import dynamic from 'next/dynamic';
import { memo, useEffect, useState } from 'react';

const DownloadManager = dynamic(() => import('./DownloadManager'), {
  ssr: false,
});

/**
 * 全域下載管理器容器。
 * 只在閒置時間或第一次互動時才掛載真正的下載管理器，避免把重型下載邏輯塞進首屏。
 */
const GlobalDownloadManager = () => {
  const [shouldMountManager, setShouldMountManager] = useState(false);
  const [managerReady, setManagerReady] = useState(false);
  const [queuedTasks, setQueuedTasks] = useState<unknown[]>([]);
  const [showDownloadManager, setShowDownloadManager] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const idleWindow = window as Window & {
      requestIdleCallback?: (
        callback: IdleRequestCallback,
        options?: IdleRequestOptions
      ) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    let idleHandle: number | null = null;
    let timeoutHandle: number | null = null;

    const preloadManager = () => setShouldMountManager(true);
    const handleShowEvent = () => {
      setShouldMountManager(true);
      setShowDownloadManager(true);
    };
    const handleAddTaskEvent = (event: Event) => {
      const customEvent = event as CustomEvent;

      setShouldMountManager(true);
      setShowDownloadManager(true);

      if (!managerReady) {
        setQueuedTasks((prev) => [...prev, customEvent.detail]);
      }
    };

    if (idleWindow.requestIdleCallback) {
      idleHandle = idleWindow.requestIdleCallback(preloadManager, {
        timeout: 1500,
      });
    } else {
      timeoutHandle = window.setTimeout(preloadManager, 1500);
    }

    window.addEventListener('showDownloadManager', handleShowEvent);
    window.addEventListener(
      'addDownloadTask',
      handleAddTaskEvent as EventListener
    );

    return () => {
      if (idleHandle !== null && idleWindow.cancelIdleCallback) {
        idleWindow.cancelIdleCallback(idleHandle);
      }
      if (timeoutHandle !== null) {
        window.clearTimeout(timeoutHandle);
      }
      window.removeEventListener('showDownloadManager', handleShowEvent);
      window.removeEventListener(
        'addDownloadTask',
        handleAddTaskEvent as EventListener
      );
    };
  }, [managerReady]);

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      !managerReady ||
      queuedTasks.length === 0
    ) {
      return;
    }

    queuedTasks.forEach((task) => {
      window.dispatchEvent(new CustomEvent('addDownloadTask', { detail: task }));
    });
    setQueuedTasks([]);
  }, [managerReady, queuedTasks]);

  if (!shouldMountManager) {
    return null;
  }

  return (
    <DownloadManager
      isOpen={showDownloadManager}
      onClose={() => setShowDownloadManager(false)}
      onReady={() => setManagerReady(true)}
    />
  );
};

export default memo(GlobalDownloadManager);
