import { act, fireEvent, render, screen } from '@testing-library/react';
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
});
