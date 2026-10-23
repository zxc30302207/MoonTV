import type Artplayer from 'artplayer';

/**
 * 移動端播放器手勢反饋與雙擊快進/快退。
 *
 * 橫向滑動與進度條拖動由 `deferred-progress-seek.ts` 統一接管，這裡只提供：
 * - 手勢過程中的 HUD（時間 / 音量 / 亮度）與亮度遮罩；
 * - 雙擊畫面左右兩側快退 / 快進；
 * - 供拖動模塊調用的音量、亮度回調。
 */

export type VerticalGestureSide = 'left' | 'right';

export type DoubleTapSide = 'backward' | 'forward';

/** 雙擊前後跳轉的秒數 */
export const DOUBLE_TAP_SEEK_SECONDS = 10;

/** 雙擊左右兩側的判定寬度佔比（中間區域保持播放/暫停） */
export const DOUBLE_TAP_SIDE_RATIO = 0.35;

/** 垂直滑動多少屏高對應 100% 音量 / 亮度變化 */
export const VERTICAL_FULL_RANGE_RATIO = 0.72;

/** 亮度下限，避免滑到全黑後無法操作 */
export const MIN_BRIGHTNESS = 0.15;

/** 亮度遮罩的最大不透明度 */
const MAX_DIM_OPACITY = 0.9;

/** 長按進入倍速播放的倍率 */
export const LONG_PRESS_RATE = 2;

/** 長按判定時長（毫秒） */
export const LONG_PRESS_DELAY_MS = 500;

const BRIGHTNESS_STORAGE_KEY = 'moontv:player-brightness';
const HUD_HIDE_DELAY_MS = 500;

/** 全屏下垂直滑動：左半屏亮度、右半屏音量 */
export interface VerticalSwipeHandlers {
  /** 返回 false 表示本次手勢不接管 */
  start: (side: VerticalGestureSide) => boolean;
  /** delta > 0 表示向上滑（增大） */
  move: (delta: number) => void;
  end: (cancelled: boolean) => void;
}

/** 長按倍速播放 */
export interface LongPressHandlers {
  /** 返回 false 表示本次不進入倍速（例如暫停狀態） */
  start: () => boolean;
  end: () => void;
}

export interface MobileGestureFeedback {
  vertical: VerticalSwipeHandlers;
  longPress: LongPressHandlers;
  destroy: () => void;
}

/** 限制到 0-1 */
export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** 以手勢起點 x 判斷落在左半屏還是右半屏 */
export function resolveVerticalSide(
  clientX: number,
  rect: { left: number; width: number }
): VerticalGestureSide {
  if (!(rect.width > 0)) return 'right';
  return clientX - rect.left < rect.width / 2 ? 'left' : 'right';
}

/**
 * 根據垂直位移換算新值。
 *
 * `delta` 是「向上為正、按播放器高度歸一化」的位移。
 */
export function applySwipeDelta(startValue: number, delta: number): number {
  return clamp01(startValue + delta / VERTICAL_FULL_RANGE_RATIO);
}

/** 雙擊落在哪一側；中間區域返回 null，交回播放器默認的播放/暫停 */
export function resolveDoubleTapSide(
  clientX: number,
  rect: { left: number; width: number }
): DoubleTapSide | null {
  if (!(rect.width > 0)) return null;
  const ratio = (clientX - rect.left) / rect.width;
  if (ratio <= DOUBLE_TAP_SIDE_RATIO) return 'backward';
  if (ratio >= 1 - DOUBLE_TAP_SIDE_RATIO) return 'forward';
  return null;
}

/** 雙擊後的目標時間；時長不可用時返回 null */
export function doubleTapSeekTarget(
  currentTime: number,
  duration: number,
  side: DoubleTapSide
): number | null {
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const delta =
    side === 'forward' ? DOUBLE_TAP_SEEK_SECONDS : -DOUBLE_TAP_SEEK_SECONDS;
  const base = Number.isFinite(currentTime) ? currentTime : 0;
  return Math.min(duration, Math.max(0, base + delta));
}

/** 快進/快退提示用的緊湊時間格式 */
export function formatGestureClock(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(rest)}`
    : `${minutes}:${pad(rest)}`;
}

interface HudElements {
  root: HTMLElement;
  label: HTMLElement;
  track: HTMLElement;
  bar: HTMLElement;
}

interface GestureHud {
  show: (
    kind: 'seek' | 'volume' | 'brightness',
    label: string,
    percent?: number | null,
    autoHideMs?: number
  ) => void;
  hide: (delayMs?: number) => void;
  destroy: () => void;
}

function ensureHud(art: Artplayer): HudElements | null {
  const player = art.template?.$player;
  if (!(player instanceof HTMLElement)) return null;

  const existing = player.querySelector<HTMLElement>('.moontv-gesture-hud');
  if (existing) {
    const label = existing.querySelector<HTMLElement>(
      '.moontv-gesture-hud-text'
    );
    const track = existing.querySelector<HTMLElement>(
      '.moontv-gesture-hud-track'
    );
    const bar = existing.querySelector<HTMLElement>('.moontv-gesture-hud-bar');
    if (label && track && bar) {
      return { root: existing, label, track, bar };
    }
    existing.remove();
  }

  const root = document.createElement('div');
  root.className = 'moontv-gesture-hud';
  root.setAttribute('aria-hidden', 'true');

  const label = document.createElement('div');
  label.className = 'moontv-gesture-hud-text';

  const track = document.createElement('div');
  track.className = 'moontv-gesture-hud-track';
  const bar = document.createElement('div');
  bar.className = 'moontv-gesture-hud-bar';
  track.appendChild(bar);

  root.append(label, track);
  player.appendChild(root);
  return { root, label, track, bar };
}

function createGestureHud(art: Artplayer): GestureHud {
  const elements = ensureHud(art);
  let hideTimer: number | null = null;

  const clearTimer = () => {
    if (hideTimer !== null) {
      window.clearTimeout(hideTimer);
      hideTimer = null;
    }
  };

  const hide = (delayMs = 0) => {
    if (!elements) return;
    clearTimer();
    if (delayMs > 0) {
      hideTimer = window.setTimeout(() => {
        hideTimer = null;
        elements.root.classList.remove('is-visible');
      }, delayMs);
      return;
    }
    elements.root.classList.remove('is-visible');
  };

  const show: GestureHud['show'] = (
    kind,
    label,
    percent = null,
    autoHideMs = 0
  ) => {
    if (!elements) return;
    clearTimer();
    elements.root.dataset.kind = kind;
    elements.label.textContent = label;
    const hasPercent = typeof percent === 'number' && Number.isFinite(percent);
    elements.track.style.display = hasPercent ? '' : 'none';
    if (hasPercent) {
      elements.bar.style.width = `${Math.min(100, Math.max(0, percent))}%`;
    }
    elements.root.classList.add('is-visible');
    if (autoHideMs > 0) hide(autoHideMs);
  };

  return {
    show,
    hide,
    destroy: () => {
      clearTimer();
      elements?.root.remove();
    },
  };
}

function readStoredBrightness(): number {
  try {
    const raw = window.sessionStorage.getItem(BRIGHTNESS_STORAGE_KEY);
    if (raw === null) return 1;
    const value = Number(raw);
    if (!Number.isFinite(value)) return 1;
    return Math.min(1, Math.max(MIN_BRIGHTNESS, value));
  } catch {
    return 1;
  }
}

function persistBrightness(value: number): void {
  try {
    window.sessionStorage.setItem(BRIGHTNESS_STORAGE_KEY, value.toFixed(2));
  } catch {
    // 隱私模式等場景忽略即可
  }
}

function ensureDimLayer(art: Artplayer): HTMLElement | null {
  const player = art.template?.$player;
  if (!(player instanceof HTMLElement)) return null;

  const existing = player.querySelector<HTMLElement>('.moontv-gesture-dim');
  if (existing) return existing;

  const layer = document.createElement('div');
  layer.className = 'moontv-gesture-dim';
  player.appendChild(layer);
  return layer;
}

function applyBrightness(layer: HTMLElement | null, value: number): void {
  if (!layer) return;
  const opacity = (1 - clamp01(value)) * MAX_DIM_OPACITY;
  layer.style.opacity = opacity.toFixed(3);
}

/** 判斷當前是否移動端播放器，避免桌面端雙擊全屏被手勢邏輯搶走 */
export function isMobilePlayer(art: Artplayer): boolean {
  try {
    if (art.template?.$player?.classList?.contains('art-mobile')) return true;
    const utils = (
      art.constructor as unknown as { utils?: { isMobile?: boolean } }
    )?.utils;
    return utils?.isMobile === true;
  } catch {
    return false;
  }
}

/**
 * 綁定移動端手勢反饋。
 *
 * 返回的 `vertical` / `longPress` 交給 `bindDeferredProgressSeek`，由同一套
 * touch 狀態機驅動，避免兩個模塊各自 preventDefault 互相打架。
 */
export function bindMobileGestures(art: Artplayer): MobileGestureFeedback {
  const hud = createGestureHud(art);
  const dimLayer = ensureDimLayer(art);

  let activeVertical: VerticalGestureSide | null = null;
  let volumeStart = 0;
  let brightnessStart = 1;
  let brightness = readStoredBrightness();
  applyBrightness(dimLayer, brightness);

  const vertical: VerticalSwipeHandlers = {
    start(side) {
      activeVertical = side;
      if (side === 'left') {
        brightnessStart = brightness;
        hud.show(
          'brightness',
          `亮度 ${Math.round(brightness * 100)}%`,
          brightness * 100
        );
        return true;
      }
      volumeStart = clamp01(Number(art.volume) || 0);
      hud.show(
        'volume',
        `音量 ${Math.round(volumeStart * 100)}%`,
        volumeStart * 100
      );
      return true;
    },
    move(delta) {
      if (activeVertical === 'left') {
        brightness = Math.max(
          MIN_BRIGHTNESS,
          applySwipeDelta(brightnessStart, delta)
        );
        applyBrightness(dimLayer, brightness);
        hud.show(
          'brightness',
          `亮度 ${Math.round(brightness * 100)}%`,
          brightness * 100
        );
        return;
      }
      if (activeVertical === 'right') {
        const next = applySwipeDelta(volumeStart, delta);
        try {
          const media = art.video;
          if (media) {
            media.muted = false;
            // 直接寫 video，避免 art.volume 每次觸發原生音量 notice
            media.volume = next;
          }
        } catch {
          // 播放器可能正在銷毀
        }
        hud.show('volume', `音量 ${Math.round(next * 100)}%`, next * 100);
      }
    },
    end() {
      if (activeVertical === 'left') persistBrightness(brightness);
      if (activeVertical === 'right') {
        try {
          art.storage?.set?.('volume', art.video?.volume ?? 0);
        } catch {
          // 忽略存儲失敗
        }
      }
      activeVertical = null;
      hud.hide(HUD_HIDE_DELAY_MS);
    },
  };

  let longPressActive = false;
  let longPressPreviousRate = 1;
  const longPress: LongPressHandlers = {
    start() {
      if (longPressActive) return true;
      if (art.isLock || !art.playing) return false;
      const previous = Number(art.playbackRate) || 1;
      if (previous >= LONG_PRESS_RATE) return false;
      try {
        art.playbackRate = LONG_PRESS_RATE;
      } catch {
        return false;
      }
      longPressPreviousRate = previous;
      longPressActive = true;
      // 設置 playbackRate 會觸發 Artplayer 原生的「倍速: 2.0x」提示
      return true;
    },
    end() {
      if (!longPressActive) return;
      longPressActive = false;
      try {
        art.playbackRate = longPressPreviousRate;
      } catch {
        // 播放器可能正在銷毀
      }
    },
  };

  const onDoubleTap = (event: Event) => {
    if (art.isLock) return;
    if (!isMobilePlayer(art)) return;
    const clientX = (event as MouseEvent).clientX;
    if (!Number.isFinite(clientX)) return;
    const player = art.template?.$player;
    if (!(player instanceof HTMLElement)) return;

    const rect = player.getBoundingClientRect();
    const side = resolveDoubleTapSide(clientX, rect);
    if (!side) return;

    const duration = art.duration;
    const target = doubleTapSeekTarget(art.currentTime, duration, side);
    if (target === null) return;

    try {
      const media = art.video;
      if (media) {
        // 直接寫 currentTime，避免再彈一次原生的 seek 提示
        media.currentTime = target;
      } else {
        art.seek = target;
      }
    } catch {
      return;
    }
    const forward = side === 'forward';
    // 快進/快退提示同樣顯示在頂部，保持和音量/亮度提示一致的簡潔樣式
    hud.show(
      'seek',
      `${
        forward ? '快進' : '快退'
      } ${DOUBLE_TAP_SEEK_SECONDS} 秒 · ${formatGestureClock(target)}`,
      null,
      900
    );
  };

  art.on('dblclick', onDoubleTap);

  const destroy = () => {
    longPress.end();
    art.off('dblclick', onDoubleTap);
    hud.destroy();
    dimLayer?.remove();
  };
  art.on('destroy', destroy);

  return { vertical, longPress, destroy };
}
