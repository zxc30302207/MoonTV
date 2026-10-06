import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import {
  deleteFollowing,
  isFollowing,
  saveFollowing,
  subscribeToDataUpdates,
} from '@/lib/db.client';

import VideoCard from '../VideoCard';

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
  }: {
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
