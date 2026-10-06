/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/ban-types */

/**
 * 官方插件在 config({ fontSize }) 時會 reset()，把正在飛的彈幕全部清掉重排。
 * 這裡跳過 reset，已上屏彈幕保持原樣；新彈幕用新字號。
 * 字號僅在停止拖動（pointerup）時應用到彈幕並寫入本地；拖動過程中滑條數字仍會變。
 * 不透明度拖動時仍即時生效，寫入本地延遲 160ms。
 *
 * 官方 getDanmuTop 在找不到等高空隙時，會把新彈幕塞進舊彈幕的 top。
 * 字號變大後軌道實際變高，仍用舊 top 就會壓到下一行。因此攔截 postMessage，
 * 按當前彈幕高度重算軌道數，只有整條軌道空閒（或滾動彈幕同軌且不會追上）才佔用。
 */

type VisibleDanmu = {
  top: number;
  height: number;
  right: number;
  speed: number;
  distance: number;
  time: number;
  mode: number;
};

type DanmuTopTarget = {
  mode: number;
  height: number;
  speed: number;
};

function isDanmukuInstance(value: unknown): value is Record<string, any> {
  if (!value || typeof value !== 'object') return false;
  const inst = value as Record<string, any>;
  return (
    Array.isArray(inst.queue) &&
    inst.states &&
    inst.$danmuku &&
    typeof inst.config === 'function' &&
    typeof inst.makeWait === 'function' &&
    typeof inst.filter === 'function'
  );
}

function verticalOverlap(
  top: number,
  height: number,
  item: VisibleDanmu
): boolean {
  return item.top < top + height && item.top + item.height > top;
}

/** 與官方一致：滾動彈幕同軌時，判斷後發的會不會追上前面的 */
function canShareScrollLane(
  target: DanmuTopTarget,
  item: VisibleDanmu,
  clientWidth: number
): boolean {
  if (clientWidth < item.distance) return false;
  if (target.speed < item.speed) return true;
  const speedDiff = target.speed - item.speed;
  if (speedDiff <= 0) return true;
  return item.right / speedDiff > item.time;
}

function isLaneBlocked(
  top: number,
  target: DanmuTopTarget,
  visibles: VisibleDanmu[],
  clientWidth: number,
  antiOverlap: boolean
): boolean {
  for (let i = 0; i < visibles.length; i += 1) {
    const item = visibles[i];
    if (item.mode !== target.mode) continue;
    if (!verticalOverlap(top, target.height, item)) continue;

    // 不同起點的彈幕落在新軌道高度內：一定縱向重疊，不能佔用
    const sameRow = Math.abs(item.top - top) < 1;
    if (!sameRow) return true;

    if (target.mode !== 0) return true;
    if (antiOverlap && !canShareScrollLane(target, item, clientWidth)) {
      return true;
    }
  }
  return false;
}

function computeDanmuTop(payload: {
  target: DanmuTopTarget;
  visibles?: VisibleDanmu[];
  antiOverlap?: boolean;
  clientWidth: number;
  clientHeight: number;
  marginBottom: number;
  marginTop: number;
}): number | undefined {
  const {
    target,
    visibles = [],
    antiOverlap = true,
    clientWidth,
    clientHeight,
    marginBottom,
    marginTop,
  } = payload;

  const height = Math.max(1, Number(target.height) || 0);
  const minTop = Math.max(0, marginTop);
  const maxBottom = Math.max(minTop, clientHeight - marginBottom);
  const usable = maxBottom - minTop;

  const tryLane = (top: number) =>
    !isLaneBlocked(top, target, visibles, clientWidth, antiOverlap);

  if (height > usable) {
    const top = target.mode === 2 ? maxBottom - height : minTop;
    return tryLane(top) ? top : undefined;
  }

  const laneCount = Math.max(1, Math.floor(usable / height));

  if (target.mode === 2) {
    for (let i = 0; i < laneCount; i += 1) {
      const top = maxBottom - height * (i + 1);
      if (top < minTop) continue;
      if (tryLane(top)) return top;
    }
    return undefined;
  }

  for (let i = 0; i < laneCount; i += 1) {
    const top = minTop + i * height;
    if (top + height > maxBottom + 0.5) continue;
    if (tryLane(top)) return top;
  }

  return undefined;
}

function patchDanmukuConfig(danmuku: Record<string, any>) {
  if (danmuku.__moontvLiveFontSizePatched) return;
  danmuku.__moontvLiveFontSizePatched = true;

  const originalConfig = danmuku.config.bind(danmuku);
  const originalPostMessage = danmuku.postMessage.bind(danmuku);
  const proto = Object.getPrototypeOf(danmuku);
  const originalFontSizeGet = Object.getOwnPropertyDescriptor(
    proto,
    'fontSize'
  )?.get;

  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingFontSize: unknown;
  let draggingFontSize = false;

  const flushPersist = () => {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    if (pendingFontSize !== undefined) {
      danmuku.option.fontSize = pendingFontSize;
      pendingFontSize = undefined;
    }
    draggingFontSize = false;
    danmuku.art?.emit('artplayerPluginDanmuku:config', danmuku.option);
  };

  const schedulePersist = () => {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(flushPersist, 160);
  };

  const onPointerUp = () => {
    if (pendingFontSize === undefined) return;
    flushPersist();
  };

  // 滑條 onChange 會讀 danmuku.fontSize。只返回已生效字號，避免拖動中 pending 被繪制進彈幕。
  // 數字字號不再讀 player.clientHeight，以免拖動時強制布局。
  Object.defineProperty(danmuku, 'fontSize', {
    configurable: true,
    enumerable: false,
    get() {
      const raw = danmuku.option?.fontSize;
      if (typeof raw === 'number' && Number.isFinite(raw)) {
        return Math.round(Math.min(120, Math.max(12, raw)));
      }
      return originalFontSizeGet ? originalFontSizeGet.call(danmuku) : 25;
    },
  });

  danmuku.config = function patchedConfig(option: any, isInit = false) {
    if (isInit || !option || typeof option !== 'object') {
      return originalConfig(option, isInit);
    }

    const hasFontSize = option.fontSize != null;
    const hasOpacity = typeof option.opacity === 'number';
    if (!hasFontSize && !hasOpacity) {
      return originalConfig(option, isInit);
    }

    const { fontSize, opacity, ...rest } = option;
    const hasRest = Object.keys(rest).length > 0;
    const result = hasRest ? originalConfig(rest, isInit) : danmuku;

    if (hasOpacity) {
      danmuku.option.opacity = Math.min(1, Math.max(0, opacity));
      schedulePersist();
    }

    if (hasFontSize) {
      pendingFontSize = fontSize;
      draggingFontSize = true;
    }

    return result;
  };

  danmuku.postMessage = function patchedPostMessage(message: any = {}) {
    if (message?.type === 'getDanmuTop' && message.target) {
      // 拖動字號時把軌道計算交回 Worker，避免和指針事件搶主線程
      if (draggingFontSize) {
        return originalPostMessage(message);
      }
      return Promise.resolve({
        id: message.id ?? Date.now(),
        result: computeDanmuTop(message),
      });
    }
    return originalPostMessage(message);
  };

  // Setting 會在當前同步棧裡注冊 document:pointerup；推遲到其後，才能在滑條最後一次 onChange 之後應用字號
  queueMicrotask(() => {
    danmuku.art?.on('document:pointerup', onPointerUp);
    danmuku.art?.on('document:pointercancel', onPointerUp);
  });
}

/**
 * 包裝官方彈幕插件：在 Danmuku 實例 bind 方法時立刻改寫 config / postMessage，
 * 才能攔住設置面板滑條裡的 fontSize / opacity。
 */
export function wrapArtplayerPluginDanmuku(factory: any) {
  if (typeof factory !== 'function') return factory;

  const wrapped = (option: any) => (art: any) => {
    const originalBind = Function.prototype.bind;
    Function.prototype.bind = function patchedBind(
      this: Function,
      thisArg: any,
      ...boundArgs: any[]
    ) {
      if (isDanmukuInstance(thisArg)) {
        patchDanmukuConfig(thisArg);
      }
      return originalBind.apply(this, [thisArg, ...boundArgs] as [
        any,
        ...any[]
      ]);
    };

    try {
      return factory(option)(art);
    } finally {
      Function.prototype.bind = originalBind;
    }
  };

  wrapped.icons = factory.icons;
  return wrapped;
}
