'use client';

import {
  Cat,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Clover,
  Compass,
  Film,
  Home,
  Search,
  Star,
  Trophy,
  Tv,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { memo, useEffect, useRef, useState } from 'react';

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
  const listRef = useRef<HTMLUListElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const updateScrollState = () => {
    const list = listRef.current;
    if (!list) return;
    setCanScrollLeft(list.scrollLeft > 1);
    setCanScrollRight(
      list.scrollLeft + list.clientWidth < list.scrollWidth - 1
    );
  };
  const scrollNavigation = (direction: number) => {
    const list = listRef.current;
    if (!list) return;
    list.scrollLeft += direction * list.clientWidth;
    updateScrollState();
  };
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
      icon: Clapperboard,
      label: '短劇',
      href: '/douban?type=short',
    },
    {
      icon: Compass,
      label: '紀錄片',
      href: '/douban?type=doc',
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
    { icon: Trophy, label: '榜單', href: '/ranking' },
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
          ...prevItems.filter((item) => item.href !== '/douban?type=custom'),
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

  useEffect(() => {
    const list = listRef.current;
    const active = list?.querySelector<HTMLAnchorElement>(
      '[aria-current="page"]'
    );
    if (list && active) {
      const item = active.parentElement;
      if (item) {
        const left = item.offsetLeft;
        const right = left + item.offsetWidth;
        if (left < list.scrollLeft) list.scrollLeft = left;
        else if (right > list.scrollLeft + list.clientWidth) {
          list.scrollLeft = right - list.clientWidth;
        }
      }
    }
    updateScrollState();
    window.addEventListener('resize', updateScrollState);
    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(updateScrollState)
        : undefined;
    if (list) observer?.observe(list);
    return () => {
      window.removeEventListener('resize', updateScrollState);
      observer?.disconnect();
    };
  }, [currentActive, isClient, simpleMode, navItems]);

  return (
    <nav
      aria-label='主要導覽'
      className='md:hidden fixed left-0 right-0 z-[600] bg-white/90 backdrop-blur-xl border-t border-gray-200/50 overflow-hidden dark:bg-gray-900/80 dark:border-gray-700/50'
      style={{
        /* 緊貼視口底部，同時在內部留出安全區高度 */
        bottom: 0,
        paddingBottom: 'env(safe-area-inset-bottom)',
        minHeight: 'calc(3.5rem + env(safe-area-inset-bottom))',
      }}
    >
      <div className='relative flex items-center'>
        {isClient && !simpleMode && (
          <button
            type='button'
            aria-label='向左捲動導覽'
            disabled={!canScrollLeft}
            onClick={() => scrollNavigation(-1)}
            className='flex h-14 w-11 shrink-0 items-center justify-center text-gray-700 disabled:opacity-25 dark:text-gray-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-green-500'
          >
            <ChevronLeft aria-hidden='true' className='h-5 w-5' />
          </button>
        )}
        <ul
          ref={listRef}
          onScroll={updateScrollState}
          className='relative flex min-w-0 flex-1 items-center overflow-x-auto scrollbar-hide'
        >
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
                  width: simpleMode ? '50vw' : 'calc((100vw - 5.5rem) / 4)',
                  minWidth: simpleMode ? '50vw' : 'calc((100vw - 5.5rem) / 4)',
                }}
              >
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className='flex flex-col items-center justify-center w-full h-14 gap-1 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-green-500'
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
        {isClient && !simpleMode && (
          <button
            type='button'
            aria-label='向右捲動，查看更多導覽'
            disabled={!canScrollRight}
            onClick={() => scrollNavigation(1)}
            className='flex h-14 w-11 shrink-0 items-center justify-center text-gray-700 disabled:opacity-25 dark:text-gray-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-green-500'
          >
            <ChevronRight aria-hidden='true' className='h-5 w-5' />
          </button>
        )}
      </div>
    </nav>
  );
};

// 使用 React.memo 優化，避免父組件更新時導致不必要的重新渲染
export default memo(MobileBottomNav);
