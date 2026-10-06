/**
 * hls.js 碼率檔位 → ArtPlayer「畫質」設置項（P1-6）。
 *
 * 有兩個現實約束決定了這個模塊的寫法：
 *
 * 1. **很多源站的 master playlist 只給 `BANDWIDTH`，不給 `RESOLUTION`。**
 *    這時 hls.js 的 `level.height` 是 `undefined`，任何"按分辨率命名"的實現
 *    都會退化成「檔位 1 / 檔位 2」，而且記憶與預取聯動會整條失效。
 *    因此這裡在 height 缺失時**按碼率推斷高度**（`inferHeightFromBitrate`），
 *    保證菜單、記憶、預取三者始終有可用的檔位標識。
 * 2. **記憶的是"畫面高度"而不是 level 下標**，因為同一部劇換集/換源後
 *    檔位數量和順序都會變，記住下標會指向錯誤的檔位。
 */

/** `hls.currentLevel = -1` 表示自動（ABR） */
export const AUTO_LEVEL = -1;

/** 「最高畫質」快捷項的佔位 value（不是真實的 level 下標） */
export const MAX_LEVEL = -2;

/**
 * 「最高畫質」在 localStorage 裡記錄的畫面高度。
 *
 * 取值 8K（4320）而不是一個特殊標記，是為了直接復用 `pickLevelIndex` 的
 * 「同高度 → 更高檔中最低 → 更低檔中最高」匹配規則：請求 4320 時若視頻
 * 沒有 8K 檔，就會落到"所有檔位裡最高的那一檔"，天然等價於"本視頻的最高畫質"。
 * 於是同一個偏好跨不同碼率的視頻都能得到正確結果。
 */
export const MAX_QUALITY_HEIGHT = 4320;

/**
 * 標准分辨率階梯（畫面高度 → 展示名），降序。
 * 覆蓋到 8K，方便帶 8K 源站正確顯示。
 */
const RESOLUTION_LADDER: ReadonlyArray<{ height: number; label: string }> = [
  { height: 4320, label: '8K' },
  { height: 2880, label: '5K' },
  { height: 2160, label: '4K' },
  { height: 1440, label: '2K' },
  { height: 1080, label: '1080P' },
  { height: 720, label: '720P' },
  { height: 576, label: '576P' },
  { height: 480, label: '480P' },
  { height: 360, label: '360P' },
  { height: 240, label: '240P' },
  { height: 144, label: '144P' },
];

/**
 * 畫質檔位中文名（降序）。
 * 命名對齊主流視頻 App：超高清 / 高清 / 准高清 / 標清 / 流暢 / 省流。
 */
const QUALITY_TIERS: ReadonlyArray<{ minHeight: number; label: string }> = [
  { minHeight: 2160, label: '超高清' },
  { minHeight: 1080, label: '高清' },
  { minHeight: 720, label: '准高清' },
  { minHeight: 480, label: '標清' },
  { minHeight: 360, label: '流暢' },
  { minHeight: 240, label: '省流' },
];

/** 給不出高度信息時的兜底檔位名 */
const LOWEST_TIER = '極速';

/**
 * 碼率階梯（bps → 推斷畫面高度），降序。
 *
 * 只在 master playlist 缺 `RESOLUTION` 時使用。取值參考常見源站的編碼檔位，
 * 寧可能粗一點也不要用「檔位 3」這種沒人能理解的文案。
 */
const BITRATE_LADDER: ReadonlyArray<{ minBps: number; height: number }> = [
  { minBps: 30000000, height: 4320 },
  { minBps: 14000000, height: 2160 },
  { minBps: 8000000, height: 1440 },
  { minBps: 4000000, height: 1080 },
  { minBps: 2000000, height: 720 },
  { minBps: 1000000, height: 480 },
  { minBps: 500000, height: 360 },
  { minBps: 250000, height: 240 },
];

/** 低於最低碼率階梯時的推斷高度 */
const LOWEST_INFERRED_HEIGHT = 144;

/**
 * 畫面高度 → 標准分辨率名。
 *
 * 允許 5% 的向下偏差，把源站常見的非標准高度歸並到最近的上一檔
 * （1078 → 1080P、2144 → 4K），避免出現 `1078p` 這種沒人認識的文案。
 * 完全對不上階梯的高度（如 100）才回落成 `{height}P`。
 */
export function formatResolutionName(height: number): string {
  if (!Number.isFinite(height) || height <= 0) return '';
  const matched = RESOLUTION_LADDER.find(
    (item) => height >= item.height * 0.95
  );
  return matched ? matched.label : `${Math.round(height)}P`;
}

/** 畫面高度 → 畫質檔位中文名（如 `高清`）；無有效高度時返回空串 */
export function qualityTierOf(height: number): string {
  if (!Number.isFinite(height) || height <= 0) return '';
  const matched = QUALITY_TIERS.find((item) => height >= item.minHeight * 0.95);
  return matched ? matched.label : LOWEST_TIER;
}

/**
 * 碼率（bps）→ 推斷的畫面高度；無碼率信息時返回 0。
 *
 * 源站 master 缺 `RESOLUTION` 時的唯一線索。注意它只是**展示與匹配用的
 * 近似值**，不參與任何實際的解碼/渲染決策。
 */
export function inferHeightFromBitrate(bitrate?: number | null): number {
  if (
    typeof bitrate !== 'number' ||
    !Number.isFinite(bitrate) ||
    bitrate <= 0
  ) {
    return 0;
  }
  const matched = BITRATE_LADDER.find((item) => bitrate >= item.minBps);
  return matched ? matched.height : LOWEST_INFERRED_HEIGHT;
}

export interface HlsLevelLike {
  height?: number;
  width?: number;
  bitrate?: number;
  name?: string;
}

/** ArtPlayer setting.selector 的子項結構 */
export interface QualityOption {
  html: string;
  value: number;
  default: boolean;
}

const STORAGE_KEY = 'moontv_preferred_quality_height';

/** 讀取用戶偏好的畫面高度；null 表示自動。異常/髒數據一律回退為自動。 */
export function loadPreferredQualityHeight(): number | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 寫入偏好。傳 null 表示"自動"，此時清除該鍵。 */
export function savePreferredQualityHeight(height: number | null): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (height === null || !Number.isFinite(height) || height <= 0) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, String(Math.round(height)));
  } catch {
    // 隱私模式 / 配額用盡：靜默降級為不記憶
  }
}

function heightOf(level: HlsLevelLike | undefined | null): number {
  const height = level?.height;
  if (typeof height === 'number' && Number.isFinite(height) && height > 0) {
    return Math.round(height);
  }
  return 0;
}

/**
 * 取一個檔位的"有效畫面高度"。
 *
 * 優先用 hls.js 解析出的真實 `height`；缺失時按碼率推斷——源站 master
 * 只寫 `BANDWIDTH` 時，這是唯一能區分 480P / 1080P 的線索。
 * 兩條路徑都拿不到就返回 0，由調用方決定怎麼兜底。
 */
export function resolveLevelHeight(level?: HlsLevelLike | null): number {
  const height = heightOf(level);
  if (height > 0) return height;
  return inferHeightFromBitrate(level?.bitrate);
}

/** `{檔位} {分辨率}`，如 `高清 1080P`；信息不足時逐級退化 */
export function formatQualityLabel(height: number): string {
  const name = formatResolutionName(height);
  const tier = qualityTierOf(height);
  if (tier && name) return `${tier} ${name}`;
  return name || tier;
}

/** 碼率 → 短文案（`5.0Mbps` / `800kbps`）；無值時返回空串 */
function formatBitrate(bitrate?: number | null): string {
  if (
    typeof bitrate !== 'number' ||
    !Number.isFinite(bitrate) ||
    bitrate <= 0
  ) {
    return '';
  }
  if (bitrate >= 1000000) return `${(bitrate / 1000000).toFixed(1)}Mbps`;
  return `${Math.round(bitrate / 1000)}kbps`;
}

/**
 * 為每個檔位生成展示文案。
 *
 * 形如 `高清 1080P`（源站給了分辨率）或 `標清 480P`（按碼率推斷）。
 * 同高度多檔（同分辨率不同碼率）時補上碼率以便區分——否則會出現兩個
 * 一模一樣的選項，用戶無從選擇。
 */
export function formatLevelLabel(
  level: HlsLevelLike,
  index: number,
  levels: HlsLevelLike[]
): string {
  const height = resolveLevelHeight(level);
  const label = formatQualityLabel(height);
  const duplicated =
    height > 0 &&
    levels.filter((item) => resolveLevelHeight(item) === height).length > 1;

  if (label) {
    const bitrate = formatBitrate(level.bitrate);
    return duplicated && bitrate ? `${label} · ${bitrate}` : label;
  }
  if (level.name) return level.name;
  const bitrate = formatBitrate(level.bitrate);
  return bitrate || `檔位 ${index + 1}`;
}

/** 檔位排序權重：高度優先，同高度按碼率 */
function compareLevels(
  a: { level: HlsLevelLike },
  b: { level: HlsLevelLike }
): number {
  const diff = resolveLevelHeight(b.level) - resolveLevelHeight(a.level);
  if (diff !== 0) return diff;
  return (b.level.bitrate ?? 0) - (a.level.bitrate ?? 0);
}

/**
 * 選出畫面最高的 level 下標（同高度取碼率最高的那檔）。
 * 無法判斷時返回 `AUTO_LEVEL`，交給 ABR。
 */
export function pickHighestLevelIndex(levels: HlsLevelLike[]): number {
  if (!levels || levels.length === 0) return AUTO_LEVEL;

  const candidates = levels
    .map((level, index) => ({ level, index }))
    .filter((item) => resolveLevelHeight(item.level) > 0);

  if (candidates.length === 0) return AUTO_LEVEL;

  return candidates.reduce((best, item) =>
    compareLevels(item, best) < 0 ? item : best
  ).index;
}

/**
 * 選出與目標高度最匹配的 level 下標。
 *
 * 匹配順序：同高度 → 更高檔位中最低的那個 → 更低檔位中最高的那個。
 * 返回 -1 表示無可選項（levels 為空或完全沒有分辨率/碼率信息）。
 *
 * 傳入 `MAX_QUALITY_HEIGHT`(4320) 時會走"沒有更高檔"這一支，
 * 於是落到**本視頻最高的那一檔**，即「最高畫質」的語義。
 */
export function pickLevelIndex(
  levels: HlsLevelLike[],
  height: number | null
): number {
  if (!levels || levels.length === 0) return AUTO_LEVEL;
  if (height === null || !Number.isFinite(height) || height <= 0) {
    return AUTO_LEVEL;
  }

  const candidates = levels
    .map((level, index) => ({ index, height: resolveLevelHeight(level) }))
    .filter((item) => item.height > 0);

  if (candidates.length === 0) return AUTO_LEVEL;

  const exact = candidates.filter((item) => item.height === height);
  const pool =
    exact.length > 0
      ? exact
      : (() => {
          const higher = candidates
            .filter((item) => item.height > height)
            .sort((a, b) => a.height - b.height);
          if (higher.length > 0) {
            return higher.filter((item) => item.height === higher[0].height);
          }
          const lower = candidates
            .filter((item) => item.height < height)
            .sort((a, b) => b.height - a.height);
          return lower.filter((item) => item.height === lower[0].height);
        })();

  if (pool.length === 0) return AUTO_LEVEL;

  // 同高度取碼率最高的那一檔
  return pool.reduce((best, item) => {
    const bestBitrate = levels[best.index]?.bitrate ?? 0;
    const itemBitrate = levels[item.index]?.bitrate ?? 0;
    return itemBitrate > bestBitrate ? item : best;
  }).index;
}

/**
 * 生成 ArtPlayer `setting.selector` 選項列表。
 *
 * 結構：`自動` → `最高畫質 (1080P)` → 各檔位（按畫面高度**降序**）。
 *
 * - 「自動」交給 hls.js 的 ABR，`value = AUTO_LEVEL`
 * - 「最高畫質」`value = MAX_LEVEL`，落到本視頻實際存在的最高檔
 *   （不同劇集檔位不同，標簽會帶上實際分辨率，方便用戶確認）
 * - 其余檔位的 `value` 是**原始 levels 下標**，因為 `hls.currentLevel`
 *   用的就是原始下標，排序只影響展示順序
 */
export function buildQualityOptions(
  levels: HlsLevelLike[],
  preferredHeight: number | null
): QualityOption[] {
  const isAuto = preferredHeight === null;
  const isMax = preferredHeight === MAX_QUALITY_HEIGHT;
  const matchedIndex = isAuto
    ? AUTO_LEVEL
    : pickLevelIndex(levels, preferredHeight);

  const highestIndex = pickHighestLevelIndex(levels);
  const highestName =
    highestIndex === AUTO_LEVEL
      ? ''
      : formatResolutionName(resolveLevelHeight(levels[highestIndex]));

  const options: QualityOption[] = [
    { html: '自動', value: AUTO_LEVEL, default: isAuto },
    {
      html: highestName ? `最高畫質 (${highestName})` : '最高畫質',
      value: MAX_LEVEL,
      default: isMax,
    },
  ];

  levels
    .map((level, index) => ({ level, index }))
    .sort(compareLevels)
    .forEach(({ level, index }) => {
      options.push({
        html: formatLevelLabel(level, index, levels),
        value: index,
        // 「最高畫質」選中時不高亮具體檔位：用戶選的是語義而非某個下標
        default: !isAuto && !isMax && matchedIndex === index,
      });
    });

  return options;
}

/** 單檔位的簡短描述（恆帶碼率），用於設置項 tooltip */
export function describeLevel(level: HlsLevelLike | undefined | null): string {
  if (!level) return '自動';
  const label = formatQualityLabel(resolveLevelHeight(level));
  const bitrate = formatBitrate(level.bitrate);
  if (label && bitrate) return `${label} · ${bitrate}`;
  if (label) return label;
  if (level.name) return level.name;
  if (bitrate) return bitrate;
  return '自動';
}

/**
 * 把「用戶偏好」翻譯成設置項的 tooltip 文案。
 *
 * 用戶偏好有三個來源：自動(null) / 最高畫質(MAX_QUALITY_HEIGHT) / 某個具體高度。
 * 「最高畫質」要帶上本視頻實際落到的分辨率，否則換集之後用戶無法確認
 * 到底是 1080P 還是 4K。
 */
export function describeQualityPreference(
  levels: HlsLevelLike[],
  preferredHeight: number | null
): string {
  if (preferredHeight === null) return '自動';

  const index = pickLevelIndex(levels, preferredHeight);

  if (preferredHeight === MAX_QUALITY_HEIGHT) {
    const name =
      index === AUTO_LEVEL
        ? ''
        : formatResolutionName(resolveLevelHeight(levels[index]));
    return name ? `最高畫質 (${name})` : '最高畫質';
  }

  return describeLevel(index === AUTO_LEVEL ? null : levels[index]);
}
