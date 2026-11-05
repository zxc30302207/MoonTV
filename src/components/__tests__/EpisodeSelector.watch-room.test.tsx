import { fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';

import EpisodeSelector from '../EpisodeSelector';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock('@/lib/utils', () => ({
  getVideoResolutionFromM3u8: jest.fn(),
  processImageUrl: (url: string) => url,
}));

it('keeps one watch-room instance alive while switching tabs and respects invite focus', () => {
  HTMLElement.prototype.scrollTo = jest.fn();
  window.history.replaceState({}, '', '/play?room=ABC123');
  const mount = jest.fn();
  const unmount = jest.fn();
  function Room() {
    useEffect(() => {
      mount();
      return unmount;
    }, []);
    return <span>房間內容</span>;
  }
  const { rerender } = render(
    <EpisodeSelector
      totalEpisodes={2}
      episodes_titles={[]}
      setLoading={jest.fn()}
      setIsVideoLoading={jest.fn()}
      setVideoLoadingStage={jest.fn()}
      watchRoomSlot={<Room />}
    />
  );
  expect(screen.getByText('房間內容').parentElement).toHaveClass('flex');
  fireEvent.click(screen.getByText('選集'));
  expect(screen.getByText('房間內容').parentElement).toHaveClass('hidden');
  rerender(
    <EpisodeSelector
      totalEpisodes={2}
      episodes_titles={[]}
      setLoading={jest.fn()}
      setIsVideoLoading={jest.fn()}
      setVideoLoadingStage={jest.fn()}
      watchRoomSlot={<Room />}
    />
  );
  expect(screen.getByText('房間內容').parentElement).toHaveClass('hidden');
  fireEvent.click(screen.getByText('一起看'));
  expect(screen.getByText('房間內容').parentElement).toHaveClass('flex');
  expect(mount).toHaveBeenCalledTimes(1);
  expect(unmount).not.toHaveBeenCalled();
});
