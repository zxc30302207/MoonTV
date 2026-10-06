/**
 * ArtPlayer 設置面板的「低侵入」更新工具（P1-7）。
 *
 * ## 為什麼需要它
 *
 * ArtPlayer 5.3.0 的 `Setting.update()` 生產代碼等價於：
 *
 * ```js
 * update(option) {
 *   const item = this.find(option.name)
 *   if (!item) return this.add(option)
 *   this.inactivate(item)          // 解綁該 item 的 DOM 事件
 *   Object.assign(item, option)
 *   this.format()                  // 重建整棵 setting 樹
 *   this.createItem(item, true)    // 替換該 item 的 DOM
 *   this.render()                  // ← 不帶參數 = 渲染【根面板】
 *   return item
 * }
 * ```
 *
 * 也就是說 **每一次 `update()` 都會把設置面板強制彈回根面板**。
 *
 * 而「視頻緩存」的進度提示是在預取回調裡刷新的——每緩存一個分片一次，
 * 一集動輒幾百個分片。用戶剛點進「畫質」子面板就被立刻彈回根面板，
 * 表現就是"要點很多次才能進去"。
 *
 * ## 解法
 *
 * 只改 tooltip / switch / html 這類**葉子狀態**時，直接寫 ArtPlayer 暴露的
 * DOM setter：`createItem()` 裡對 `tooltip` / `html` / `switch` 都定義了
 * `Object.defineProperty` 的 setter，setter 內部只改對應節點，不觸發 `render()`。
 *
 * 只有必須替換 `selector`（畫質檔位列表）時才走 `update()`，
 * 並且用 `updateSettingPreservingPanel()` 把面板層級恢復回來。
 */

/** ArtPlayer 實例的寬松類型（官方 .d.ts 未聲明 setting 的細節） */
export interface ArtPlayerLike {
  setting?: {
    find?: (name?: string) => SettingItemLike | null;
    update?: (option: Record<string, unknown>) => unknown;
    render?: (option?: unknown) => void;
    show?: boolean;
    active?: unknown;
    option?: unknown;
  } | null;
  [key: string]: unknown;
}

/** 設置項的寬松類型 */
export interface SettingItemLike {
  name?: string;
  html?: unknown;
  tooltip?: unknown;
  switch?: boolean;
  selector?: unknown;
  [key: string]: unknown;
}

/** 取設置項；播放器已銷毀 / 尚未就緒時返回 null，不拋異常 */
export function findSettingItem(
  art: ArtPlayerLike | null | undefined,
  name: string
): SettingItemLike | null {
  try {
    const item = art?.setting?.find?.(name);
    return item ?? null;
  } catch {
    return null;
  }
}

/**
 * 更新設置項的右側提示文案。
 * 走 DOM setter，**不會**觸發 `render()`，因此不會打斷用戶當前所在的面板層級。
 */
export function setSettingTooltip(
  art: ArtPlayerLike | null | undefined,
  name: string,
  text: string
): boolean {
  const item = findSettingItem(art, name);
  if (!item) return false;
  try {
    item.tooltip = text;
    return true;
  } catch {
    return false;
  }
}

/** 更新設置項左側標題（同樣是 DOM setter，不觸發 render） */
export function setSettingHtml(
  art: ArtPlayerLike | null | undefined,
  name: string,
  html: string
): boolean {
  const item = findSettingItem(art, name);
  if (!item) return false;
  try {
    item.html = html;
    return true;
  } catch {
    return false;
  }
}

/** 更新開關狀態（DOM setter 會同步切換開/關兩個圖標） */
export function setSettingSwitch(
  art: ArtPlayerLike | null | undefined,
  name: string,
  on: boolean
): boolean {
  const item = findSettingItem(art, name);
  if (!item) return false;
  try {
    item.switch = on;
    return true;
  } catch {
    return false;
  }
}

/**
 * 必須替換 `selector` 等結構性字段時用它。
 *
 * `update()` 之後把面板層級恢復回調用前的位置：
 * - 原來停在根面板 → 恢復根面板
 * - 原來停在該項的**子面板** → 用**更新後的** selector 數組重新進入子面板
 *   （`update()` 會重建 selector 數組，舊的引用已經不在 `cache` 裡了）
 *
 * 面板未展開時不做任何恢復，避免把關閉狀態的面板頂開。
 */
export function updateSettingPreservingPanel(
  art: ArtPlayerLike | null | undefined,
  patch: Record<string, unknown> & { name: string }
): boolean {
  const setting = art?.setting;
  if (!setting?.update) return false;

  const wasShow = setting.show === true;
  const previousActive = setting.active;
  const previousSelector = findSettingItem(art, patch.name)?.selector;

  try {
    setting.update(patch);
  } catch {
    return false;
  }

  if (!wasShow) return true;

  try {
    const updated = findSettingItem(art, patch.name);
    const stayInSubPanel =
      previousSelector !== undefined &&
      previousActive === previousSelector &&
      updated?.selector !== undefined;

    const target = stayInSubPanel ? updated?.selector : previousActive;
    if (target) setting.render?.(target);
    setting.show = true;
  } catch {
    // 面板結構可能剛被重建，忽略
  }

  return true;
}
