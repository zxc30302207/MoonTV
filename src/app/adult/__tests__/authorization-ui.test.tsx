import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ReactNode } from 'react';

import AdultPage from '../page';

jest.mock('@/components/PageLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
jest.mock('@/components/VideoCard', () => ({
  __esModule: true,
  default: ({ title }: { title: string }) => <span>{title}</span>,
}));
jest.mock('@/components/NavigationLoadingProvider', () => ({
  useNavigationLoading: () => ({ startLoading: jest.fn() }),
}));

const response = (data: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => data,
});
function deferred() {
  let resolve!: (value: ReturnType<typeof response>) => void;
  const promise = new Promise<ReturnType<typeof response>>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const list = response({
  list: [{ id: '1', source: 'fixture', title: '測試作品' }],
  hasMore: false,
});

describe('authorization interface', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    global.IntersectionObserver = jest.fn(() => ({
      observe: jest.fn(),
      disconnect: jest.fn(),
    })) as unknown as typeof IntersectionObserver;
  });

  it('keeps unauthorized users behind the gate and labels and masks the key', async () => {
    (fetch as jest.Mock).mockResolvedValue(response({ authorized: false }));
    render(<AdultPage />);
    const input = await screen.findByLabelText('授權卡號');
    expect(input).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByRole('button', { name: '顯示卡號' }));
    expect(input).toHaveAttribute('type', 'text');
    fireEvent.click(screen.getByRole('button', { name: '啟用授權' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '請輸入授權卡號'
    );
    expect(input).toHaveAttribute('aria-describedby', 'authorization-error');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([500, 'offline'])(
    'distinguishes unavailable auth service (%s) and permits retry',
    async (failure) => {
      const mock = fetch as jest.Mock;
      if (failure === 'offline')
        mock.mockRejectedValueOnce(new Error('offline'));
      else mock.mockResolvedValueOnce(response({}, failure as number));
      mock.mockResolvedValue(response({ authorized: false }));
      render(<AdultPage />);
      expect(await screen.findByText('暫時無法確認授權')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '重新檢查' }));
      expect(await screen.findByText('需要成人內容授權')).toBeInTheDocument();
      expect(fetch).toHaveBeenCalledTimes(2);
    }
  );

  it.each([401, 403])(
    'clears loaded protected state on current %s',
    async (status) => {
      (fetch as jest.Mock)
        .mockResolvedValueOnce(response({ authorized: true }))
        .mockResolvedValueOnce(
          response({
            list: [{ id: '1', source: 'fixture', title: '測試作品' }],
            sources: [{ key: 'fixture', name: '測試來源' }],
            refreshKey: '2026-10-24',
            hasMore: false,
          })
        )
        .mockResolvedValueOnce(response({}, status));
      render(<AdultPage />);
      expect(await screen.findByText('測試作品')).toBeInTheDocument();
      expect(screen.getByText('每日更新：2026-10-24')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '測試來源' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(
        status === 401 ? '登入已失效' : '授權已失效'
      );
      expect(screen.queryByText('測試作品')).not.toBeInTheDocument();
      expect(screen.queryByText('測試來源')).not.toBeInTheDocument();
      expect(
        screen.queryByText('每日更新：2026-10-24')
      ).not.toBeInTheDocument();
      expect(screen.getByLabelText('授權卡號')).toBeInTheDocument();
    }
  );

  it('ignores an older list 403 after logout and successful activation', async () => {
    const pending = deferred();
    (fetch as jest.Mock)
      .mockResolvedValueOnce(response({ authorized: true }))
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(response({ authorized: true, expiresAt: null }))
      .mockResolvedValueOnce(list);
    render(<AdultPage />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    act(() => window.dispatchEvent(new Event('moontv:logout')));
    fireEvent.change(screen.getByLabelText('授權卡號'), {
      target: { value: 'fixture-key' },
    });
    fireEvent.click(screen.getByRole('button', { name: '啟用授權' }));
    expect(await screen.findByText('測試作品')).toBeInTheDocument();
    await act(async () => {
      pending.resolve(response({}, 403));
    });
    expect(screen.getByText('測試作品')).toBeInTheDocument();
    expect(screen.queryByLabelText('授權卡號')).not.toBeInTheDocument();
  });

  it('invalidates in-flight activation on logout', async () => {
    const pending = deferred();
    (fetch as jest.Mock)
      .mockResolvedValueOnce(response({ authorized: false }))
      .mockReturnValueOnce(pending.promise);
    render(<AdultPage />);
    fireEvent.change(await screen.findByLabelText('授權卡號'), {
      target: { value: 'fixture-key' },
    });
    fireEvent.click(screen.getByRole('button', { name: '啟用授權' }));
    act(() => window.dispatchEvent(new Event('moontv:logout')));
    await act(async () => {
      pending.resolve(response({ authorized: true }));
    });
    expect(screen.getByLabelText('授權卡號')).toHaveValue('');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('aborts pending requests on unmount and ignores completion', async () => {
    const pending = deferred();
    (fetch as jest.Mock).mockReturnValue(pending.promise);
    const view = render(<AdultPage />);
    const signal = (fetch as jest.Mock).mock.calls[0][1].signal as AbortSignal;
    view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => {
      pending.resolve(response({ authorized: true }));
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not label missing expiry as permanent', async () => {
    (fetch as jest.Mock)
      .mockResolvedValueOnce(response({ authorized: true }))
      .mockResolvedValueOnce(list);
    render(<AdultPage />);
    expect(await screen.findByText('測試作品')).toBeInTheDocument();
    expect(screen.queryByText(/授權到期/)).not.toBeInTheDocument();
  });

  it('ignores a pending authorization success after logout', async () => {
    const pending = deferred();
    (fetch as jest.Mock).mockReturnValueOnce(pending.promise);
    render(<AdultPage />);
    act(() => window.dispatchEvent(new Event('moontv:logout')));
    await act(async () => {
      pending.resolve(response({ authorized: true }));
    });
    expect(screen.getByLabelText('授權卡號')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('uses only the backend expired reason for expiry messaging', async () => {
    (fetch as jest.Mock).mockResolvedValue(
      response({ authorized: false, reason: 'expired', expiresAt: 1 })
    );
    render(<AdultPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('授權已到期');
  });
});
