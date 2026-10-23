'use client';

import { useEffect, useState } from 'react';

import { useNavigationLoading } from './NavigationLoadingProvider';

export function NavigationLoadingIndicator() {
  const { isLoading } = useNavigationLoading();
  const [visible, setVisible] = useState(false);
  const [doorsClosed, setDoorsClosed] = useState(false);

  useEffect(() => {
    if (isLoading) {
      // 先掛載遮罩，再在下一幀打開，保證首次出現時也有淡入過渡
      setVisible(true);
      const raf = requestAnimationFrame(() => setDoorsClosed(true));
      return () => cancelAnimationFrame(raf);
    }

    // 關閉時先淡出，等過渡結束後再卸載，避免動畫被截斷
    setDoorsClosed(false);
    const timer = setTimeout(() => setVisible(false), 500);
    return () => clearTimeout(timer);
  }, [isLoading]);

  if (!visible) return null;

  return (
    <>
      {/* 全屏加載遮罩 */}
      <div
        className='fixed inset-0 z-[50] flex items-center justify-center bg-white/90 backdrop-blur-xl transition-opacity duration-500 dark:bg-gray-900/90'
        style={{
          opacity: doorsClosed ? 1 : 0,
          pointerEvents: doorsClosed ? 'auto' : 'none',
        }}
      >
        {/* 中心加載動畫 + 文字（flex-col 布局，保證首次加載也居中） */}
        <div className='flex flex-col items-center justify-center gap-6'>
          {/* 月亮形狀 */}
          <div className='relative w-20 h-20'>
            {/* 月亮主體 */}
            <div
              className='absolute inset-0 bg-gradient-to-br from-yellow-300 to-yellow-500 dark:from-yellow-400 dark:to-yellow-600 rounded-full shadow-lg shadow-yellow-500/30 animate-bounce'
              style={{ animationDuration: '2s' }}
            >
              {/* 月亮上的小坑 */}
              <div className='absolute top-3 left-4 w-2 h-2 bg-yellow-600/40 dark:bg-yellow-700/40 rounded-full' />
              <div className='absolute top-6 right-5 w-1.5 h-1.5 bg-yellow-600/40 dark:bg-yellow-700/40 rounded-full' />
              <div className='absolute bottom-4 left-6 w-1 h-1 bg-yellow-600/40 dark:bg-yellow-700/40 rounded-full' />
            </div>

            <div
              className='absolute -bottom-1 -left-1 w-2 h-2 bg-yellow-400 dark:bg-yellow-300 rounded-full animate-spin'
              style={{ animationDuration: '4s', animationDirection: 'reverse' }}
            >
              <div className='absolute inset-0 flex items-center justify-center'>
                <div className='w-0.5 h-0.5 bg-yellow-600 dark:bg-yellow-500 rounded-full' />
              </div>
            </div>
          </div>

          {/* 加載文字 */}
          <div className='text-gray-700 dark:text-gray-300 font-medium text-sm'>
            <span className='animate-pulse'>🌙</span>
            <span className='animate-pulse' style={{ animationDelay: '0.2s' }}>
              {' '}
              月亮正在努力載入中
            </span>
            <span className='animate-pulse' style={{ animationDelay: '0.4s' }}>
              {' '}
              ✨
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
