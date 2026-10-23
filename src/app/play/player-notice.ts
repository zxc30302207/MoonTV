/**
 * 播放器右上角的堆疊式文字提示：新提示在最上方，到期逐條移除。
 * 數量超過上限時進入待顯示隊列，騰出槽位後按入隊順序補位展示。
 * 位置與樣式見 globals.css 的 `.moontv-notice-stack`。
 */

const STACK_CLASS = 'moontv-notice-stack';
const ITEM_CLASS = 'moontv-notice-item';

/** 同時最多展示的提示條數，避免遮擋畫面 */
const MAX_VISIBLE_ITEMS = 4;

/** 待顯示隊列長度上限，超出時丟棄最早的排隊項，避免長時間播放時無限堆積 */
const MAX_QUEUED_ITEMS = 20;

/** 默認停留時間（毫秒） */
export const PLAYER_NOTICE_DEFAULT_DURATION_MS = 4000;

/** 只需要播放器模板與內置 notice：結構化類型，兼容 Artplayer 與測試 mock */
export interface PlayerNoticeTarget {
  template?: { $player?: unknown };
  notice?: { show?: string };
}

export interface PlayerNoticeOptions {
  /** 去重鍵：同鍵只更新文字並重新計時，不新增條目 */
  key?: string;
  /** 停留毫秒數；`<= 0` 表示常駐 */
  durationMs?: number;
}

type NoticeItem = HTMLElement & { noticeTimer?: number };

/** 尚未上屏的提示 */
interface QueuedNotice {
  message: string;
  key?: string;
  durationMs: number;
}

/** 每個播放器（提示棧）一條獨立隊列；棧元素被銷毀後由 WeakMap 自動回收 */
const pendingQueues = new WeakMap<HTMLElement, QueuedNotice[]>();

function getPlayerElement(
  art: PlayerNoticeTarget | null | undefined
): HTMLElement | null {
  const player = art?.template?.$player;
  return player instanceof HTMLElement ? player : null;
}

function getStack(
  art: PlayerNoticeTarget | null | undefined,
  create: boolean
): HTMLElement | null {
  const player = getPlayerElement(art);
  if (!player) return null;

  const existing = player.querySelector<HTMLElement>(`.${STACK_CLASS}`);
  if (existing || !create) return existing;

  const stack = document.createElement('div');
  stack.className = STACK_CLASS;
  player.appendChild(stack);
  return stack;
}

function getQueue(stack: HTMLElement): QueuedNotice[] {
  let queue = pendingQueues.get(stack);
  if (!queue) {
    queue = [];
    pendingQueues.set(stack, queue);
  }
  return queue;
}

function clearTimer(item: NoticeItem): void {
  if (item.noticeTimer !== undefined) {
    window.clearTimeout(item.noticeTimer);
    item.noticeTimer = undefined;
  }
}

/** 僅從 DOM 摘除條目，不觸發補位（清空類操作使用） */
function detachItem(item: NoticeItem): void {
  clearTimer(item);
  item.remove();
}

/** 把一條提示渲染到棧末尾並開始計時 */
function renderItem(stack: HTMLElement, notice: QueuedNotice): void {
  const item = document.createElement('div') as NoticeItem;
  item.className = ITEM_CLASS;
  if (notice.key) item.dataset.noticeKey = notice.key;
  item.textContent = notice.message;
  stack.appendChild(item);
  scheduleRemoval(item, stack, notice.durationMs);
}

/** 棧內騰出空位後，按入隊順序補足到上限 */
function drainQueue(stack: HTMLElement): void {
  const queue = pendingQueues.get(stack);
  if (!queue || queue.length === 0) return;

  while (stack.children.length < MAX_VISIBLE_ITEMS && queue.length > 0) {
    const next = queue.shift();
    if (!next) break;
    renderItem(stack, next);
  }
}

function removeItem(item: NoticeItem, stack: HTMLElement): void {
  detachItem(item);
  drainQueue(stack);
}

function scheduleRemoval(
  item: NoticeItem,
  stack: HTMLElement,
  durationMs: number
): void {
  clearTimer(item);
  if (!(durationMs > 0)) return;
  item.noticeTimer = window.setTimeout(
    () => removeItem(item, stack),
    durationMs
  );
}

/** 追加一條提示；模板未就緒時退回內置 notice */
export function pushPlayerNotice(
  art: PlayerNoticeTarget | null | undefined,
  text: string,
  options: PlayerNoticeOptions = {}
): void {
  const message = (text || '').trim();
  if (!message) return;

  const stack = getStack(art, true);
  if (!stack) {
    try {
      if (art?.notice) art.notice.show = message;
    } catch {
      // ArtPlayer 可能已銷毀
    }
    return;
  }

  const { key, durationMs = PLAYER_NOTICE_DEFAULT_DURATION_MS } = options;
  const queue = getQueue(stack);

  if (key) {
    // 已上屏：只更新文字並續期，位置不變
    const shown = Array.from(stack.children).find(
      (child) => (child as HTMLElement).dataset.noticeKey === key
    ) as NoticeItem | undefined;
    if (shown) {
      shown.textContent = message;
      scheduleRemoval(shown, stack, durationMs);
      return;
    }

    // 已在隊列中等待：同樣只更新，不重復排隊
    const queued = queue.find((notice) => notice.key === key);
    if (queued) {
      queued.message = message;
      queued.durationMs = durationMs;
      return;
    }
  }

  const notice: QueuedNotice = { message, key, durationMs };

  if (stack.children.length < MAX_VISIBLE_ITEMS) {
    renderItem(stack, notice);
    return;
  }

  queue.push(notice);
  while (queue.length > MAX_QUEUED_ITEMS) {
    queue.shift();
  }
}

/** 不傳 key 清空全部（含排隊項）；傳 key 只移除同類提示 */
export function clearPlayerNotices(
  art: PlayerNoticeTarget | null | undefined,
  key?: string
): void {
  const stack = getStack(art, false);
  if (!stack) return;

  const queue = pendingQueues.get(stack);

  // 先處理隊列，避免移除條目時觸發補位把待清空的提示又放回棧裡
  if (queue) {
    if (key === undefined) {
      queue.length = 0;
    } else {
      for (let index = queue.length - 1; index >= 0; index--) {
        if (queue[index].key === key) queue.splice(index, 1);
      }
    }
  }

  Array.from(stack.children).forEach((child) => {
    const item = child as NoticeItem;
    if (key === undefined || item.dataset.noticeKey === key) {
      detachItem(item);
    }
  });

  // 全部清空是"重置"語義，不補位；按鍵清除後空位應交還給排隊提示
  if (key !== undefined) drainQueue(stack);
}
