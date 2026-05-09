'use client';

import { Cat, Clover, Film, Home, Search, Star, Tv } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { memo, useEffect, useState } from 'react';

import { getCustomCategories } from '@/lib/config.client';

import { useNavigationLoading } from './NavigationLoadingProvider';

interface MobileBottomNavProps {
  /**
   * 主動指定當前激活的路徑。當未提供時，自動使用 usePathname() 獲取的路徑。
   */
  activePath?: string;
}

const MobileBottomNav = ({ activePath }: MobileBottomNavProps) => {
  const pathname = usePathname();
  const { startLoading } = useNavigationLoading();

  // 當前激活路徑：優先使用傳入的 activePath，否則回退到瀏覽器地址
  const currentActive = activePath ?? pathname;

  const [navItems, setNavItems] = useState([
    { icon: Home, label: '首頁', href: '/' },
    { icon: Search, label: '搜索', href: '/search' },
    {
      icon: Film,
      label: '電影',
      href: '/douban?type=movie',
    },
    {
      icon: Tv,
      label: '劇集',
      href: '/douban?type=tv',
    },
    {
      icon: Cat,
      label: '動漫',
      href: '/douban?type=anime',
    },
    {
      icon: Clover,
      label: '綜藝',
      href: '/douban?type=show',
    },
  ]);

  // 檢查是否啟用簡潔模式 - 使用狀態管理
  const [simpleMode, setSimpleMode] = useState(false);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
    if (typeof window !== 'undefined') {
      const savedSimpleMode = localStorage.getItem('simpleMode');
      if (savedSimpleMode !== null) {
        setSimpleMode(JSON.parse(savedSimpleMode));
      }
    }
  }, []);

  useEffect(() => {
    getCustomCategories().then((categories) => {
      if (categories.length > 0) {
        setNavItems((prevItems) => [
          ...prevItems,
          {
            icon: Star,
            label: '自定義',
            href: '/douban?type=custom',
          },
        ]);
      }
    });
  }, []);

  const isActive = (href: string) => {
    const typeMatch = href.match(/type=([^&]+)/)?.[1];

    // 解碼URL以進行正確的比較
    const decodedActive = decodeURIComponent(currentActive);
    const decodedItemHref = decodeURIComponent(href);

    return (
      decodedActive === decodedItemHref ||
      (decodedActive.startsWith('/douban') &&
        decodedActive.includes(`type=${typeMatch}`))
    );
  };

  return (
    <nav
      className='md:hidden fixed left-0 right-0 z-[600] bg-white/90 backdrop-blur-xl border-t border-gray-200/50 overflow-hidden dark:bg-gray-900/80 dark:border-gray-700/50'
      style={{
        /* 緊貼視口底部，同時在內部留出安全區高度 */
        bottom: 0,
        paddingBottom: 'env(safe-area-inset-bottom)',
        minHeight: 'calc(3.5rem + env(safe-area-inset-bottom))',
      }}
    >
      <ul className='flex items-center overflow-x-auto scrollbar-hide'>
        {navItems.map((item) => {
          const active = isActive(item.href);

          // 簡潔模式下只顯示首頁和搜索，但在服務器端渲染時先不渲染
          if (!isClient) {
            return null; // 服務器端渲染時不顯示任何內容，避免閃爍
          }

          if (simpleMode && !['/', '/search'].includes(item.href)) {
            return null;
          }

          return (
            <li
              key={item.href}
              className='flex-shrink-0'
              style={{
                width: simpleMode ? '50vw' : '20vw',
                minWidth: simpleMode ? '50vw' : '20vw',
              }}
            >
              <Link
                href={item.href}
                className='flex flex-col items-center justify-center w-full h-14 gap-1 text-xs'
                onClick={() => {
                  // 如果不是當前激活的鏈接，則觸發加載動畫
                  if (!active) {
                    startLoading();
                  }
                }}
              >
                <item.icon
                  className={`h-6 w-6 ${
                    active
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-gray-500 dark:text-gray-400'
                  }`}
                />
                <span
                  className={
                    active
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-gray-600 dark:text-gray-300'
                  }
                >
                  {item.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};

// 使用 React.memo 優化，避免父組件更新時導致不必要的重新渲染
export default memo(MobileBottomNav);
