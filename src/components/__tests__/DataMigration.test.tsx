import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import DataMigration from '@/components/DataMigration';

function migrationResponse(events: Array<Record<string, unknown>>): Response {
  const bytes = new TextEncoder().encode(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')
  );

  return {
    ok: true,
    status: 200,
    headers: { get: () => 'text/event-stream' },
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        // Split events and UTF-8 text across reads, as real streamed responses do.
        for (let offset = 0; offset < bytes.length; offset += 7) {
          controller.enqueue(bytes.slice(offset, offset + 7));
        }
        controller.close();
      },
    }),
  } as unknown as Response;
}

describe('DataMigration with Supabase storage', () => {
  const originalFetch = global.fetch;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  let anchorClick: jest.SpyInstance;

  beforeEach(() => {
    Object.defineProperty(window, 'RUNTIME_CONFIG', {
      configurable: true,
      value: { STORAGE_TYPE: 'supabase' },
    });
    global.fetch = jest.fn();
    URL.createObjectURL = jest.fn(() => 'blob:backup');
    URL.revokeObjectURL = jest.fn();
    anchorClick = jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    anchorClick.mockRestore();
    Reflect.deleteProperty(window, 'RUNTIME_CONFIG');
  });

  it('allows a Supabase export and downloads the streamed backup', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      migrationResponse([
        { type: 'stage', percent: 10, message: '正在導出數據' },
        { type: 'user', percent: 50, message: '用戶資料' },
        { type: 'file_start', filename: 'supabase-backup.dat' },
        { type: 'chunk', data: 'encrypted-backup' },
        { type: 'file_end', percent: 100 },
        { type: 'done' },
      ])
    );
    render(<DataMigration />);

    const exportButton = screen.getByRole('button', { name: '導出數據' });
    expect(exportButton).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('設置強密碼保護備份文件'), {
      target: { value: 'backup-password' },
    });
    expect(exportButton).toBeEnabled();
    fireEvent.click(exportButton);

    await screen.findByText('導出成功');
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/admin/data_migration/export',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'backup-password' }),
      }
    );
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(anchorClick.mock.instances[0].download).toBe('supabase-backup.dat');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:backup');
  });

  it('lets the user dismiss an export error and try again', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      migrationResponse([{ type: 'error', message: '備份服務暫時不可用' }])
    );
    render(<DataMigration />);
    fireEvent.change(screen.getByPlaceholderText('設置強密碼保護備份文件'), {
      target: { value: 'backup-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: '導出數據' }));

    await screen.findByText('導出失敗');
    fireEvent.click(screen.getByRole('button', { name: '關閉' }));
    expect(screen.queryByText('導出失敗')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '導出數據' })).toBeEnabled();
    expect(anchorClick).not.toHaveBeenCalled();
  });

  it('reports interrupted exports without downloading a partial backup', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      migrationResponse([
        { type: 'file_start', filename: 'partial.dat' },
        { type: 'chunk', data: 'partial-backup' },
      ])
    );
    render(<DataMigration />);
    fireEvent.change(screen.getByPlaceholderText('設置強密碼保護備份文件'), {
      target: { value: 'backup-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: '導出數據' }));

    await screen.findByText('導出中斷，未收到完成信號');
    expect(anchorClick).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '關閉' })).toBeEnabled();
  });

  it('shows import metadata as text without interpreting HTML', async () => {
    const serverVersion = '<img src=x onerror=alert(1)>';
    (global.fetch as jest.Mock).mockResolvedValue(
      migrationResponse([
        { type: 'progress', percent: 50, done: 1, total: 2 },
        {
          type: 'done',
          importedUsers: 2,
          timestamp: '2026-10-06T00:00:00.000Z',
          serverVersion,
        },
      ])
    );
    const { container } = render(<DataMigration />);
    const fileInput = container.querySelector('input[type="file"]');
    expect(fileInput).not.toBeNull();
    fireEvent.change(fileInput as HTMLInputElement, {
      target: { files: [new File(['backup'], 'backup.dat')] },
    });
    fireEvent.change(screen.getByPlaceholderText('輸入導出時的加密密碼'), {
      target: { value: 'backup-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: '導入數據' }));

    await screen.findByText('導入成功');
    expect(
      screen.getByText(`服務器版本: ${serverVersion}`)
    ).toBeInTheDocument();
    expect(document.body.querySelector('img')).toBeNull();
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/admin/data_migration/import',
        expect.objectContaining({ method: 'POST', body: expect.any(FormData) })
      )
    );
  });
});
