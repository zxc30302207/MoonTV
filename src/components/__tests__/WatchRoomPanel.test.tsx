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
  ...jest.requireActual('@/lib/watch-room/client'),
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
  request.mockReset();
  window.history.replaceState({}, '', '/play?source=test&id=1');
  sessionStorage.clear();
  request.mockResolvedValue({ ok: true });
  jest.mocked(getCachedAuthInfo).mockReturnValue({ username: '測試用戶' });
});

it('locks creation during preflight and uses the authenticated display name', async () => {
  panel();
  await screen.findByRole('button', { name: '創建房間' });
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
  await screen.findByRole('button', { name: '創建房間' });
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
  await screen.findByRole('button', { name: '創建房間' });
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
  expect(
    await screen.findByText(
      '觀影室需要 Supabase 帳號登入，本機儲存模式不支援。'
    )
  ).toBeInTheDocument();
  expect(request).not.toHaveBeenCalled();
});

const savedRoom = {
  id: 'ABC123',
  hostId: 'host',
  hostName: '測試用戶',
  owner: '測試用戶',
  persistent: true,
  title: '我的測試房間',
  playPath: '/play?source=test&id=1',
  episode: 1,
  defaultSyncMode: 'auto' as const,
  state: { playing: false, time: 0, updatedAt: 1 },
  members: [],
  memberCount: 0,
  maxMembers: 20,
  seq: 0,
  createdAt: 1,
  lastActiveAt: 1,
};

it('shows an existing room without automatically activating or polling it', async () => {
  request.mockResolvedValueOnce({ ok: true, room: savedRoom });
  panel();
  expect(
    await screen.findByRole('button', { name: '加入我的觀影室' })
  ).toBeEnabled();
  expect(screen.getByText('當前無人在線 · 上限 20 人')).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: '創建房間' })
  ).not.toBeInTheDocument();
  expect(request.mock.calls.map(([body]) => body.action)).toEqual([
    'hasPersistentRoom',
  ]);
});

it('shows read errors and offers an explicit retry instead of the create form', async () => {
  request.mockResolvedValueOnce({ ok: false, error: '請求超時，正在重試' });
  panel();
  expect(
    await screen.findByText('讀取觀影室超時，請點擊重試')
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: '創建房間' })
  ).not.toBeInTheDocument();
  request.mockResolvedValueOnce({ ok: true, room: savedRoom });
  fireEvent.click(screen.getByRole('button', { name: '重試' }));
  expect(
    await screen.findByRole('button', { name: '加入我的觀影室' })
  ).toBeEnabled();
  expect(request.mock.calls.map(([body]) => body.action)).toEqual([
    'hasPersistentRoom',
    'hasPersistentRoom',
  ]);
});

it('ignores a saved-room query completed after logout', async () => {
  let resolve!: (value: RoomResponse) => void;
  request.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  panel();
  act(() => window.dispatchEvent(new Event('moontv:logout')));
  await act(async () => {
    resolve({ ok: true, room: savedRoom });
  });
  expect(
    screen.queryByRole('button', { name: '加入我的觀影室' })
  ).not.toBeInTheDocument();
});

it('locks manual saved-room activation and ignores its result after logout', async () => {
  request.mockResolvedValueOnce({ ok: true, room: savedRoom });
  panel();
  const button = await screen.findByRole('button', { name: '加入我的觀影室' });
  let resolve!: (value: RoomResponse) => void;
  request.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  fireEvent.click(button);
  fireEvent.click(button);
  expect(
    request.mock.calls.filter(([body]) => body.action === 'activateOwned')
  ).toHaveLength(1);
  act(() => window.dispatchEvent(new Event('moontv:logout')));
  await act(async () => {
    resolve({ ok: true, room: savedRoom, memberId: 'host', isHost: true });
  });
  expect(window.location.search).not.toContain('room=');
  expect(sessionStorage.getItem('moontv:watchroom:member:ABC123')).toBeNull();
  expect(request.mock.calls.some(([body]) => body.action === 'sync')).toBe(
    false
  );
});

it.each([
  ['', 20],
  ['999', 100],
  ['1', 1],
])('normalizes creation capacity %s to %s', async (input, expected) => {
  panel();
  const button = await screen.findByRole('button', { name: '創建房間' });
  fireEvent.change(screen.getByLabelText('人數上限'), {
    target: { value: input },
  });
  fireEvent.click(button);
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'create', maxMembers: expected })
    )
  );
});

it('stops invitation polling when capacity is exhausted and preserves the error', async () => {
  window.history.replaceState({}, '', '/play?source=test&id=1&room=ABC123');
  request.mockResolvedValueOnce({
    ok: false,
    error: '觀影室人數已滿（上限 1 人）',
  });
  panel();
  expect(
    await screen.findByText('觀影室人數已滿（上限 1 人）')
  ).toBeInTheDocument();
  expect(window.location.search).not.toContain('room=');
  expect(
    request.mock.calls.filter(([body]) => body.action === 'sync')
  ).toHaveLength(1);
});

it('activates the saved room only after an explicit click and caches the returned member', async () => {
  request.mockResolvedValueOnce({ ok: true, room: savedRoom });
  panel();
  const button = await screen.findByRole('button', { name: '加入我的觀影室' });
  request.mockResolvedValueOnce({
    ok: true,
    room: savedRoom,
    memberId: 'host',
    isHost: true,
  });
  fireEvent.click(button);
  await waitFor(() => expect(window.location.search).toContain('room=ABC123'));
  expect(sessionStorage.getItem('moontv:watchroom:member:ABC123')).toBe('host');
  expect(request).toHaveBeenCalledWith({
    action: 'activateOwned',
    roomId: 'ABC123',
  });
  expect(
    screen.queryByRole('button', { name: '加入我的觀影室' })
  ).not.toBeInTheDocument();
});
