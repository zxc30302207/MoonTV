import type Artplayer from 'artplayer';

export const PROGRESS_PREVIEW_MOVE = 'moontv-progress-preview-move';
export const PROGRESS_PREVIEW_END = 'moontv-progress-preview-end';

export interface ProgressPreviewMove {
  ratio: number;
  input: 'mouse' | 'touch';
}

/** Keep playback running while scrubbing; commit the selected time on release. */
export function bindDeferredProgressSeek(art: Artplayer): () => void {
  const progress = art.template.$progress;
  const player = art.template.$player;
  const video = art.template.$video;
  const doc = progress.ownerDocument;
  const win = doc.defaultView;
  const Art = art.constructor as typeof Artplayer;
  let drag: 'mouse' | 'touch' | 'gesture' | null = null;
  let touchId: number | null = null;
  let ratio = 0;
  let restoringBar = false;
  let systemGesture = false;
  let suppressVideoClickUntil = 0;
  let gesture: {
    id: number;
    x: number;
    y: number;
    time: number;
    duration: number;
    size: number;
    rotated: boolean;
    direction: 'pending' | 'seek' | 'ignore';
  } | null = null;

  const updateBar = (event?: Event) => {
    art.emit('setBar', 'played', ratio, event);
    if (drag) {
      progress.dispatchEvent(
        new CustomEvent<ProgressPreviewMove>(PROGRESS_PREVIEW_MOVE, {
          detail: { ratio, input: drag === 'mouse' ? 'mouse' : 'touch' },
        })
      );
    }
  };

  const updatePosition = (clientX: number, clientY: number, event?: Event) => {
    const rect = progress.getBoundingClientRect();
    const size = art.isRotate ? rect.height : rect.width;
    if (size <= 0) return;
    const offset = art.isRotate ? clientY - rect.top : clientX - rect.left;
    ratio = Math.min(1, Math.max(0, offset / size));
    updateBar(event);
  };

  const finish = (commit: boolean, keepControls = true) => {
    gesture = null;
    if (!drag) return;
    if (drag === 'gesture') suppressVideoClickUntil = Date.now() + 500;
    drag = null;
    touchId = null;
    // The show setter also restarts Artplayer's normal auto-hide countdown.
    if (keepControls && !art.isLock) art.controls.show = true;
    if (commit && Number.isFinite(art.duration) && art.duration > 0) {
      art.seek = ratio * art.duration;
    } else {
      art.emit('setBar', 'played', art.played);
    }
    progress.dispatchEvent(new CustomEvent(PROGRESS_PREVIEW_END));
  };

  const onGestureStart = (event: TouchEvent) => {
    suppressVideoClickUntil = 0;
    if (gesture && event.touches.length !== 1) {
      onCancel(event);
      return;
    }
    if (
      !art.option.gesture ||
      art.option.isLive ||
      art.isLock ||
      drag ||
      event.touches.length !== 1
    ) {
      return;
    }
    const duration = art.duration;
    const rect = player.getBoundingClientRect();
    const size = art.isRotate ? rect.height : rect.width;
    if (!Number.isFinite(duration) || duration <= 0 || size <= 0) return;
    const touch = event.touches[0];
    gesture = {
      id: touch.identifier,
      x: touch.clientX,
      y: touch.clientY,
      time: art.currentTime,
      duration,
      size,
      rotated: art.isRotate,
      direction: 'pending',
    };
  };
  const updateGesture = (touch: Touch, event: Event) => {
    if (!gesture || gesture.direction === 'ignore') return;
    const dx = touch.clientX - gesture.x;
    const dy = touch.clientY - gesture.y;
    const offset = gesture.rotated ? dy : dx;
    const crossOffset = gesture.rotated ? dx : dy;
    if (gesture.direction === 'pending') {
      if (Math.max(Math.abs(offset), Math.abs(crossOffset)) < 10) return;
      // Lock the axis once, so taps and perpendicular swipes never seek.
      gesture.direction =
        Math.abs(offset) >= Math.abs(crossOffset) ? 'seek' : 'ignore';
      if (gesture.direction !== 'seek') return;
      drag = 'gesture';
      art.controls.show = true;
    }
    ratio = Math.min(
      1,
      Math.max(
        0,
        gesture.time / gesture.duration +
          (offset / gesture.size) * Art.TOUCH_MOVE_RATIO
      )
    );
    updateBar(event);
  };
  const onVideoClick = (event: MouseEvent) => {
    if (Date.now() >= suppressVideoClickUntil) return;
    suppressVideoClickUntil = 0;
    // A synthetic click after swiping must not toggle playback.
    event.stopImmediatePropagation();
    event.preventDefault();
  };
  const onMouseDown = (event: MouseEvent) => {
    if (event.button !== 0 || art.isLock || drag) return;
    // Capture before Artplayer starts its continuous-seek drag handler.
    event.stopImmediatePropagation();
    event.preventDefault();
    drag = 'mouse';
    art.controls.show = true;
    updatePosition(event.clientX, event.clientY, event);
  };
  const onMouseMove = (event: MouseEvent) => {
    if (drag !== 'mouse') return;
    event.stopImmediatePropagation();
    updatePosition(event.clientX, event.clientY, event);
  };
  const onMouseUp = (event: MouseEvent) => {
    if (drag !== 'mouse' || event.button !== 0) return;
    event.stopImmediatePropagation();
    updatePosition(event.clientX, event.clientY, event);
    finish(true);
  };
  const onPlayerTouchStart = (event: TouchEvent) => {
    if (!art.fullscreen && !art.fullscreenWeb && !art.isRotate) return;
    const viewportTop = win?.visualViewport?.offsetTop || 0;
    // Use screen coordinates, not the rotated player's progress axis.
    if (
      !systemGesture &&
      !Array.from(event.touches).some(
        (touch) => touch.clientY <= viewportTop + 40
      )
    ) {
      return;
    }
    systemGesture = true;
    finish(false);
    // Clear Artplayer's previous gesture, including interrupted touch sequences.
    art.emit('document:touchend', event);
    // Do not preventDefault: the OS must still receive notification gestures.
    event.stopImmediatePropagation();
  };
  const onTouchStart = (event: TouchEvent) => {
    if (event.touches.length !== 1 || art.isLock || drag) return;
    event.stopImmediatePropagation();
    event.preventDefault();
    const touch = event.touches[0];
    touchId = touch.identifier;
    drag = 'touch';
    art.controls.show = true;
    updatePosition(touch.clientX, touch.clientY, event);
  };
  const onTouchMove = (event: TouchEvent) => {
    if (systemGesture) {
      event.stopImmediatePropagation();
      return;
    }
    if (gesture) {
      // Stop the built-in continuous seek, but still cancel long-press speedup.
      event.stopImmediatePropagation();
      art.emit('document:touchmove', event);
      if (
        event.touches.length !== 1 ||
        art.isLock ||
        art.isRotate !== gesture.rotated
      ) {
        onCancel(event);
        return;
      }
      const touch = Array.from(event.touches).find(
        (item) => item.identifier === gesture?.id
      );
      if (touch) updateGesture(touch, event);
      if (drag === 'gesture') event.preventDefault();
      return;
    }
    if (drag !== 'touch') return;
    event.stopImmediatePropagation();
    event.preventDefault();
    if (event.touches.length !== 1) {
      finish(false);
      return;
    }
    const touch = Array.from(event.touches).find(
      (item) => item.identifier === touchId
    );
    if (touch) updatePosition(touch.clientX, touch.clientY, event);
  };
  const onTouchEnd = (event: TouchEvent) => {
    if (systemGesture) {
      if (event.touches.length === 0) systemGesture = false;
      return;
    }
    if (gesture) {
      const touch = Array.from(event.changedTouches).find(
        (item) => item.identifier === gesture?.id
      );
      if (!touch) return;
      if (drag === 'gesture') {
        event.stopImmediatePropagation();
        updateGesture(touch, event);
        finish(!art.isLock && art.isRotate === gesture.rotated);
        art.emit('document:touchend', event);
      } else {
        gesture = null;
      }
      return;
    }
    if (drag !== 'touch') return;
    const touch = Array.from(event.changedTouches).find(
      (item) => item.identifier === touchId
    );
    if (!touch) return;
    event.stopImmediatePropagation();
    updatePosition(touch.clientX, touch.clientY, event);
    finish(true);
  };
  const onCancel = (event?: Event) => {
    systemGesture = false;
    finish(false);
    art.emit('document:touchend', event || new Event('touchcancel'));
  };
  const onVisibilityChange = () => {
    if (doc.hidden) onCancel();
  };
  const onClick = (event: MouseEvent) => {
    // A release already committed the seek; do not seek again on its click.
    event.stopImmediatePropagation();
    if (event.detail === 0 && !art.isLock) {
      updatePosition(event.clientX, event.clientY, event);
      art.seek = ratio * art.duration;
    }
  };
  const onSetBar = (type: string) => {
    if (type !== 'played' || !drag || restoringBar) return;
    // RAF/timeupdate still advance normally, but the thumb follows the drag.
    restoringBar = true;
    art.emit('setBar', 'played', ratio);
    restoringBar = false;
  };
  const onControl = (visible: boolean) => {
    // Auto-hide is driven by video:timeupdate even when a finger holds still.
    if (!visible && drag && !art.isLock) art.controls.show = true;
  };

  player.addEventListener('touchstart', onPlayerTouchStart, {
    capture: true,
    passive: true,
  });
  video.addEventListener('touchstart', onGestureStart, {
    capture: true,
    passive: true,
  });
  video.addEventListener('click', onVideoClick, true);
  progress.addEventListener('mousedown', onMouseDown, true);
  progress.addEventListener('touchstart', onTouchStart, {
    capture: true,
    passive: false,
  });
  progress.addEventListener('click', onClick, true);
  doc.addEventListener('mousemove', onMouseMove, true);
  doc.addEventListener('mouseup', onMouseUp, true);
  doc.addEventListener('touchmove', onTouchMove, {
    capture: true,
    passive: false,
  });
  doc.addEventListener('touchend', onTouchEnd, true);
  doc.addEventListener('touchcancel', onCancel, true);
  doc.addEventListener('visibilitychange', onVisibilityChange);
  win?.addEventListener('blur', onCancel);
  art.on('setBar', onSetBar);
  art.on('control', onControl);

  const cleanup = () => {
    finish(false, false);
    player.removeEventListener('touchstart', onPlayerTouchStart, true);
    video.removeEventListener('touchstart', onGestureStart, true);
    video.removeEventListener('click', onVideoClick, true);
    progress.removeEventListener('mousedown', onMouseDown, true);
    progress.removeEventListener('touchstart', onTouchStart, true);
    progress.removeEventListener('click', onClick, true);
    doc.removeEventListener('mousemove', onMouseMove, true);
    doc.removeEventListener('mouseup', onMouseUp, true);
    doc.removeEventListener('touchmove', onTouchMove, true);
    doc.removeEventListener('touchend', onTouchEnd, true);
    doc.removeEventListener('touchcancel', onCancel, true);
    doc.removeEventListener('visibilitychange', onVisibilityChange);
    win?.removeEventListener('blur', onCancel);
    art.off('setBar', onSetBar);
    art.off('control', onControl);
    art.off('destroy', cleanup);
  };
  art.on('destroy', cleanup);
  return cleanup;
}
