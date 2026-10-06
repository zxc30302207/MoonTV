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
    '4.2.1',
    'v4.2.1',
    ' 4.2.1\n',
    '4.2.1+fork.1',
    '4.2.1-custom.2',
    '4.2.0',
    '3.9.5',
  ])('does not announce integrated or older %s', (version) => {
    expect(compareVersions(version)).toBe(UpdateStatus.NO_UPDATE);
  });
  it.each(['4.2.2', '4.3.0', '4.10.0', '5.0.0'])(
    'still announces newer %s',
    (version) => {
      expect(compareVersions(version)).toBe(UpdateStatus.HAS_UPDATE);
    }
  );
  it('compares upstream against a custom build suffix', () => {
    expect(compareVersions('4.2.1', '4.2.1-custom.1')).toBe(
      UpdateStatus.NO_UPDATE
    );
    expect(compareVersions('4.2.2', '4.2.1+local')).toBe(
      UpdateStatus.HAS_UPDATE
    );
  });
  it.each([
    '',
    '<html>Error</html>',
    '4.2.1broken',
    '4.2.1.4',
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
      .mockResolvedValue({ ok: true, text: async () => '4.2.1' });
    await expect(checkForUpdates()).resolves.toBe(UpdateStatus.NO_UPDATE);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('VERSION.txt?_t='),
      expect.objectContaining({ cache: 'no-store' })
    );
  });
  it('handles failures without requesting an undefined fallback', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
    await expect(checkForUpdates()).resolves.toBe(UpdateStatus.FETCH_FAILED);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
