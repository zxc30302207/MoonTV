import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ReactNode } from 'react';

import {
  deleteFavorite,
  deleteFollowing,
  deletePlayRecord,
  isFavorited,
  isFollowing,
  saveFavorite,
  saveFollowing,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { getDoubanIntro } from '@/lib/douban.client';
import { getVideoDesc } from '@/lib/video-detail.client';

import VideoCard from '../VideoCard';

jest.mock('@/lib/video-detail.client', () => ({
  getVideoDesc: jest.fn().mockResolvedValue('來源簡介'),
}));
jest.mock('@/lib/douban.client', () => ({
  getDoubanIntro: jest.fn().mockResolvedValue('豆瓣簡介'),
}));
jest.mock('@/lib/bangumi.client', () => ({
  getBangumiSubjectIntro: jest.fn().mockResolvedValue('動畫簡介'),
}));

const push = jest.fn();
const unsubscribe = jest.fn();

jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ alt }: { alt: string }) => <span role='img' aria-label={alt} />,
}));
jest.mock('@/lib/utils', () => ({ processImageUrl: (value: string) => value }));
jest.mock('@/components/NavigationLoadingProvider', () => ({
  useNavigationLoading: () => ({ startLoading: jest.fn() }),
}));
jest.mock('@/components/ImagePlaceholder', () => ({
  ImagePlaceholder: () => null,
}));
jest.mock('@/components/MobileActionSheet', () => ({
  __esModule: true,
  default: ({
    isOpen,
    actions,
    description,
  }: {
    description?: string;
    isOpen: boolean;
    actions: Array<{
      id: string;
      label: string;
      icon: ReactNode;
      onClick: () => void;
    }>;
  }) =>
    isOpen ? (
      <div>
        <p data-testid='intro'>{description}</p>
        {actions.map((action) => (
          <button key={action.id} onClick={action.onClick}>
            {action.label}
          </button>
        ))}
      </div>
    ) : null,
}));
jest.mock('@/lib/db.client', () => ({
  deleteFavorite: jest.fn(),
  deleteFollowing: jest.fn(),
  deletePlayRecord: jest.fn(),
  generateStorageKey: (source: string, id: string) => `${source}+${id}`,
  isFavorited: jest.fn().mockResolvedValue(false),
  isFollowing: jest.fn(),
  saveFavorite: jest.fn(),
  saveFollowing: jest.fn(),
  subscribeToDataUpdates: jest.fn(),
}));

const followingStatus = isFollowing as jest.MockedFunction<typeof isFollowing>;

describe('VideoCard following actions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.dispatchEvent(new Event('moontv:logout'));
    followingStatus.mockResolvedValue(false);
    (subscribeToDataUpdates as jest.Mock).mockReturnValue(unsubscribe);
  });

  it('saves the watched episode and normalized metadata when following', async () => {
    render(
      <VideoCard
        id='v1'
        source='source1'
        title='作品'
        year='unknown'
        query='作品'
        episodes={12}
        currentEpisode={4}
        from='playrecord'
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '加入追更' }));
    await waitFor(() =>
      expect(saveFollowing).toHaveBeenCalledWith(
        'source1',
        'v1',
        expect.objectContaining({
          watched_episodes: 4,
          total_episodes: 12,
          year: '',
          search_title: '',
        })
      )
    );
  });

  it('checks stored status before a direct touch or keyboard toggle', async () => {
    followingStatus.mockResolvedValue(true);
    render(<VideoCard id='v1' source='source1' title='作品' from='search' />);
    fireEvent.click(screen.getByRole('button', { name: '加入追更' }));
    await waitFor(() =>
      expect(deleteFollowing).toHaveBeenCalledWith('source1', 'v1')
    );
    expect(saveFollowing).not.toHaveBeenCalled();
  });

  it('keeps the episode when opening from the mobile action sheet and removes subscriptions', async () => {
    const { unmount } = render(
      <VideoCard
        id='v1'
        source='source1'
        title='作品'
        year='unknown'
        currentEpisode={4}
        from='favorite'
      />
    );
    fireEvent.contextMenu(screen.getByRole('img', { name: '作品' }));
    fireEvent.click(screen.getByRole('button', { name: '播放' }));
    expect(push).toHaveBeenCalledWith(expect.stringContaining('&ep=4'));
    expect(push.mock.calls[0][0]).not.toContain('year=unknown');
    await waitFor(() => expect(followingStatus).toHaveBeenCalled());
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(2);
  });
});

describe('VideoCard upstream gesture and URL compatibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.dispatchEvent(new Event('moontv:logout'));
    followingStatus.mockResolvedValue(false);
    (subscribeToDataUpdates as jest.Mock).mockReturnValue(unsubscribe);
  });

  it('encodes special titles and preserves custom aggregate source preference', async () => {
    render(
      <VideoCard
        from='search'
        title='作品（特別篇） & test'
        items={[
          {
            id: 'v1',
            source: 'source1',
            title: '作品（特別篇） & test',
            poster: '',
            year: '2026',
            episodes: ['https://example.com/video.m3u8'],
            episodes_titles: ['1'],
            source_name: 'Source',
          },
        ]}
      />
    );
    fireEvent.contextMenu(
      screen.getByRole('img', { name: '作品（特別篇） & test' })
    );
    fireEvent.click(screen.getByRole('button', { name: '播放' }));
    const url = new URL(push.mock.calls[0][0], 'https://example.com');
    expect(url.searchParams.get('title')).toBe('作品（特別篇） & test');
    expect(url.searchParams.get('prefer')).toBe('true');
    expect(url.searchParams.get('source')).toBe('source1');
    await waitFor(() => expect(followingStatus).toHaveBeenCalled());
  });

  it('does not open a long-press menu after dragging a touch card', () => {
    jest.useFakeTimers();
    render(<VideoCard id='v1' source='source1' title='作品' from='search' />);
    const card = screen.getByRole('img', { name: '作品' });
    fireEvent.touchStart(card, { touches: [{ clientX: 10, clientY: 10 }] });
    fireEvent.touchMove(card, { touches: [{ clientX: 10, clientY: 50 }] });
    jest.advanceTimersByTime(600);
    fireEvent.contextMenu(card);
    expect(
      screen.queryByRole('button', { name: '播放' })
    ).not.toBeInTheDocument();
    fireEvent.touchEnd(card);
    jest.useRealTimers();
  });
});

describe('VideoCard synopsis integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.dispatchEvent(new Event('moontv:logout'));
    followingStatus.mockResolvedValue(false);
    (subscribeToDataUpdates as jest.Mock).mockReturnValue(unsubscribe);
  });

  it('loads source descriptions only when the menu opens', async () => {
    render(<VideoCard id='v1' source='source1' title='作品' from='search' />);
    expect(getVideoDesc).not.toHaveBeenCalled();
    fireEvent.contextMenu(screen.getByRole('img', { name: '作品' }));
    await waitFor(() =>
      expect(screen.getByTestId('intro')).toHaveTextContent('來源簡介')
    );
    expect(getVideoDesc).toHaveBeenCalledWith('source1', 'v1', '作品');
  });

  it('falls back to source synopsis when Douban has no synopsis', async () => {
    (getDoubanIntro as jest.Mock).mockResolvedValueOnce('');
    render(
      <VideoCard
        id='v1'
        source='source1'
        title='作品'
        douban_id={123}
        from='search'
      />
    );
    fireEvent.contextMenu(screen.getByRole('img', { name: '作品' }));
    await waitFor(() =>
      expect(screen.getByTestId('intro')).toHaveTextContent('來源簡介')
    );
  });

  it('ignores a previous card request after the item changes', async () => {
    let resolveOld!: (value: string) => void;
    (getVideoDesc as jest.Mock).mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveOld = resolve;
        })
    );
    const { rerender } = render(
      <VideoCard id='v1' source='source1' title='作品一' from='search' />
    );
    fireEvent.contextMenu(screen.getByRole('img', { name: '作品一' }));
    rerender(
      <VideoCard id='v2' source='source1' title='作品二' from='search' />
    );
    await waitFor(() =>
      expect(screen.getByTestId('intro')).toHaveTextContent('來源簡介')
    );
    await act(async () => {
      resolveOld('舊作品簡介');
    });
    expect(screen.getByTestId('intro')).toHaveTextContent('來源簡介');
    expect(screen.getByTestId('intro')).not.toHaveTextContent('舊作品簡介');
  });
});

describe('VideoCard accessible controls', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    followingStatus.mockResolvedValue(false);
    (subscribeToDataUpdates as jest.Mock).mockReturnValue(unsubscribe);
  });

  it('exposes named native playback and record action buttons', async () => {
    const onDelete = jest.fn();
    render(
      <VideoCard
        id='v1'
        source='source1'
        title='作品'
        from='playrecord'
        onDelete={onDelete}
      />
    );
    const play = screen.getByRole('button', { name: '播放 作品' });
    expect(play.tagName).toBe('BUTTON');
    expect(play).toHaveAttribute('type', 'button');
    expect(play.tabIndex).toBe(0);
    act(() => play.focus());
    expect(play).toHaveFocus();
    expect(play.parentElement).toHaveClass('group-focus-within:opacity-100');
    fireEvent.click(play);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith(expect.stringContaining('/play?'));

    const favorite = screen.getByRole('button', { name: '加入收藏' });
    expect(favorite).toHaveAttribute('aria-pressed', 'false');
    expect(favorite.tagName).toBe('BUTTON');
    fireEvent.click(favorite);
    await waitFor(() => expect(saveFavorite).toHaveBeenCalled());
    expect(
      await screen.findByRole('button', { name: '取消收藏' })
    ).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '刪除播放紀錄 作品' }));
    await waitFor(() =>
      expect(deletePlayRecord).toHaveBeenCalledWith('source1', 'v1')
    );
    expect(push).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('button', { name: '刪除播放紀錄 作品' }).tagName
    ).toBe('BUTTON');
  });

  it('opens explicit more actions without starting playback', async () => {
    render(<VideoCard id='v1' source='source1' title='作品' from='search' />);
    const more = screen.getByRole('button', { name: '作品 更多操作' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: '播放' })).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    await waitFor(() => expect(followingStatus).toHaveBeenCalled());
  });

  it('checks initial favorite status before a direct keyboard-compatible action', async () => {
    (isFavorited as jest.Mock).mockResolvedValueOnce(true);
    render(<VideoCard id='v1' source='source1' title='作品' from='search' />);
    fireEvent.click(screen.getByRole('button', { name: '加入收藏' }));
    await waitFor(() =>
      expect(deleteFavorite).toHaveBeenCalledWith('source1', 'v1')
    );
    expect(saveFavorite).not.toHaveBeenCalled();
  });

  it('ignores an older hover status response after a successful favorite mutation', async () => {
    let resolveHover!: (value: boolean) => void;
    (isFavorited as jest.Mock).mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveHover = resolve;
        })
    );
    render(<VideoCard id='v1' source='source1' title='作品' from='search' />);
    fireEvent.mouseEnter(screen.getByRole('img', { name: '作品' }));
    fireEvent.click(screen.getByRole('button', { name: '加入收藏' }));
    expect(
      await screen.findByRole('button', { name: '取消收藏' })
    ).toHaveAttribute('aria-pressed', 'true');
    await act(async () => {
      resolveHover(false);
    });
    expect(screen.getByRole('button', { name: '取消收藏' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('invalidates an old favorite lookup when the card item changes', async () => {
    let resolveHover!: (value: boolean) => void;
    (isFavorited as jest.Mock).mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveHover = resolve;
        })
    );
    const { rerender } = render(
      <VideoCard id='v1' source='source1' title='作品一' from='search' />
    );
    fireEvent.mouseEnter(screen.getByRole('img', { name: '作品一' }));
    rerender(
      <VideoCard id='v2' source='source1' title='作品二' from='search' />
    );
    await act(async () => {
      resolveHover(true);
    });
    expect(screen.getByRole('button', { name: '加入收藏' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });

  it('provides an accessible external information control', () => {
    render(<VideoCard title='作品' from='douban' douban_id={123} />);
    expect(screen.getByRole('button', { name: '跳轉到豆瓣' }).tagName).toBe(
      'BUTTON'
    );
  });
});
