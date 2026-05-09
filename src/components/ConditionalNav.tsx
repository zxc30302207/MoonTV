'use client';

import { usePathname } from 'next/navigation';
import { memo } from 'react';

import MobileBottomNav from './MobileBottomNav';
import MobileHeader from './MobileHeader';
import TopNav from './TopNav';

/**
 * 條件導航欄組件
 * 根據當前路徑決定是否顯示導航欄
 * 在登錄、警告等特殊頁面不顯示導航欄
 */
const ConditionalNav = () => {
  const pathname = usePathname();

  // 不顯示導航欄的路徑列表
  const hideNavPaths = ['/login', '/warning'];

  // 檢查當前路徑是否需要隱藏導航欄
  const shouldHideNav = hideNavPaths.some(path => pathname.startsWith(path));

  // 如果需要隱藏導航欄，返回 null
  if (shouldHideNav) {
    return null;
  }

  return (
    <>
      {/* 移動端頭部 - 固定在根佈局，避免頁面切換時重新渲染 */}
      <MobileHeader showBackButton={false} />

      {/* 桌面端頂部導航欄 - 固定在根佈局，避免頁面切換時重新渲染 */}
      <TopNav />

      {/* 移動端底部導航 - 固定在根佈局，避免頁面切換時重新渲染 */}
      <div className='md:hidden'>
        <MobileBottomNav />
      </div>
    </>
  );
};

// 使用 React.memo 優化，避免不必要的重新渲染
export default memo(ConditionalNav);
