'use client';

import { useEffect, useRef, useState } from 'react';

interface ErrorInfo {
  id: string;
  message: string;
  timestamp: number;
}

/** 提示自動消失時間(ms)：避免一次非致命錯誤長期掛在頁面上 */
const AUTO_DISMISS_MS = 4000;

/** 同一條錯誤的去重窗口(ms)：窗口內重復觸發只提示一次 */
const DEDUPE_WINDOW_MS = 5000;

/** 替換動畫時長(ms) */
const REPLACE_PULSE_MS = 200;

export function GlobalErrorIndicator() {
  const [currentError, setCurrentError] = useState<ErrorInfo | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isReplacing, setIsReplacing] = useState(false);
  /** 上一次提示過的文案與時間，用於同文案去重 */
  const lastShownRef = useRef<{ message: string; at: number } | null>(null);

  useEffect(() => {
    // 定時器放在 effect 作用域內，卸載時一並清理
    const timers: {
      hide: ReturnType<typeof setTimeout> | null;
      pulse: ReturnType<typeof setTimeout> | null;
    } = { hide: null, pulse: null };

    // 監聽自定義錯誤事件
    const handleError = (event: CustomEvent) => {
      const { message } = event.detail ?? {};
      if (typeof message !== 'string' || !message) return;

      // 同一條文案在短時間內重復觸發（如多個請求同時失敗）只提示一次
      const now = Date.now();
      const last = lastShownRef.current;
      if (
        last &&
        last.message === message &&
        now - last.at < DEDUPE_WINDOW_MS
      ) {
        return;
      }
      lastShownRef.current = { message, at: now };

      setCurrentError({ id: String(now), message, timestamp: now });
      setIsVisible(true);
      setIsReplacing(true);
      if (timers.pulse) clearTimeout(timers.pulse);
      timers.pulse = setTimeout(() => setIsReplacing(false), REPLACE_PULSE_MS);

      // 關鍵：提示必須自己消失。此前要用戶手動關閉，配合後台同步失敗這種
      // 反復觸發的場景，就會一直有一條紅字掛在播放頁上。
      if (timers.hide) clearTimeout(timers.hide);
      timers.hide = setTimeout(() => {
        setIsVisible(false);
        setIsReplacing(false);
      }, AUTO_DISMISS_MS);
    };
    const handleClear = () => {
      if (timers.hide) clearTimeout(timers.hide);
      if (timers.pulse) clearTimeout(timers.pulse);
      lastShownRef.current = null;
      setIsVisible(false);
      setCurrentError(null);
      setIsReplacing(false);
    };

    // 監聽錯誤事件
    window.addEventListener('globalError', handleError as EventListener);
    window.addEventListener('globalErrorClear', handleClear);

    return () => {
      window.removeEventListener('globalError', handleError as EventListener);
      window.removeEventListener('globalErrorClear', handleClear);
      if (timers.hide) clearTimeout(timers.hide);
      if (timers.pulse) clearTimeout(timers.pulse);
    };
  }, []);

  const handleClose = () => {
    setIsVisible(false);
    setCurrentError(null);
    setIsReplacing(false);
  };

  if (!isVisible || !currentError) {
    return null;
  }

  return (
    <div className='fixed top-4 right-4 z-[2000]'>
      {/* 錯誤卡片 */}
      <div
        className={`bg-red-500 text-white px-4 py-3 rounded-lg shadow-lg flex items-center justify-between min-w-[300px] max-w-[400px] transition-all duration-300 ${
          isReplacing ? 'scale-105 bg-red-400' : 'scale-100 bg-red-500'
        } animate-fade-in`}
      >
        <span className='text-sm font-medium flex-1 mr-3'>
          {currentError.message}
        </span>
        <button
          onClick={handleClose}
          className='text-white hover:text-red-100 transition-colors flex-shrink-0'
          aria-label='關閉錯誤提示'
        >
          <svg
            className='w-5 h-5'
            fill='none'
            stroke='currentColor'
            viewBox='0 0 24 24'
          >
            <path
              strokeLinecap='round'
              strokeLinejoin='round'
              strokeWidth={2}
              d='M6 18L18 6M6 6l12 12'
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

// 全局錯誤觸發函數
export function triggerGlobalError(message: string) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('globalError', {
        detail: { message },
      })
    );
  }
}

export function clearGlobalError() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('globalErrorClear'));
  }
}
