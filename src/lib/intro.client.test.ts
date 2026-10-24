import { getBangumiSubjectIntro } from './bangumi.client';
import { getDoubanIntro } from './douban.client';
import { getIntro } from './intro.client';
import { getVideoDesc } from './video-detail.client';

jest.mock('./bangumi.client', () => ({ getBangumiSubjectIntro: jest.fn() }));
jest.mock('./douban.client', () => ({ getDoubanIntro: jest.fn() }));
jest.mock('./video-detail.client', () => ({ getVideoDesc: jest.fn() }));

describe('unified intro cache', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    window.dispatchEvent(new Event('moontv:logout'));
  });

  it('deduplicates successful lookups and uses Bangumi when requested', async () => {
    (getBangumiSubjectIntro as jest.Mock).mockResolvedValue('動畫簡介');
    const target = { bangumiId: 1, title: '動畫' };
    const first = getIntro(target);
    expect(getIntro(target)).toBe(first);
    expect(await first).toBe('動畫簡介');
    expect(await getIntro(target)).toBe('動畫簡介');
    expect(getBangumiSubjectIntro).toHaveBeenCalledTimes(1);
  });

  it('isolates source fallbacks for the same Douban ID', async () => {
    (getDoubanIntro as jest.Mock).mockResolvedValue('');
    (getVideoDesc as jest.Mock).mockImplementation(async (source) => source);
    expect(
      await getIntro({ doubanId: 1, source: 'a', id: '1', title: 'A' })
    ).toBe('a');
    expect(
      await getIntro({ doubanId: 1, source: 'b', id: '2', title: 'B' })
    ).toBe('b');
    expect(getVideoDesc).toHaveBeenCalledTimes(2);
  });

  it('retries failed provider requests rather than caching an empty intro', async () => {
    (getDoubanIntro as jest.Mock)
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValue('恢復');
    const target = { doubanId: 1, title: '作品' };
    await expect(getIntro(target)).rejects.toThrow('temporary');
    await Promise.resolve();
    expect(await getIntro(target)).toBe('恢復');
  });

  it('does not expose or cache an intro completing after logout', async () => {
    let complete!: (value: string) => void;
    (getVideoDesc as jest.Mock)
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            complete = resolve;
          })
      )
      .mockResolvedValue('new account');
    const target = { source: 'a', id: '1', title: 'A' };
    const old = getIntro(target);
    window.dispatchEvent(new Event('moontv:logout'));
    complete('old account');
    await expect(old).rejects.toThrow('登出');
    expect(await getIntro(target)).toBe('new account');
  });
});
