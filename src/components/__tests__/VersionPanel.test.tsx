import { act, render, screen } from '@testing-library/react';

import { VersionPanel } from '../VersionPanel';

const response = (version: string) => ({
  ok: true,
  text: async () => `## [${version}] - 2026-10-24\n### Fixed\n- Test`,
});

describe('VersionPanel upstream status', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('shows green only after the actual upstream matches the integrated version', async () => {
    global.fetch = jest.fn().mockResolvedValue(response('4.7.0'));
    render(<VersionPanel isOpen onClose={jest.fn()} />);
    const status = await screen.findByText('當前為最新版本');
    expect(status).toHaveClass('text-green-800');
    expect(screen.getByText('已是最新版本 v4.7.0')).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringMatching(
        /^https:\/\/raw\.githubusercontent\.com\/Stardm0\/MoonTV\/main\/CHANGELOG\?_t=\d+$/
      ),
      expect.objectContaining({ cache: 'no-store' })
    );
  });

  it('continues announcing future upstream versions', async () => {
    global.fetch = jest.fn().mockResolvedValue(response('4.7.1'));
    render(<VersionPanel isOpen onClose={jest.fn()} />);
    expect(await screen.findByText('發現新版本')).toHaveClass(
      'text-yellow-800'
    );
    expect(screen.getByText('v4.7.0 → v4.7.1')).toBeInTheDocument();
    expect(screen.queryByText('當前為最新版本')).not.toBeInTheDocument();
  });

  it('never shows green on a failed upstream check', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
    render(<VersionPanel isOpen onClose={jest.fn()} />);
    expect(
      await screen.findByText('暫時無法檢查更新，請稍後重試。')
    ).toBeInTheDocument();
    expect(screen.queryByText('當前為最新版本')).not.toBeInTheDocument();
  });

  it('ignores an older in-flight response after reopening and checking again', async () => {
    let resolveOld!: (value: ReturnType<typeof response>) => void;
    global.fetch = jest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          })
      )
      .mockResolvedValueOnce(response('4.7.1'));
    const { rerender } = render(<VersionPanel isOpen onClose={jest.fn()} />);
    rerender(<VersionPanel isOpen={false} onClose={jest.fn()} />);
    rerender(<VersionPanel isOpen onClose={jest.fn()} />);
    await screen.findByText('發現新版本');
    await act(async () => {
      resolveOld(response('4.7.0'));
    });
    expect(screen.getByText('發現新版本')).toBeInTheDocument();
    expect(screen.queryByText('當前為最新版本')).not.toBeInTheDocument();
  });
});
