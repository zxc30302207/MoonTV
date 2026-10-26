import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ReactNode } from 'react';

import { getDoubanCollection } from '@/lib/douban.client';
import type { DoubanResult } from '@/lib/types';

import RankingPage from '../page';

jest.mock('@/lib/douban.client', () => ({ getDoubanCollection: jest.fn() }));
jest.mock('@/components/PageLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
jest.mock('@/components/BackButton', () => ({
  BackButton: () => <button>返回</button>,
}));
jest.mock('@/components/DoubanCardSkeleton', () => ({
  __esModule: true,
  default: () => <span>載入</span>,
}));
jest.mock('@/components/VideoCard', () => ({
  __esModule: true,
  default: ({ title }: { title: string }) => <span>{title}</span>,
}));

const collection = getDoubanCollection as jest.MockedFunction<
  typeof getDoubanCollection
>;

describe('ranking page', () => {
  beforeEach(() => {
    collection.mockReset();
    window.IntersectionObserver = jest.fn().mockImplementation(() => ({
      observe: jest.fn(),
      disconnect: jest.fn(),
    }));
  });

  it('ignores an older request after switching ranking lists', async () => {
    let resolveOld: (result: DoubanResult) => void = () => undefined;
    collection.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        })
    );
    collection.mockResolvedValueOnce({
      code: 200,
      message: 'success',
      list: [
        { id: '2', title: '本周作品', poster: '', rate: '', year: '2026' },
      ],
    });
    render(<RankingPage />);
    fireEvent.click(screen.getByText('每周口碑榜'));
    expect(await screen.findByText('本周作品')).toBeInTheDocument();
    await act(async () =>
      resolveOld({
        code: 200,
        message: 'success',
        list: [
          { id: '1', title: '舊榜單作品', poster: '', rate: '', year: '2025' },
        ],
      })
    );
    expect(screen.queryByText('舊榜單作品')).not.toBeInTheDocument();
    expect(screen.getByText('本周作品')).toBeInTheDocument();
    expect(collection).toHaveBeenLastCalledWith('movie_weekly_best', 0, 25);
  });
  it('retries the failed page instead of skipping its offset', async () => {
    const observer = { callback: null as null | IntersectionObserverCallback };
    window.IntersectionObserver = jest.fn().mockImplementation((callback) => {
      observer.callback = callback;
      return { observe: jest.fn(), disconnect: jest.fn() };
    });
    const result = {
      code: 200,
      message: 'ok',
      list: [{ id: '1', title: 'First', poster: '', rate: '', year: '2026' }],
    };
    collection
      .mockResolvedValueOnce(result)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        ...result,
        list: [{ ...result.list[0], id: '2', title: 'Second' }],
      });
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<RankingPage />);
    await screen.findByText('First');
    await waitFor(() => expect(observer.callback).not.toBeNull());
    await act(async () =>
      observer.callback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      )
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('載入失敗');
    expect(collection).toHaveBeenLastCalledWith('movie_top250', 25, 25);
    fireEvent.click(screen.getByText('重試'));
    expect(await screen.findByText('Second')).toBeInTheDocument();
    expect(collection).toHaveBeenLastCalledWith('movie_top250', 25, 25);
    expect(screen.getByText('First')).toBeInTheDocument();
    jest.restoreAllMocks();
  });
});
