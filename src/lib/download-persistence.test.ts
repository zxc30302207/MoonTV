/* eslint-disable @typescript-eslint/no-var-requires */
import {
  clearDownloadSegments,
  loadDownloadState,
  persistDownloadState,
  restoreDownloadProgress,
  saveDownloadSegment,
} from './download-persistence';
import type { M3U8Task } from './m3u8-downloader';

const makeTask = (): M3U8Task =>
  ({
    tsUrlList: ['https://cdn.test/1.ts', 'https://cdn.test/2.ts'],
    finishList: [
      { title: '1', status: 'success' },
      { title: '2', status: '' },
    ],
  } as M3U8Task);

describe('download resume integrity', () => {
  const cache = {
    put: jest.fn(),
    match: jest.fn(),
    keys: jest.fn(),
    delete: jest.fn(),
  };
  beforeAll(() => {
    const { MessageChannel, MessagePort } = require('worker_threads');
    Object.assign(globalThis, { MessageChannel, MessagePort });
    const { Response } = require('undici');
    Object.assign(globalThis, {
      Response,
      caches: { open: jest.fn(async () => cache) },
    });
  });
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });
  it('uses valid namespaced HTTP cache keys', async () => {
    await saveDownloadSegment('task:a', 0, new Uint8Array([1, 2]).buffer);
    expect(cache.put.mock.calls[0][0]).toBe(
      'http://localhost/__moontv_downloads__/task%3Aa/0'
    );
  });
  it('reuses a complete cached segment', async () => {
    const task = makeTask();
    persistDownloadState('one', task);
    task.finishList[0].status = '';
    cache.match.mockResolvedValue(new Response(new Uint8Array([1, 2])));
    await expect(restoreDownloadProgress('one', task)).resolves.toBe(1);
    expect(task.finishList[0].status).toBe('success');
    expect(task.downloadedSegments?.get(0)?.byteLength).toBe(2);
  });
  it('redownloads success markers when bytes were evicted', async () => {
    const task = makeTask();
    persistDownloadState('one', task);
    cache.match.mockResolvedValue(undefined);
    await expect(restoreDownloadProgress('one', task)).resolves.toBe(0);
    expect(task.finishList[0].status).toBe('');
  });
  it('does not reuse a changed playlist with the same segment count', async () => {
    const task = makeTask();
    persistDownloadState('one', task);
    task.tsUrlList[0] = 'https://cdn.test/new.ts';
    await expect(restoreDownloadProgress('one', task)).resolves.toBe(0);
    expect(cache.match).not.toHaveBeenCalled();
  });
  it('clears only this task, not similarly named tasks', async () => {
    const own = { url: 'http://localhost/__moontv_downloads__/abc/0' };
    cache.keys.mockResolvedValue([
      own,
      { url: 'http://localhost/__moontv_downloads__/abc2/0' },
    ]);
    await clearDownloadSegments('abc');
    expect(cache.delete).toHaveBeenCalledTimes(1);
    expect(cache.delete).toHaveBeenCalledWith(own);
  });
  it('ignores malformed saved state', () => {
    localStorage.setItem('downloadTaskStates', '{"one":{"totalSegments":2}}');
    expect(loadDownloadState('one')).toBeNull();
  });
});
