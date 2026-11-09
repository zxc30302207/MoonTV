import { render, screen } from '@testing-library/react';

import PlayClient from '../PlayClient';
import { usePlayEngine } from '../usePlayEngine';

let query = new URLSearchParams();
jest.mock('next/navigation', () => ({
  useSearchParams: () => query,
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock('../usePlayEngine', () => ({ usePlayEngine: jest.fn() }));
jest.mock('@/components/PageLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
jest.mock('@/components/WatchRoomPanel', () => ({
  __esModule: true,
  default: ({ waitingForVideo }: { waitingForVideo: boolean }) => (
    <div data-testid='room-panel'>{String(waitingForVideo)}</div>
  ),
}));
jest.mock('@/components/AddDownloadModal', () => () => null);
jest.mock('@/components/CacheManager', () => () => null);
jest.mock('@/components/DanmakuSelector', () => () => null);
jest.mock('@/components/EpisodeSelector', () => () => null);
jest.mock('../components/VideoDetailPanel', () => ({
  VideoDetailPanel: () => null,
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(usePlayEngine)
    .mockReturnValue({ loading: true } as ReturnType<typeof usePlayEngine>);
});

it('renders a room-only invitation without initializing video playback', () => {
  query = new URLSearchParams('room=ABC123');
  render(<PlayClient />);
  expect(screen.getByText('觀影室等待中')).toBeInTheDocument();
  expect(screen.getByTestId('room-panel')).toHaveTextContent('true');
  expect(usePlayEngine).not.toHaveBeenCalled();
});

it.each([
  '',
  'room=invalid!',
  'room=ABC123&source=test&id=1',
  'room=ABC123&title=Film',
  'stitle=Film',
])('preserves the normal video entry for %s', (search) => {
  query = new URLSearchParams(search);
  render(<PlayClient />);
  expect(usePlayEngine).toHaveBeenCalled();
  expect(screen.queryByText('觀影室等待中')).not.toBeInTheDocument();
});

it('keeps room feedback visible after leave or a rejected invitation clears the URL', () => {
  query = new URLSearchParams('room=ABC123');
  const view = render(<PlayClient />);
  query = new URLSearchParams();
  view.rerender(<PlayClient />);
  expect(screen.getByTestId('room-panel')).toBeInTheDocument();
  expect(usePlayEngine).not.toHaveBeenCalled();
  query = new URLSearchParams('source=test&id=1');
  view.rerender(<PlayClient />);
  expect(usePlayEngine).toHaveBeenCalled();
});
