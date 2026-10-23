import type Artplayer from 'artplayer';

import { decideDownshift } from '@/lib/hls-quality';

import {
  applySwipeDelta,
  bindMobileGestures,
  doubleTapSeekTarget,
  formatGestureClock,
  resolveDoubleTapSide,
  resolveVerticalSide,
} from '../mobile-gestures';
import { clearPlayerNotices, pushPlayerNotice } from '../player-notice';

describe('4.6.0 quality downshift safety', () => {
  const input = {
    levels: [{ height: 360 }, { height: 720 }, { height: 1080 }],
    autoLevelEnabled: true,
    currentLevel: 2,
    autoLevelCapping: -1,
  };
  it('does not override a manually selected quality', () => {
    expect(decideDownshift({ ...input, autoLevelEnabled: false })).toEqual({
      action: 'none',
    });
  });
  it('does not flush a single-level stream just to lower its cap', () => {
    expect(decideDownshift({ ...input, levels: [{ height: 1080 }] })).toEqual({
      action: 'advise-source',
      reason: 'single-level',
    });
  });
  it('lowers a multi-level stream one level and respects its existing cap', () => {
    expect(decideDownshift(input)).toEqual({ action: 'downshift', nextCap: 1 });
    expect(decideDownshift({ ...input, autoLevelCapping: 1 })).toEqual({
      action: 'downshift',
      nextCap: 0,
    });
    expect(decideDownshift({ ...input, autoLevelCapping: 0 })).toEqual({
      action: 'advise-source',
      reason: 'lowest-level',
    });
  });
});

describe('mobile gesture boundaries', () => {
  const rect = { left: 50, width: 200 };
  it('leaves central double taps to playback and resolves edge directions', () => {
    expect(resolveDoubleTapSide(60, rect)).toBe('backward');
    expect(resolveDoubleTapSide(150, rect)).toBeNull();
    expect(resolveDoubleTapSide(240, rect)).toBe('forward');
    expect(resolveDoubleTapSide(0, { left: 0, width: 0 })).toBeNull();
    expect(resolveVerticalSide(100, rect)).toBe('left');
    expect(resolveVerticalSide(200, rect)).toBe('right');
  });
  it('clamps seek targets and rejects unavailable duration', () => {
    expect(doubleTapSeekTarget(3, 100, 'backward')).toBe(0);
    expect(doubleTapSeekTarget(99, 100, 'forward')).toBe(100);
    expect(doubleTapSeekTarget(10, Infinity, 'forward')).toBeNull();
    expect(doubleTapSeekTarget(NaN, 100, 'forward')).toBe(10);
    expect(applySwipeDelta(0.5, 1)).toBe(1);
    expect(applySwipeDelta(0.5, -1)).toBe(0);
    expect(formatGestureClock(3661)).toBe('1:01:01');
  });
});

describe('player notice lifecycle', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  const createPlayer = () => ({
    template: { $player: document.createElement('div') },
  });
  it('deduplicates notices, renders untrusted text safely and expires them', () => {
    const art = createPlayer();
    pushPlayerNotice(art, 'loading', { key: 'status' });
    pushPlayerNotice(art, '<img src=x onerror=alert(1)>', { key: 'status' });
    expect(
      art.template.$player.querySelectorAll('.moontv-notice-item')
    ).toHaveLength(1);
    expect(art.template.$player.querySelector('img')).toBeNull();
    jest.advanceTimersByTime(4000);
    expect(
      art.template.$player.querySelectorAll('.moontv-notice-item')
    ).toHaveLength(0);
  });
  it('queues overflow and clears queued/visible notices without resurrection', () => {
    const art = createPlayer();
    for (let i = 0; i < 6; i++)
      pushPlayerNotice(art, `notice ${i}`, { key: `${i}`, durationMs: 0 });
    expect(
      art.template.$player.querySelectorAll('.moontv-notice-item')
    ).toHaveLength(4);
    clearPlayerNotices(art, '0');
    expect(art.template.$player.textContent).toContain('notice 4');
    clearPlayerNotices(art);
    jest.runOnlyPendingTimers();
    expect(art.template.$player.textContent).toBe('');
  });
});

describe('mobile long-press interruption', () => {
  it('restores the prior playback rate on release and destroy', () => {
    const handlers = new Map<string, () => void>();
    const mock = {
      template: { $player: document.createElement('div') },
      playing: true,
      isLock: false,
      playbackRate: 1.5,
      on: (name: string, callback: () => void) => handlers.set(name, callback),
      off: jest.fn(),
    };
    const gestures = bindMobileGestures(mock as unknown as Artplayer);
    expect(gestures.longPress.start()).toBe(true);
    expect(mock.playbackRate).toBe(2);
    // Repeated start must not replace the original saved rate with 2x.
    expect(gestures.longPress.start()).toBe(true);
    gestures.longPress.end();
    expect(mock.playbackRate).toBe(1.5);
    gestures.longPress.start();
    handlers.get('destroy')?.();
    expect(mock.playbackRate).toBe(1.5);
    expect(mock.template.$player.children).toHaveLength(0);
    mock.playing = false;
    expect(gestures.longPress.start()).toBe(false);
  });
});
