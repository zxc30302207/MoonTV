import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ReactNode } from 'react';

import { getDoubanCategories } from '@/lib/douban.client';

import DoubanPage from '../page';

let mockParams = new URLSearchParams('type=movie');
jest.mock('next/navigation', () => ({ useSearchParams: () => mockParams }));
jest.mock('@/lib/douban.client', () => ({
  getDoubanCategories: jest.fn(),
  getDoubanRecommends: jest.fn(),
  getDoubanList: jest.fn(),
}));
jest.mock('@/lib/config.client', () => ({
  getCustomCategories: async () => [],
}));
jest.mock('@/lib/bangumi.client', () => ({
  GetBangumiCalendarData: jest.fn(),
}));
jest.mock('@/components/PageLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
jest.mock('@/components/VideoCard', () => ({
  __esModule: true,
  default: ({ title }: { title: string }) => <span>{title}</span>,
}));
jest.mock('@/components/DoubanCardSkeleton', () => ({
  __esModule: true,
  default: () => <span>Loading</span>,
}));
jest.mock('@/components/DoubanSelector', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/DoubanCustomSelector', () => ({
  __esModule: true,
  default: () => null,
}));

const categories = getDoubanCategories as jest.Mock;
const result = (title: string) => ({
  code: 200,
  message: 'ok',
  list: [{ id: title, title, poster: '', year: '2026', rate: '' }],
});
describe('discovery pagination', () => {
  let observer: IntersectionObserverCallback;
  beforeEach(() => {
    categories.mockReset();
    mockParams = new URLSearchParams('type=movie');
    window.IntersectionObserver = jest.fn().mockImplementation((callback) => {
      observer = callback;
      return { observe: jest.fn(), disconnect: jest.fn() };
    });
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());
  it('retries a failed page without advancing or duplicating existing results', async () => {
    categories
      .mockResolvedValueOnce(result('First'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(result('Second'));
    render(<DoubanPage />);
    await screen.findByText('First');
    await waitFor(() => expect(window.IntersectionObserver).toHaveBeenCalled());
    await act(async () =>
      observer(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      )
    );
    await screen.findByRole('alert');
    expect(categories).toHaveBeenLastCalledWith(
      expect.objectContaining({ pageStart: 25 })
    );
    fireEvent.click(screen.getByText('重試'));
    await screen.findByText('Second');
    expect(categories).toHaveBeenLastCalledWith(
      expect.objectContaining({ pageStart: 25 })
    );
    expect(screen.getAllByText('First')).toHaveLength(1);
  });
  it('ignores an old initial failure after changing discovery type', async () => {
    let rejectOld!: (reason: Error) => void;
    categories
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectOld = reject;
          })
      )
      .mockResolvedValueOnce(result('Current'));
    const view = render(<DoubanPage />);
    await waitFor(() => expect(categories).toHaveBeenCalledTimes(1));
    mockParams = new URLSearchParams('type=tv');
    view.rerender(<DoubanPage />);
    await screen.findByText('Current');
    await act(async () => rejectOld(new Error('old')));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Current')).toBeInTheDocument();
  });
});
