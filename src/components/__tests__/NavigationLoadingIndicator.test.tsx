import { act, render, screen } from '@testing-library/react';

import { NavigationLoadingIndicator } from '../NavigationLoadingIndicator';

let mockIsLoading = false;
jest.mock('../NavigationLoadingProvider', () => ({
  useNavigationLoading: () => ({ isLoading: mockIsLoading }),
}));

describe('NavigationLoadingIndicator transitions', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockIsLoading = false;
  });
  afterEach(() => jest.useRealTimers());

  it('keeps the loader mounted during fade-out and removes it afterwards', () => {
    mockIsLoading = true;
    const { rerender } = render(<NavigationLoadingIndicator />);
    act(() => jest.advanceTimersByTime(20));
    expect(screen.getByText('月亮正在努力載入中')).toBeInTheDocument();
    mockIsLoading = false;
    rerender(<NavigationLoadingIndicator />);
    act(() => jest.advanceTimersByTime(499));
    expect(screen.getByText('月亮正在努力載入中')).toBeInTheDocument();
    act(() => jest.advanceTimersByTime(1));
    expect(screen.queryByText('月亮正在努力載入中')).not.toBeInTheDocument();
  });

  it('cancels an older dismissal when another navigation starts', () => {
    mockIsLoading = true;
    const { rerender } = render(<NavigationLoadingIndicator />);
    mockIsLoading = false;
    rerender(<NavigationLoadingIndicator />);
    act(() => jest.advanceTimersByTime(250));
    mockIsLoading = true;
    rerender(<NavigationLoadingIndicator />);
    act(() => jest.advanceTimersByTime(1000));
    expect(screen.getByText('月亮正在努力載入中')).toBeInTheDocument();
  });
});
