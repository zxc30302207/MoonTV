'use client';

import {
  Cat,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Clover,
  Compass,
  Film,
  GripVertical,
  Home,
  Search,
  Star,
  Trophy,
  Tv,
  UsersRound,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { memo, useEffect, useMemo, useRef, useState } from 'react';

import { getCustomCategories } from '@/lib/config.client';
import {
  applyNavMenuOrder,
  loadNavMenuOrder,
  NAV_ORDER_UPDATED_EVENT,
  saveNavMenuOrder,
} from '@/lib/nav-settings';

import { useNavigationLoading } from './NavigationLoadingProvider';
import useDragScroll from './useDragScroll';

interface MobileBottomNavProps {
  /**
   * 主動指定當前激活的路徑。當未提供時，自動使用 usePathname() 獲取的路徑。
   */
  activePath?: string;
}

const MobileBottomNav = ({ activePath }: MobileBottomNavProps) => {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { startLoading } = useNavigationLoading();

  // 保留查詢參數，讓同一路徑的不同分類也能正確高亮。
  const query = searchParams?.toString();
  const currentActive =
    activePath ?? (query ? `${pathname}?${query}` : pathname);

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
    {
      icon: Trophy,
      label: '榜單',
      href: '/ranking',
    },
    {
      icon: UsersRound,
      label: '觀影室',
      href: '/watch-room',
    },
  ]);

  // 檢查是否啟用簡潔模式 - 使用狀態管理
  const [simpleMode, setSimpleMode] = useState(false);
  const [isClient, setIsClient] = useState(false);
  // 用户自定义的底部导航顺序（长按拖動调整后持久化）
  const [menuOrder, setMenuOrder] = useState<string[]>([]);

  // 横向滚动容器 + 长按拖動排序
  const [showHint, setShowHint] = useState(false);
  const hintTimerRef = useRef<number | null>(null);

  const {
    containerRef: listRef,
    canScrollLeft,
    canScrollRight,
    isReordering,
    isLongPressing,
    handleClickCapture,
    updateScrollState,
  } = useDragScroll<HTMLUListElement>({
    onReorder: (order) => {
      setMenuOrder(order);
      // 与桌面端共用同一份顺序（保存时自动合并两端独有的菜单项）
      saveNavMenuOrder(order);
    },
  });

  const scrollNavigation = (direction: number) => {
    const list = listRef.current;
    if (!list) return;
    list.scrollLeft += direction * list.clientWidth;
    updateScrollState();
  };

  useEffect(() => {
    setIsClient(true);
    try {
      setSimpleMode(localStorage.getItem('simpleMode') === 'true');
    } catch {
      // Keep navigation usable when browser storage is unavailable.
    }
    setMenuOrder(loadNavMenuOrder());
    const onOrderUpdated = () => setMenuOrder(loadNavMenuOrder());
    window.addEventListener(NAV_ORDER_UPDATED_EVENT, onOrderUpdated);
    return () =>
      window.removeEventListener(NAV_ORDER_UPDATED_EVENT, onOrderUpdated);
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
  // 简洁模式下只保留首页 / 搜索 / 觀影室，再套用自定义顺序
  const visibleItems = useMemo(
    () =>
      applyNavMenuOrder(
        navItems.filter(
          (item) =>
            !simpleMode || ['/', '/search', '/watch-room'].includes(item.href)
        ),
        (item) => item.href,
        menuOrder
      ),
    [navItems, simpleMode, menuOrder]
  );

  // 排序前后项数变化时刷新溢出提示状态
  useEffect(() => {
    updateScrollState();
  }, [visibleItems.length, updateScrollState]);

  // 首次进入时给一次「長按可調整順序」的引导（触屏没有 hover，必须主动提示）
  useEffect(() => {
    if (!isClient || menuOrder.length > 0) return;
    if (typeof window === 'undefined') return;

    const seenKey = 'navBottomReorderHintSeen';
    try {
      if (window.sessionStorage.getItem(seenKey) === 'true') return;
    } catch {
      // Storage may be unavailable in private browsing.
    }

    setShowHint(true);
    hintTimerRef.current = window.setTimeout(() => {
      setShowHint(false);
      try {
        window.sessionStorage.setItem(seenKey, 'true');
      } catch {
        /* 忽略存储异常 */
      }
    }, 5200);

    return () => {
      if (hintTimerRef.current !== null) {
        window.clearTimeout(hintTimerRef.current);
        hintTimerRef.current = null;
      }
    };
  }, [isClient, menuOrder.length]);

  // 一旦开始长按或排序，就不再显示引导
  useEffect(() => {
    if (isLongPressing || isReordering) {
      setShowHint(false);
      try {
        window.sessionStorage.setItem('navBottomReorderHintSeen', 'true');
      } catch {
        /* 忽略存储异常 */
      }
    }
  }, [isLongPressing, isReordering]);

  const isActive = (href: string) => {
    const [itemPath, itemQuery = ''] = href.split('?');
    const [currentPath, currentQuery = ''] = currentActive.split('?');
    if (currentPath !== itemPath) return false;
    if (!itemQuery) return true;
    const itemType = new URLSearchParams(itemQuery).get('type');
    const currentType =
      new URLSearchParams(currentQuery).get('type') ??
      (itemPath === '/douban' ? 'movie' : null);
    return itemType !== null && itemType === currentType;
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
  }, [
    currentActive,
    isClient,
    simpleMode,
    visibleItems,
    listRef,
    updateScrollState,
  ]);

  return (
    <nav
      aria-label='主要導覽'
      className='mobile-bottom-nav md:hidden fixed left-0 right-0 z-[600] bg-white/90 backdrop-blur-xl border-t border-gray-200/50 overflow-hidden dark:bg-gray-900/80 dark:border-gray-700/50'
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
          onClickCapture={handleClickCapture}
          onDragStart={(event) => event.preventDefault()}
          data-reordering={isReordering}
          onScroll={updateScrollState}
          className={`mobile-bottom-nav__list relative flex min-w-0 flex-1 items-center overflow-x-auto scrollbar-hide${
            isReordering ? ' is-reordering' : ''
          }`}
        >
          {visibleItems.map((item) => {
            const active = isActive(item.href);

            // 簡潔模式下只顯示首頁和搜索，但在服務器端渲染時先不渲染
            if (!isClient) {
              return null; // 服務器端渲染時不顯示任何內容，避免閃爍
            }

            return (
              <li
                key={item.href}
                data-nav-key={item.href}
                className='flex-shrink-0'
                style={{
                  width: simpleMode ? '33.333vw' : 'calc((100vw - 5.5rem) / 4)',
                  minWidth: simpleMode
                    ? '33.333vw'
                    : 'calc((100vw - 5.5rem) / 4)',
                }}
              >
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className='mobile-bottom-nav__link relative flex flex-col items-center justify-center w-full h-14 gap-1 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-green-500'
                  onClick={() => {
                    // 如果不是當前激活的鏈接，則觸發加載動畫
                    if (!active) {
                      startLoading();
                    }
                  }}
                >
                  <GripVertical
                    aria-hidden
                    className='top-nav__drag-handle absolute top-0.5 right-1 h-2.5 w-2.5'
                  />
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
      {/* 首次进入的引导：長按可拖動調整順序 */}
      {showHint && !isReordering && (
        <div className='top-nav__scroll-hint' role='status'>
          <span>
            <b>長按選單</b>可拖動調整順序
          </span>
        </div>
      )}

      {/* 长按等待中：提示繼續按住 */}
      {isLongPressing && !isReordering && (
        <div
          className='top-nav__reorder-tip top-nav__reorder-tip--pressing'
          role='status'
        >
          繼續按住，可拖動調整順序
        </div>
      )}

      {/* 排序中的状态提示 */}
      {isReordering && (
        <div className='top-nav__reorder-tip' role='status'>
          拖到目標位置後鬆開，即可儲存
        </div>
      )}
    </nav>
  );
};

// 使用 React.memo 優化，避免父組件更新時導致不必要的重新渲染
export default memo(MobileBottomNav);
