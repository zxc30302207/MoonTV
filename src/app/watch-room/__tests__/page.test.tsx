import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { ReactNode } from 'react';

import { roomRequest } from '@/lib/watch-room/client';
import { RoomResponse } from '@/lib/watch-room/types';

import WatchRoomPage from '../page';

jest.mock('@/components/PageLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
jest.mock('@/lib/auth-client', () => ({
  getCachedAuthInfo: () => ({ username: '測試' }),
  refreshAuthInfo: jest.fn().mockResolvedValue(null),
}));
jest.mock('@/lib/watch-room/client', () => ({ roomRequest: jest.fn() }));
jest.mock('sweetalert2', () => ({ fire: jest.fn() }));

const request = jest.mocked(roomRequest);
beforeEach(() => {
  request.mockReset();
  request.mockResolvedValue({ ok: true, rooms: [] });
});

it('ignores late room list results after logout', async () => {
  const pending: ((value: RoomResponse) => void)[] = [];
  request.mockImplementation(
    () => new Promise((resolve) => pending.push(resolve))
  );
  render(<WatchRoomPage />);
  expect(pending).toHaveLength(2);
  act(() => window.dispatchEvent(new Event('moontv:logout')));
  await act(async () =>
    pending.forEach((resolve) => resolve({ ok: false, error: '舊帳號錯誤' }))
  );
  expect(screen.queryByText('舊帳號錯誤')).not.toBeInTheDocument();
});

it('fails closed when the creation preflight fails', async () => {
  render(<WatchRoomPage />);
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  request.mockResolvedValueOnce({ ok: false, error: '請重新登入' });
  fireEvent.keyDown(screen.getByRole('textbox', { name: '房間名稱' }), {
    key: 'Enter',
  });
  expect(await screen.findByText('請重新登入')).toBeInTheDocument();
  expect(request.mock.calls.some(([body]) => body.action === 'create')).toBe(
    false
  );
});
