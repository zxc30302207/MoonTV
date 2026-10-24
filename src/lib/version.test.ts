import { readFileSync } from 'fs';
import path from 'path';

import { changelog } from './changelog';
import {
  checkForUpdates,
  compareVersions,
  CURRENT_VERSION,
  UpdateStatus,
} from './version';

describe('上游相容版本', () => {
  it('keeps the UI, VERSION.txt and changelog synchronized', () => {
    expect(
      readFileSync(path.join(process.cwd(), 'VERSION.txt'), 'utf8').trim()
    ).toBe(CURRENT_VERSION);
    expect(changelog[0].version).toBe(CURRENT_VERSION);
  });
  it.each([
    '4.7.0',
    'v4.7.0',
    '4.7.0+fork.1',
    '4.7.0-custom.2',
    '4.6.1',
    '4.6.0',
    'v4.6.0',
    '4.6.0+fork.1',
    '4.6.0-custom.2',
    '4.5.1',
    '4.5.0',
    'v4.5.0',
    ' 4.5.0\n',
    '4.5.0+fork.1',
    '4.5.0-custom.2',
    '4.2.0',
    '3.9.5',
  ])('does not announce integrated or older %s', (version) => {
    expect(compareVersions(version)).toBe(UpdateStatus.NO_UPDATE);
  });
  it.each(['4.7.1', '4.8.0', '4.10.0', '5.0.0'])(
    'still announces newer %s',
    (version) => {
      expect(compareVersions(version)).toBe(UpdateStatus.HAS_UPDATE);
    }
  );
  it('compares upstream against a custom build suffix', () => {
    expect(compareVersions('4.5.0', '4.5.0-custom.1')).toBe(
      UpdateStatus.NO_UPDATE
    );
    expect(compareVersions('4.5.1', '4.5.0+local')).toBe(
      UpdateStatus.HAS_UPDATE
    );
  });
  it.each([
    '',
    '<html>Error</html>',
    '4.5.0broken',
    '4.5.0.4',
    '-1.2.3',
    '1e2.3.4',
  ])('rejects malformed response %s without a false alert', (version) => {
    expect(compareVersions(version)).toBe(UpdateStatus.FETCH_FAILED);
  });
});

describe('fresh version fetch', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });
  it('bypasses HTTP cache and compares the response', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, text: async () => '4.7.0' });
    await expect(checkForUpdates()).resolves.toBe(UpdateStatus.NO_UPDATE);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringMatching(
        /^https:\/\/raw\.githubusercontent\.com\/Stardm0\/MoonTV\/main\/VERSION\.txt\?_t=\d+$/
      ),
      expect.objectContaining({ cache: 'no-store' })
    );
  });
  it('handles failures without requesting an undefined fallback', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
    await expect(checkForUpdates()).resolves.toBe(UpdateStatus.FETCH_FAILED);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
  it('fetches again instead of retaining a stale update status', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, text: async () => '4.7.0' })
      .mockResolvedValueOnce({ ok: true, text: async () => '4.7.1' });
    await expect(checkForUpdates()).resolves.toBe(UpdateStatus.NO_UPDATE);
    await expect(checkForUpdates()).resolves.toBe(UpdateStatus.HAS_UPDATE);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
  it.each([
    { ok: false, text: async () => '4.7.0' },
    { ok: true, text: async () => '<html>gateway error</html>' },
  ])('does not turn an HTTP or malformed response green', async (response) => {
    global.fetch = jest.fn().mockResolvedValue(response);
    await expect(checkForUpdates()).resolves.toBe(UpdateStatus.FETCH_FAILED);
  });
});
