/**
 * 「畫質檔位」純邏輯回歸測試（P1-6 / P1-9）。
 *
 * 重點覆蓋：
 *  1. 標准分辨率名（8K / 4K / 2K，以及 1078 → 1080P 的歸並）
 *  2. **源站 master 缺 RESOLUTION 時按碼率推斷檔位**——P1-9 修的就是這條：
 *     不推斷的話菜單會退化成「檔位 1」，記憶與預取聯動會一起失效
 *  3. 畫質檔位中文名 + 分辨率的兩段式文案（`高清 1080P`）
 *  4. 「最高畫質」哨兵在不同碼率視頻裡都落到該視頻最高檔
 *  5. selector 選項的**展示順序**（高度降序）與**value 仍是原始下標**
 */

import {
  AUTO_LEVEL,
  buildQualityOptions,
  describeQualityPreference,
  formatLevelLabel,
  formatQualityLabel,
  formatResolutionName,
  inferHeightFromBitrate,
  MAX_LEVEL,
  MAX_QUALITY_HEIGHT,
  pickHighestLevelIndex,
  pickLevelIndex,
  qualityTierOf,
  resolveLevelHeight,
} from '../hls-quality';

const LADDER = [
  { height: 1080, width: 1920, bitrate: 5_000_000 },
  { height: 720, width: 1280, bitrate: 2_800_000 },
  { height: 480, width: 854, bitrate: 1_200_000 },
  { height: 360, width: 640, bitrate: 700_000 },
];

describe('formatResolutionName', () => {
  it('識別標准分辨率名，最高支持 8K', () => {
    expect(formatResolutionName(4320)).toBe('8K');
    expect(formatResolutionName(2880)).toBe('5K');
    expect(formatResolutionName(2160)).toBe('4K');
    expect(formatResolutionName(1440)).toBe('2K');
    expect(formatResolutionName(1080)).toBe('1080P');
    expect(formatResolutionName(720)).toBe('720P');
    expect(formatResolutionName(480)).toBe('480P');
    expect(formatResolutionName(360)).toBe('360P');
  });

  it('把源站常見的非標准高度歸並到最近的上一檔', () => {
    expect(formatResolutionName(1078)).toBe('1080P');
    expect(formatResolutionName(2144)).toBe('4K');
  });

  it('完全對不上階梯的高度回落為 {height}P，非法值返回空串', () => {
    expect(formatResolutionName(100)).toBe('100P');
    expect(formatResolutionName(0)).toBe('');
    expect(formatResolutionName(Number.NaN)).toBe('');
  });
});

describe('qualityTierOf', () => {
  it('按畫面高度給出畫質檔位中文名', () => {
    expect(qualityTierOf(2160)).toBe('超高清');
    expect(qualityTierOf(4320)).toBe('超高清');
    expect(qualityTierOf(1080)).toBe('高清');
    expect(qualityTierOf(720)).toBe('准高清');
    expect(qualityTierOf(480)).toBe('標清');
    expect(qualityTierOf(360)).toBe('流暢');
    expect(qualityTierOf(240)).toBe('省流');
  });

  it('比最低檔還低的給兜底名，非法值返回空串', () => {
    expect(qualityTierOf(144)).toBe('極速');
    expect(qualityTierOf(0)).toBe('');
  });
});

describe('inferHeightFromBitrate', () => {
  it('按碼率階梯推斷畫面高度', () => {
    expect(inferHeightFromBitrate(5_200_000)).toBe(1080);
    expect(inferHeightFromBitrate(2_400_000)).toBe(720);
    expect(inferHeightFromBitrate(1_100_000)).toBe(480);
    expect(inferHeightFromBitrate(700_000)).toBe(360);
    expect(inferHeightFromBitrate(300_000)).toBe(240);
  });

  it('極低碼率給最低推斷檔，無碼率信息返回 0', () => {
    expect(inferHeightFromBitrate(120_000)).toBe(144);
    expect(inferHeightFromBitrate(0)).toBe(0);
    expect(inferHeightFromBitrate(null)).toBe(0);
    expect(inferHeightFromBitrate(Number.NaN)).toBe(0);
  });
});

describe('resolveLevelHeight', () => {
  it('優先用真實 height', () => {
    expect(resolveLevelHeight({ height: 1080, bitrate: 900_000 })).toBe(1080);
  });

  it('height 缺失時按碼率推斷（源站只給 BANDWIDTH 的場景）', () => {
    expect(resolveLevelHeight({ bitrate: 5_200_000 })).toBe(1080);
    expect(resolveLevelHeight({ bitrate: 1_100_000 })).toBe(480);
    expect(resolveLevelHeight({ height: 0, bitrate: 2_400_000 })).toBe(720);
  });

  it('兩條路徑都拿不到時返回 0', () => {
    expect(resolveLevelHeight({})).toBe(0);
    expect(resolveLevelHeight(null)).toBe(0);
  });
});

describe('formatQualityLabel', () => {
  it('輸出「檔位 分辨率」兩段式文案', () => {
    expect(formatQualityLabel(2160)).toBe('超高清 4K');
    expect(formatQualityLabel(1080)).toBe('高清 1080P');
    expect(formatQualityLabel(720)).toBe('准高清 720P');
    expect(formatQualityLabel(480)).toBe('標清 480P');
    expect(formatQualityLabel(360)).toBe('流暢 360P');
    expect(formatQualityLabel(0)).toBe('');
  });
});

describe('pickHighestLevelIndex', () => {
  it('取畫面最高的檔位', () => {
    expect(pickHighestLevelIndex(LADDER)).toBe(0);
  });

  it('同高度取碼率最高的那一檔', () => {
    const levels = [
      { height: 1080, bitrate: 3_000_000 },
      { height: 1080, bitrate: 6_000_000 },
      { height: 720, bitrate: 2_000_000 },
    ];
    expect(pickHighestLevelIndex(levels)).toBe(1);
  });

  it('源站只給帶寬時也能按碼率推斷出最高檔', () => {
    expect(
      pickHighestLevelIndex([{ bitrate: 1_100_000 }, { bitrate: 5_200_000 }])
    ).toBe(1);
  });

  it('完全沒有分辨率也沒有碼率信息時回退自動', () => {
    expect(pickHighestLevelIndex([])).toBe(AUTO_LEVEL);
    expect(pickHighestLevelIndex([{ bitrate: 0 }])).toBe(AUTO_LEVEL);
  });
});

describe('「最高畫質」哨兵在跨碼率視頻上的語義', () => {
  it('請求 8K 時落到該視頻實際存在的最高檔', () => {
    expect(pickLevelIndex(LADDER, MAX_QUALITY_HEIGHT)).toBe(0);
  });

  it('換到一個最高只有 720P 的視頻時，落到這個視頻的最高檔', () => {
    const sdOnly = [
      { height: 720, bitrate: 2_800_000 },
      { height: 480, bitrate: 1_200_000 },
    ];
    expect(pickLevelIndex(sdOnly, MAX_QUALITY_HEIGHT)).toBe(0);
  });

  it('視頻真的有 8K 時精確命中 8K', () => {
    const with8k = [
      { height: 1080, bitrate: 5_000_000 },
      { height: 4320, bitrate: 60_000_000 },
    ];
    expect(pickLevelIndex(with8k, MAX_QUALITY_HEIGHT)).toBe(1);
  });
});

describe('buildQualityOptions', () => {
  it('結構為 自動 → 最高畫質 → 各檔位（高度降序）', () => {
    const options = buildQualityOptions(LADDER, null);

    expect(options.map((item) => item.value)).toEqual([
      AUTO_LEVEL,
      MAX_LEVEL,
      0, // 1080P
      1, // 720P
      2, // 480P
      3, // 360P
    ]);
    expect(options[0].html).toBe('自動');
    expect(options[1].html).toBe('最高畫質 (1080P)');
    expect(options[2].html).toBe('高清 1080P');
  });

  it('源站 master 缺 RESOLUTION 時菜單仍有可讀的檔位名（P1-9）', () => {
    const bitrateOnly = [
      { bitrate: 5_200_000 },
      { bitrate: 2_400_000 },
      { bitrate: 1_100_000 },
    ];
    const options = buildQualityOptions(bitrateOnly, null);

    expect(options.map((item) => item.html)).toEqual([
      '自動',
      '最高畫質 (1080P)',
      '高清 1080P',
      '准高清 720P',
      '標清 480P',
    ]);
  });

  it('value 始終是原始 levels 下標，排序只影響展示順序', () => {
    // 故意給一個亂序的 levels：最低檔排在最前
    const shuffled = [
      { height: 360, bitrate: 700_000 },
      { height: 1080, bitrate: 5_000_000 },
      { height: 720, bitrate: 2_800_000 },
    ];
    const options = buildQualityOptions(shuffled, null);
    const levelOptions = options.filter((item) => item.value >= 0);

    expect(levelOptions.map((item) => item.html)).toEqual([
      '高清 1080P',
      '准高清 720P',
      '流暢 360P',
    ]);
    // 1080P 的 value 必須是它在原數組裡的下標 1
    expect(levelOptions[0].value).toBe(1);
  });

  it('默認選中項跟隨偏好高度', () => {
    const options = buildQualityOptions(LADDER, 720);
    expect(options[0].default).toBe(false); // 自動
    expect(options[1].default).toBe(false); // 最高畫質
    expect(options.find((item) => item.value === 1)?.default).toBe(true);
  });

  it('偏好為 null 時默認選中「自動」', () => {
    const options = buildQualityOptions(LADDER, null);
    expect(options[0].default).toBe(true);
    expect(options[1].default).toBe(false);
  });

  it('偏好為「最高畫質」時不高亮具體檔位', () => {
    const options = buildQualityOptions(LADDER, MAX_QUALITY_HEIGHT);
    expect(options[1].default).toBe(true);
    expect(options.slice(2).every((item) => !item.default)).toBe(true);
  });

  it('levels 為空時只剩兩個快捷項', () => {
    const options = buildQualityOptions([], null);
    expect(options).toHaveLength(2);
    expect(options[1].html).toBe('最高畫質');
  });
});

describe('formatLevelLabel', () => {
  it('同高度多檔時補碼率以便區分', () => {
    const levels = [
      { height: 1080, bitrate: 3_000_000 },
      { height: 1080, bitrate: 6_000_000 },
    ];
    expect(formatLevelLabel(levels[0], 0, levels)).toBe('高清 1080P · 3.0Mbps');
    expect(formatLevelLabel(levels[1], 1, levels)).toBe('高清 1080P · 6.0Mbps');
  });

  it('唯一檔位只顯示「檔位 + 分辨率」', () => {
    expect(formatLevelLabel(LADDER[0], 0, LADDER)).toBe('高清 1080P');
  });

  it('只有碼率的檔位靠推斷命名，而不是顯示「檔位 N」', () => {
    expect(formatLevelLabel({ bitrate: 1_100_000 }, 0, [])).toBe('標清 480P');
  });

  it('連碼率都沒有時才回落 name / 序號', () => {
    expect(formatLevelLabel({ name: 'hd' }, 0, [])).toBe('hd');
    expect(formatLevelLabel({}, 2, [])).toBe('檔位 3');
  });
});

describe('describeQualityPreference', () => {
  it('自動 / 最高畫質 / 具體檔位三種文案', () => {
    expect(describeQualityPreference(LADDER, null)).toBe('自動');
    expect(describeQualityPreference(LADDER, MAX_QUALITY_HEIGHT)).toBe(
      '最高畫質 (1080P)'
    );
    expect(describeQualityPreference(LADDER, 720)).toBe(
      '准高清 720P · 2.8Mbps'
    );
  });

  it('levels 為空時不拋異常', () => {
    expect(describeQualityPreference([], null)).toBe('自動');
    expect(describeQualityPreference([], MAX_QUALITY_HEIGHT)).toBe('最高畫質');
  });
});
