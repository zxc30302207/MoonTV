import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

import { getCachedAuthInfo } from '@/lib/auth-client';
import { roomRequest } from '@/lib/watch-room/client';
import { RoomResponse } from '@/lib/watch-room/types';

import WatchRoomPanel from '../WatchRoomPanel';

jest.mock('@/lib/auth-client', () => ({
  getCachedAuthInfo: jest.fn(),
  refreshAuthInfo: jest.fn().mockResolvedValue(null),
}));
jest.mock('@/lib/watch-room/client', () => ({
  roomRequest: jest.fn(),
  currentPlayPath: () => '/play?source=test&id=1',
}));

const request = jest.mocked(roomRequest);
function panel() {
  return render(
    <WatchRoomPanel
      artPlayerRef={{ current: null }}
      videoTitle='測試電影'
      currentSource='test'
      currentId='1'
      currentEpisodeIndex={0}
      videoUrl=''
      compact
    />
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState({}, '', '/play?source=test&id=1');
  sessionStorage.clear();
  request.mockResolvedValue({ ok: true });
  jest.mocked(getCachedAuthInfo).mockReturnValue({ username: '測試用戶' });
});

it('locks creation during preflight and uses the authenticated display name', async () => {
  panel();
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  let resolve!: (value: RoomResponse) => void;
  request.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  const button = screen.getByRole('button', { name: '創建房間' });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(request).toHaveBeenCalledTimes(2);
  await act(async () => {
    resolve({ ok: true });
  });
  expect(request).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'create',
      name: '測試用戶',
      isPublic: false,
    })
  );
  expect(
    request.mock.calls.filter(([body]) => body.action === 'create')
  ).toHaveLength(1);
});

it('does not create after logout invalidates an in-flight preflight', async () => {
  panel();
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  let resolve!: (value: RoomResponse) => void;
  request.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  fireEvent.click(screen.getByRole('button', { name: '創建房間' }));
  act(() => window.dispatchEvent(new Event('moontv:logout')));
  await act(async () => {
    resolve({ ok: true });
  });
  expect(request.mock.calls.some(([body]) => body.action === 'create')).toBe(
    false
  );
  expect(screen.getByRole('button', { name: '創建房間' })).toBeEnabled();
});

it('does not continue creation when the ownership check fails', async () => {
  panel();
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  request.mockResolvedValueOnce({ ok: false, error: '驗證失敗' });
  fireEvent.click(screen.getByRole('button', { name: '創建房間' }));
  expect(await screen.findByText('驗證失敗')).toBeInTheDocument();
  expect(request.mock.calls.some(([body]) => body.action === 'create')).toBe(
    false
  );
});

it('explains why local-storage login cannot create shared rooms', async () => {
  jest.mocked(getCachedAuthInfo).mockReturnValue({ mode: 'localstorage' });
  panel();
  fireEvent.click(screen.getByRole('button', { name: '創建房間' }));
  expect(await screen.findByText('觀影室需要 Supabase 帳號登入，本機儲存模式不支援。')).toBeInTheDocument();
  expect(request).not.toHaveBeenCalled();
});
