import { act, fireEvent, render } from '@testing-library/react';

import useDragScroll from '../useDragScroll';

function Harness({ onReorder }: { onReorder: (keys: string[]) => void }) {
  const { containerRef } = useDragScroll({ onReorder });
  return (
    <div ref={containerRef}>
      <a data-nav-key='a'>A</a>
      <a data-nav-key='b'>B</a>
    </div>
  );
}

function pointer(
  target: Window | HTMLElement,
  type: string,
  x: number,
  id = 1
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, {
    pointerId: id,
    button: 0,
    clientX: x,
    clientY: 0,
    pointerType: 'mouse',
  });
  fireEvent(target, event);
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

it.each([false, true])(
  'restores the original DOM before completing a drag (cancelled=%s)',
  (cancelled) => {
    const onReorder = jest.fn();
    const { container } = render(<Harness onReorder={onReorder} />);
    const first = container.querySelector('[data-nav-key="a"]') as HTMLElement;
    pointer(first, 'pointerdown', 10);
    act(() => jest.advanceTimersByTime(430));
    pointer(window, 'pointermove', 100);
    expect(container.querySelector('[data-nav-key]')).toHaveAttribute(
      'data-nav-key',
      'b'
    );
    pointer(window, cancelled ? 'pointercancel' : 'pointerup', 100);
    expect(container.querySelector('[data-nav-key]')).toHaveAttribute(
      'data-nav-key',
      'a'
    );
    if (cancelled) expect(onReorder).not.toHaveBeenCalled();
    else expect(onReorder).toHaveBeenCalledWith(['b', 'a']);
    expect(document.documentElement).not.toHaveClass('top-nav__is-reordering');
    expect(document.querySelector('.top-nav__reorder-ghost')).toBeNull();
  }
);

it('ignores a second pointer ending the active gesture', () => {
  const onReorder = jest.fn();
  const { container } = render(<Harness onReorder={onReorder} />);
  pointer(container.querySelector('a') as HTMLElement, 'pointerdown', 10);
  act(() => jest.advanceTimersByTime(430));
  pointer(window, 'pointerup', 100, 2);
  expect(onReorder).not.toHaveBeenCalled();
  pointer(window, 'pointercancel', 100);
  expect(document.documentElement).not.toHaveClass('top-nav__is-reordering');
});
