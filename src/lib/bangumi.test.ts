import { fetchBangumiSubjectDetail } from './bangumi';
import { getConfig } from './config';
import { safeFetch } from './url-safety';

jest.mock('./config', () => ({ getConfig: jest.fn() }));
jest.mock('./url-safety', () => ({ safeFetch: jest.fn() }));

describe('Bangumi subject proxy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getConfig as jest.Mock).mockResolvedValue({
      SiteConfig: { BangumiProxy: 'https://proxy.example/' },
    });
  });

  it('uses SSRF-safe fetching and falls back when the proxy is blocked', async () => {
    (safeFetch as jest.Mock)
      .mockRejectedValueOnce(new Error('Blocked private address'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 1, summary: '簡介' }),
      });
    expect((await fetchBangumiSubjectDetail('1')).summary).toBe('簡介');
    expect(safeFetch).toHaveBeenNthCalledWith(
      1,
      'https://proxy.example/v0/subjects/1',
      expect.objectContaining({ cache: 'no-store' })
    );
    expect(safeFetch).toHaveBeenNthCalledWith(
      2,
      'https://api.bgm.tv/v0/subjects/1',
      expect.anything()
    );
  });

  it('rejects path-like subject IDs before fetching', async () => {
    await expect(fetchBangumiSubjectDetail('../calendar')).rejects.toThrow();
    expect(safeFetch).not.toHaveBeenCalled();
  });
});
