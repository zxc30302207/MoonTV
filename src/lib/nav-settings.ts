/**
 * 導航欄本地設置。
 *
 * 目前僅有「自動隱藏導航欄」一項：開啟後導航欄默認收起，
 * 指針移到對應屏幕邊緣（桌面為頂部、移動端為底部）時再自動彈出，
 * 效果類似操作系統任務欄的自動隱藏。
 */

/** localStorage 中保存自動隱藏開關的鍵名 */
export const NAV_AUTO_HIDE_STORAGE_KEY = 'autoHideNav';

/** 設置變更時派發的自定義事件名（同一標簽頁內即時生效） */
export const NAV_SETTINGS_UPDATED_EVENT = 'navSettingsUpdated';

export interface NavSettings {
  /** 是否啟用導航欄自動隱藏 */
  autoHideNav: boolean;
}

const DEFAULT_NAV_SETTINGS: NavSettings = {
  autoHideNav: false,
};

/** 讀取導航欄設置（SSR 或存儲不可用時返回默認值） */
export function loadNavSettings(): NavSettings {
  if (typeof window === 'undefined') return { ...DEFAULT_NAV_SETTINGS };

  try {
    return {
      autoHideNav:
        window.localStorage.getItem(NAV_AUTO_HIDE_STORAGE_KEY) === 'true',
    };
  } catch {
    return { ...DEFAULT_NAV_SETTINGS };
  }
}

/**
 * 保存導航欄設置，並通知同一標簽頁內的導航欄組件立即響應。
 * @param patch 需要更新的字段
 * @returns 合並後的完整設置
 */
export function saveNavSettings(patch: Partial<NavSettings>): NavSettings {
  const next = { ...loadNavSettings(), ...patch };

  if (typeof window === 'undefined') return next;

  try {
    window.localStorage.setItem(
      NAV_AUTO_HIDE_STORAGE_KEY,
      String(next.autoHideNav)
    );
  } catch {
    // 隱私模式等場景寫入失敗時，本次會話內仍然保持內存狀態生效
  }

  window.dispatchEvent(new Event(NAV_SETTINGS_UPDATED_EVENT));
  return next;
}
