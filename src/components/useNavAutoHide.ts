'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  loadNavSettings,
  NAV_SETTINGS_UPDATED_EVENT,
} from '@/lib/nav-settings';

/** 屏幕邊緣觸發顯示的熱區高度（px） */
const EDGE_HOT_ZONE_PX = 24;
/** 指針離開導航後延遲收起的時長（ms） */
const HIDE_DELAY_MS = 320;

export interface NavAutoHideState {
  /** 是否啟用了自動隱藏 */
  enabled: boolean;
  /** 當前是否處於收起狀態 */
  hidden: boolean;
  /** 需要掛到導航欄根節點上，用於判斷指針/焦點是否在導航內 */
  navRef: React.MutableRefObject<HTMLElement | null>;
}

/**
 * 桌面端頂部導航欄自動隱藏（類任務欄效果）。
 *
 * 默認收起；當指針進入屏幕頂部邊緣的熱區、或懸停/聚焦在導航欄內部時展開，
 * 離開後延遲收起。設置項通過 localStorage 持久化，並監聽同頁變更事件即時生效。
 * 移動端導航欄不參與自動隱藏，始終常駐顯示。
 */
export default function useNavAutoHide(): NavAutoHideState {
  const [enabled, setEnabled] = useState(false);
  const [hidden, setHidden] = useState(false);
  const navRef = useRef<HTMLElement | null>(null);
  const hideTimerRef = useRef<number | null>(null);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const reveal = useCallback(() => {
    clearHideTimer();
    setHidden(false);
  }, [clearHideTimer]);

  const scheduleHide = useCallback(() => {
    if (hideTimerRef.current !== null) return;
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null;
      // 導航內仍有焦點（例如正在輸入搜索詞）時不收起
      const activeElement = document.activeElement;
      if (activeElement && navRef.current?.contains(activeElement)) return;
      setHidden(true);
    }, HIDE_DELAY_MS);
  }, []);

  // 讀取設置，並訂閱設置變更（同標簽頁自定義事件 + 跨標簽頁 storage）
  useEffect(() => {
    const sync = () => {
      const nextEnabled = loadNavSettings().autoHideNav;
      clearHideTimer();
      setEnabled(nextEnabled);
      setHidden(nextEnabled);
    };

    sync();
    window.addEventListener(NAV_SETTINGS_UPDATED_EVENT, sync);
    window.addEventListener('storage', sync);

    return () => {
      window.removeEventListener(NAV_SETTINGS_UPDATED_EVENT, sync);
      window.removeEventListener('storage', sync);
      clearHideTimer();
    };
  }, [clearHideTimer]);

  // 啟用後監聽指針 / 觸摸 / 焦點，決定展開還是收起
  useEffect(() => {
    if (!enabled) return;

    const isInsideNav = (target: EventTarget | null): boolean =>
      target instanceof Node && !!navRef.current?.contains(target);

    const inHotZone = (clientY: number): boolean => clientY <= EDGE_HOT_ZONE_PX;

    const handlePointerMove = (event: PointerEvent) => {
      // 觸摸設備交給 touchstart 處理，避免滑動頁面時反復觸發
      if (event.pointerType && event.pointerType !== 'mouse') return;
      if (isInsideNav(event.target) || inHotZone(event.clientY)) {
        reveal();
      } else {
        scheduleHide();
      }
    };

    const handleTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      if (isInsideNav(event.target) || inHotZone(touch.clientY)) {
        reveal();
      } else {
        scheduleHide();
      }
    };

    const handleFocusIn = (event: FocusEvent) => {
      if (isInsideNav(event.target)) reveal();
    };

    const handleFocusOut = (event: FocusEvent) => {
      if (isInsideNav(event.relatedTarget)) return;
      scheduleHide();
    };

    window.addEventListener('pointermove', handlePointerMove, {
      passive: true,
    });
    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('focusin', handleFocusIn);
    window.addEventListener('focusout', handleFocusOut);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('focusin', handleFocusIn);
      window.removeEventListener('focusout', handleFocusOut);
      clearHideTimer();
    };
  }, [enabled, reveal, scheduleHide, clearHideTimer]);

  return { enabled, hidden, navRef };
}
