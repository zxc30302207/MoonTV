import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { getAllFollowings, refreshFollowingsStream } from '@/lib/db.client';

import HomePage from '../page';

jest.mock('@/lib/bangumi.client', () => ({
  GetBangumiCalendarData: jest.fn().mockResolvedValue([]),
}));
jest.mock('@/lib/douban.client', () => ({
  getDoubanCategories: jest.fn().mockResolvedValue({ code: 200, list: [] }),
}));
jest.mock('@/lib/db.client', () => ({
  clearAllFavorites: jest.fn(),
  getAllFavorites: jest.fn().mockResolvedValue({}),
  getAllFollowings: jest.fn(),
  getAllPlayRecords: jest.fn().mockResolvedValue({}),
  getTodayUpdated: jest.fn().mockResolvedValue(null),
  saveTodayUpdated: jest.fn().mockResolvedValue(undefined),
  refreshFollowingsStream: jest.fn().mockResolvedValue({}),
  subscribeToDataUpdates: jest.fn(() => () => undefined),
}));
jest.mock('@/components/PageLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
jest.mock('@/components/ScrollableRow', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
jest.mock('@/components/ContinueWatching', () => ({
  __esModule: true,
  default: () => <div>繼續觀看</div>,
}));
jest.mock('@/components/VideoCard', () => ({
  __esModule: true,
  default: ({ title }: { title: string }) => <span>{title}</span>,
}));
jest.mock('@/components/NavigationLoadingProvider', () => ({
  useNavigationLoading: () => ({ startLoading: jest.fn() }),
}));
jest.mock('@/components/SiteProvider', () => ({
  useSite: () => ({ announcement: '' }),
}));

const followings = getAllFollowings as jest.MockedFunction<
  typeof getAllFollowings
>;
const refresh = refreshFollowingsStream as jest.MockedFunction<
  typeof refreshFollowingsStream
>;

describe('home feature merge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    followings.mockResolvedValue({});
    refresh.mockResolvedValue({});
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        list: [
          {
            id: 'a1',
            source: 'adult',
            title: '成人推薦作品',
            episodes: ['episode'],
          },
        ],
        refreshKey: 'daily',
      }),
    });
  });

  it('keeps adult recommendations and the history/favorites tabs alongside following', async () => {
    render(<HomePage />);
    expect(await screen.findByText('成人推薦作品')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith('/api/adult/recommends?limit=24');
    expect(screen.getByRole('button', { name: '歷史' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '收藏夾' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '追更' }));
    expect(await screen.findByText('暫無追更內容')).toBeInTheDocument();
    expect(screen.getByText('今日新更')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '首頁' }));
    expect(screen.getByText('成人推薦作品')).toBeInTheDocument();
  });

  it('preserves simple-mode recommendation opt-out and still exposes following', async () => {
    localStorage.setItem('simpleMode', 'true');
    render(<HomePage />);
    fireEvent.click(screen.getByRole('button', { name: '追更' }));
    expect(await screen.findByText('暫無追更內容')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('button', { name: '首頁' })
    ).not.toBeInTheDocument();
  });

  it('releases refresh controls after a failed following stream', async () => {
    const error = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    followings.mockResolvedValue({
      'source+1': {
        title: '追更作品',
        source_name: '來源',
        cover: '',
        year: '',
        total_episodes: 2,
        watched_episodes: 1,
        save_time: 1,
        search_title: '',
      },
    });
    refresh.mockRejectedValue(new Error('network failure'));
    render(<HomePage />);
    fireEvent.click(screen.getByRole('button', { name: '追更' }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '刷新' })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    error.mockRestore();
  });
});
