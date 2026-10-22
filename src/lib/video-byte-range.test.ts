import {
  byteRangeHeader,
  parseByteRange,
  readByteRangeResponse,
} from './video-byte-range';
import { buildSegmentCacheKey } from './video-cache';

it('keeps same-file byte ranges in separate cache entries', () => {
  const first = parseByteRange('4@0');
  const second = parseByteRange('4', first.end);
  expect(byteRangeHeader(second)).toBe('bytes=4-7');
  expect(
    buildSegmentCacheKey('https://cdn.test/file.ts', true, first)
  ).not.toBe(buildSegmentCacheKey('https://cdn.test/file.ts', true, second));
  expect(() => parseByteRange('4')).toThrow();
  expect(() => parseByteRange('0@0')).toThrow();
});

it('rejects a full response or wrong-length body for a partial segment', async () => {
  const range = { start: 4, end: 8 };
  const response = (
    status: number,
    size: number,
    contentRange = 'bytes 4-7/16'
  ) =>
    ({
      status,
      headers: { get: () => contentRange },
      arrayBuffer: async () => new ArrayBuffer(size),
    } as unknown as Response);
  await expect(
    readByteRangeResponse(response(200, 16), range)
  ).rejects.toThrow();
  await expect(
    readByteRangeResponse(response(206, 4, 'bytes 0-3/16'), range)
  ).rejects.toThrow();
  await expect(
    readByteRangeResponse(response(206, 3), range)
  ).rejects.toThrow();
  await expect(
    readByteRangeResponse(response(206, 4), range)
  ).resolves.toHaveProperty('byteLength', 4);
});
