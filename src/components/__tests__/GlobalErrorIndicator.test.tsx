import { act, render, screen } from '@testing-library/react';

import { GlobalErrorIndicator } from '../GlobalErrorIndicator';

function emitError(message: string) {
  act(() => {
    window.dispatchEvent(
      new CustomEvent('globalError', { detail: { message } })
    );
  });
}

describe('GlobalErrorIndicator', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('dismisses background errors automatically without extending duplicate errors', () => {
    render(<GlobalErrorIndicator />);
    emitError('同步暫時失敗');
    expect(screen.getByText('同步暫時失敗')).toBeInTheDocument();
    act(() => jest.advanceTimersByTime(3000));
    emitError('同步暫時失敗');
    act(() => jest.advanceTimersByTime(1000));
    expect(screen.queryByText('同步暫時失敗')).not.toBeInTheDocument();
  });

  it('preserves explicit clear events and allows a fresh error afterwards', () => {
    render(<GlobalErrorIndicator />);
    emitError('同步暫時失敗');
    act(() => window.dispatchEvent(new Event('globalErrorClear')));
    expect(screen.queryByText('同步暫時失敗')).not.toBeInTheDocument();
    emitError('同步暫時失敗');
    expect(screen.getByText('同步暫時失敗')).toBeInTheDocument();
  });

  it('removes listeners and pending timers on unmount', () => {
    const remove = jest.spyOn(window, 'removeEventListener');
    const { unmount } = render(<GlobalErrorIndicator />);
    emitError('同步暫時失敗');
    unmount();
    expect(remove).toHaveBeenCalledWith(
      'globalErrorClear',
      expect.any(Function)
    );
    expect(jest.getTimerCount()).toBe(0);
    remove.mockRestore();
  });
});
