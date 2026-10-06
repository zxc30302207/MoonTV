/**
 * 播放進度自動保存間隔（秒）相關默認值與建議范圍。
 *
 * 原始實現按存儲類型硬編碼：Upstash 20 秒（按量計費，拉長間隔以降低寫入），
 * 其余存儲 5 秒。此處統一提供默認值與取值范圍，供服務端配置創建、
 * layout 運行時注入、播放引擎兜底以及管理面板默認展示共用。
 */

/** 非 Upstash 存儲的默認保存間隔（秒） */
export const PLAYBACK_SAVE_DEFAULT_SECONDS = 5;
/** Upstash 存儲的默認保存間隔（秒） */
export const PLAYBACK_SAVE_UPSTASH_SECONDS = 20;

/** 建議范圍下限（秒） */
export const PLAYBACK_SAVE_RECOMMEND_MIN = 5;
/** 建議范圍上限（秒） */
export const PLAYBACK_SAVE_RECOMMEND_MAX = 60;

/** 服務端允許的最小值（秒） */
export const PLAYBACK_SAVE_ALLOWED_MIN = 1;
/** 服務端允許的最大值（秒） */
export const PLAYBACK_SAVE_ALLOWED_MAX = 3600;

/**
 * 根據存儲類型返回播放進度保存間隔的默認值（秒）。
 * @param storageType 存儲類型，如 'upstash' / 'redis' / 'd1' / 'localstorage'
 */
export function getDefaultPlaybackSaveInterval(
  storageType?: string | null
): number {
  return storageType === 'upstash'
    ? PLAYBACK_SAVE_UPSTASH_SECONDS
    : PLAYBACK_SAVE_DEFAULT_SECONDS;
}
