/**
 * 前向緩存"不設時間上限"語義的回歸測試。
 *
 * 背景：預取默認值從 600s 改成"無限"後，`0` 成為哨兵值，
 * 任何把它當成"緩存 0 秒"的實現都會讓功能靜默失效（隊列為空、
 * 暫停後不再往後鋪），因此用測試把語義釘住。
 */

import {
  normalizeCacheSettings,
  UNLIMITED_HORIZON_SECONDS,
} from '../video-cache';
import { __testing__ } from '../video-prefetcher';

const { horizonEndTime } = __testing__;

describe('前向緩存時間上限', () => {
  it('默認不設上限', () => {
    expect(normalizeCacheSettings({}).horizonSeconds).toBe(
      UNLIMITED_HORIZON_SECONDS
    );
    expect(UNLIMITED_HORIZON_SECONDS).toBe(0);
  });

  it('顯式傳 0 保持"無限"，不會被抬成有限值', () => {
    expect(normalizeCacheSettings({ horizonSeconds: 0 }).horizonSeconds).toBe(
      0
    );
  });

  it('有限值低於 1 分鐘時抬到 60s', () => {
    expect(normalizeCacheSettings({ horizonSeconds: 30 }).horizonSeconds).toBe(
      60
    );
    expect(
      normalizeCacheSettings({ horizonSeconds: 1800 }).horizonSeconds
    ).toBe(1800);
  });

  it('無限模式的目標時間點是 +Infinity（隊列鋪到片尾）', () => {
    expect(horizonEndTime(120, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(horizonEndTime(0, UNLIMITED_HORIZON_SECONDS)).toBe(
      Number.POSITIVE_INFINITY
    );
  });

  it('有限模式仍是"當前位置 + 視野"', () => {
    expect(horizonEndTime(120, 600)).toBe(720);
  });

  it('髒數據不會讓上限失控', () => {
    expect(normalizeCacheSettings({ horizonSeconds: -5 }).horizonSeconds).toBe(
      0
    );
    expect(
      normalizeCacheSettings({ horizonSeconds: 99999 }).horizonSeconds
    ).toBe(7200);
    expect(
      normalizeCacheSettings({ horizonSeconds: Number.NaN }).horizonSeconds
    ).toBe(0);
  });
});
