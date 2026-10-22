/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, no-console, @next/next/no-img-element */

'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import {
  setSettingSwitch,
  setSettingTooltip,
  updateSettingPreservingPanel,
} from '@/lib/artplayer-setting';
import {
  AnimeMatch,
  AnimeOption,
  DanmakuRequestError,
  extractSeasonFromTitle,
  findAutoDanmakuMatch,
  findDanmakuEpisodeFromSearch,
  getDanmakuBySelectedAnime,
  getDanmakuUrlByEpisodeId,
  resolveDanmakuEpisodeNumber,
} from '@/lib/danmaku.client';
import {
  deleteSkipConfig,
  generateStorageKey,
  getAllPlayRecords,
  getSkipConfig,
  savePlayRecord,
  saveSkipConfig,
} from '@/lib/db.client';
import {
  AUTO_LEVEL,
  buildQualityOptions,
  describeLevel,
  describeQualityPreference,
  loadPreferredQualityHeight,
  MAX_LEVEL,
  MAX_QUALITY_HEIGHT,
  pickHighestLevelIndex,
  pickLevelIndex,
  resolveLevelHeight,
  savePreferredQualityHeight,
} from '@/lib/hls-quality';
import { describeHlsError, PlaybackRecovery } from '@/lib/playback-recovery';
import { getDefaultPlaybackSaveInterval } from '@/lib/playback-settings';
import { isDirectM3U8Url, sanitizePlaybackResult } from '@/lib/playback-url';
import { shouldThrottlePrefetch } from '@/lib/prefetch-scheduler';
import { matchesFullSearchTitle } from '@/lib/search-title';
import {
  type SourceProbeResult,
  type VideoProbeInfo,
  getSourceProbeKey,
  rankSourcesByProbeResults,
  selectEpisodeUrlForSource,
} from '@/lib/source-preference';
import { SearchResult } from '@/lib/types';
import {
  getRequestTimeout,
  getVideoResolutionFromM3u8,
  processImageUrl,
} from '@/lib/utils';
import {
  clearVideoCache,
  getSegmentProbe,
  loadCacheSettings,
  saveCacheSettings,
  UNLIMITED_HORIZON_SECONDS,
} from '@/lib/video-cache';
import {
  getNextEpisodePrefetcher,
  getVideoPrefetcher,
  PrefetchStats,
} from '@/lib/video-prefetcher';

import {
  clearGlobalError,
  triggerGlobalError,
} from '@/components/GlobalErrorIndicator';

import { wrapArtplayerPluginDanmuku } from './danmuku-live-font-size';
import {
  bindDeferredProgressSeek,
  PROGRESS_PREVIEW_END,
  PROGRESS_PREVIEW_MOVE,
  ProgressPreviewMove,
} from './deferred-progress-seek';
import { useVideoActions } from './hooks/useVideoActions';
import { useWakeLock } from './hooks/useWakeLock';
import {
  createCustomHlsLoader,
  createDanmakuInitialConfig,
  DANMAKU_VISIBLE_RESTORE_DELAY_MS,
  formatTime,
  pickDanmakuSettings,
  saveDanmakuSettings,
  SkipConfig,
} from './play-utils';
import { PreviewThumbnailer } from './preview-thumbnailer';

/** 進度條懸停預覽浮層的實時狀態 */
export interface PlayPreviewState {
  visible: boolean;
  /** 懸停對應的時間點（秒） */
  time: number;
  /** 相對進度條寬度的百分比水平位置（0-100） */
  left: number;
  /** 已抽取的預覽圖 dataURL；加載中 / 失敗為 null */
  image: string | null;
}

// 擴展 HTMLVideoElement 類型以支持 hls 屬性
declare global {
  interface HTMLVideoElement {
    hls?: any;
  }
}

/**
 * 同一集內最多自動換源次數（P1-5）。
 *
 * 換滿仍未成功就停下來提示用戶手動選源：如果所有源都掛了，
 * 無上限的自動換源只會把候選列表掃成死循環（A→B→C→A...）。
 */
const MAX_AUTO_SOURCE_SWITCHES = 3;

/** 「畫質」設置項的 name，`setting.update` 靠它定位 */
const QUALITY_SETTING_NAME = '畫質';
const AD_SETTING_NAME = '去廣告';

/** 「視頻緩存」設置項的 name */
const CACHE_SETTING_NAME = '視頻緩存';

/** 「彈幕源」設置項的 name */
const DANMAKU_SETTING_NAME = '彈幕源';

/**
 * 下一集預熱的覆蓋時長（秒）。
 *
 * 這是唯一還保留時間上限的地方：預熱只是為了"切過去不卡"，沒必要把整集
 * 都拉下來。當前集的預取已改為不設上限（緩存到片尾）；用戶真切過去之後，
 * 當前集預取器會接管，按無限視野繼續往後鋪。
 */
const NEXT_EPISODE_HORIZON_SECONDS = 420;

/**
 * 組裝「視頻緩存」設置項的 tooltip 文案。
 *
 * `hitRate` 為 null 表示還沒有任何片段請求，因此沒有命中率可展示。
 */
function buildCacheTooltip(
  stats: PrefetchStats,
  hitRate: number | null
): string {
  switch (stats.state) {
    case 'disabled':
      return stats.message || '已關閉';
    case 'parsing':
      return '解析播放列表中...';
    case 'error':
      return stats.message || '緩存不可用';
    case 'idle':
      return '未開始';
    default:
      break;
  }

  if (stats.total === 0) return '未開始';

  const coverPart =
    stats.coverTo > 0 ? ` · 已覆蓋 ${formatTime(stats.coverTo)}` : '';
  const hitPart =
    hitRate === null ? '' : ` · 命中 ${Math.round(hitRate * 100)}%`;
  return `${stats.cached}/${stats.total} 段${coverPart}${hitPart}`;
}

/**
 * 播放頁引擎。
 *
 * 負責播放頁的全部核心邏輯：源加載/優選、劇集切換、ArtPlayer 生命周期、
 * 彈幕自動匹配、去廣告、跳過片頭片尾、播放記錄、鍵盤快捷鍵與狀態清理等。
 *
 * 返回一個包含渲染所需狀態/回調的對象，供 {@link PlayClient} 組合展示。
 */
function getDanmakuSourceStorageKey(title: string, year?: string) {
  const normalizedTitle = title.trim().toLowerCase();
  const normalizedYear = (year || '').match(/\d{4}/)?.[0] || '';
  return `danmakuSource:${normalizedTitle}:${normalizedYear}`;
}

function getDanmakuPlaybackStorageKey(source?: string, id?: string) {
  const normalizedSource = (source || '').trim().toLowerCase();
  const normalizedId = (id || '').trim();
  if (!normalizedSource || !normalizedId) return '';
  return `danmakuSource:play:${normalizedSource}:${normalizedId}`;
}

export function usePlayEngine() {
  const searchParams = useSearchParams();

  // -----------------------------------------------------------------------------
  // 狀態變量（State）
  // -----------------------------------------------------------------------------
  const [loading, setLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState<
    'searching' | 'preferring' | 'fetching' | 'ready'
  >('searching');
  const [loadingMessage, setLoadingMessage] = useState('正在搜索播放源...');
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<SearchResult | null>(null);
  const [isDanmakuPluginReady, setIsDanmakuPluginReady] = useState(false);
  const [isDanmakuLoading, setIsDanmakuLoading] = useState(false);

  // 跳過片頭片尾配置
  const [skipConfig, setSkipConfig] = useState<SkipConfig>({
    enable: false,
    intro_time: 0,
    outro_time: 0,
  });
  const skipConfigRef = useRef(skipConfig);
  const restartPrefetchForSkipRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    skipConfigRef.current = skipConfig;
    restartPrefetchForSkipRef.current?.();
  }, [
    skipConfig,
    skipConfig.enable,
    skipConfig.intro_time,
    skipConfig.outro_time,
  ]);

  // 跳過檢查的時間間隔控制
  const lastSkipCheckRef = useRef(0);
  // 預緩存窗口續跑的時間間隔控制（播放自然推進時定期檢查窗口余量）
  const lastPrefetchCheckRef = useRef(0);
  // —— 弱網自動降檔 ——
  // 最近 2 分鐘內的卡頓時間戳；反復卡頓時把 ABR 上限壓一檔，寧可糊一點不要一直轉圈
  const stallTimesRef = useRef<number[]>([]);
  // 記錄已提示過的降檔狀態，避免 notice 反復彈
  const downshiftNoticeRef = useRef<string | null>(null);

  const [isBlockAdChanged, setIsBlockAdChanged] = useState(false);
  // 去廣告開關（從 localStorage 繼承，默認 true）
  const [blockAdEnabled, setBlockAdEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      try {
        const v = localStorage.getItem('enable_blockad');
        if (v !== null) return v !== 'false';
      } catch {
        /* Keep the safe default when storage is blocked. */
      }
    }
    return true;
  });
  const blockAdEnabledRef = useRef(blockAdEnabled);
  useEffect(() => {
    blockAdEnabledRef.current = blockAdEnabled;
  }, [blockAdEnabled]);

  // 視頻預緩存（Cache Storage）。
  // 預取器與播放狀態完全解耦：視頻暫停、頁面切後台時仍會繼續把前向片段寫進緩存。
  // 進度不走 React state——它會以 250ms 的節奏回調，走 state 會讓整頁高頻重渲染，
  // 這裡直接更新 ArtPlayer 的設置項 tooltip。
  const prefetcherRef = useRef(getVideoPrefetcher());
  const cacheClearPromiseRef = useRef<Promise<void> | null>(null);
  const previousCacheEpisodeRef = useRef<number | null>(null);

  // 下一集預熱（落地路線第 3 步）。獨立實例，避免打斷當前集的隊列。
  // `nextWarmupKeyRef` 記錄"已經為哪一集的哪個檔位預熱過"，防止重復排隊。
  const nextWarmupKeyRef = useRef<string | null>(null);

  // 彈幕源選擇相關
  const [selectedDanmakuSource, setSelectedDanmakuSource] = useState<
    string | null
  >(null);
  const [selectedDanmakuAnime, setSelectedDanmakuAnime] =
    useState<AnimeOption | null>(null);
  const [selectedDanmakuEpisode, setSelectedDanmakuEpisode] = useState<
    number | undefined
  >(undefined);
  const [showDanmakuSelector, setShowDanmakuSelector] = useState(false);
  const [showCacheManager, setShowCacheManager] = useState(false);
  const selectedDanmakuSourceRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // 同步 ref
  useEffect(() => {
    selectedDanmakuSourceRef.current = selectedDanmakuSource;
  }, [selectedDanmakuSource]);

  // 視頻基本信息
  const [videoTitle, setVideoTitle] = useState(searchParams.get('title') || '');
  const [videoYear, setVideoYear] = useState(searchParams.get('year') || '');
  const [videoCover, setVideoCover] = useState('');
  const [videoDoubanId, setVideoDoubanId] = useState(0);
  // 當前源和ID
  const [currentSource, setCurrentSource] = useState(
    searchParams.get('source') || ''
  );
  const [currentId, setCurrentId] = useState(searchParams.get('id') || '');

  // 搜索所需信息
  const [searchTitle] = useState(searchParams.get('stitle') || '');
  const [searchType] = useState(searchParams.get('stype') || '');

  // 集數相關
  const [currentEpisodeIndex, setCurrentEpisodeIndex] = useState(0);

  // 自動匹配彈幕設置
  const [autoDanmakuEnabled, setAutoDanmakuEnabled] = useState(false);

  const [currentTooltip, setCurrentTooltip] = useState('');
  const [selectedState, setSelectedState] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const savedAuto = localStorage.getItem('autoDanmakuEnabled');
    if (savedAuto !== null) {
      setAutoDanmakuEnabled(savedAuto === 'true');
    }

    localStorage.removeItem('preferredDanmakuPlatform');
  }, []);

  const currentSourceRef = useRef(currentSource);
  const currentIdRef = useRef(currentId);
  const videoTitleRef = useRef(videoTitle);
  const videoYearRef = useRef(videoYear);
  const detailRef = useRef<SearchResult | null>(detail);
  const currentEpisodeIndexRef = useRef(currentEpisodeIndex);

  // 手動選集優先；切集或卸載後到達的舊請求不能覆蓋當前彈幕。
  useEffect(() => {
    if (!selectedDanmakuAnime || !isDanmakuPluginReady || !selectedState)
      return;
    const episodeNumber = selectedDanmakuEpisode ?? 1;
    const episode = selectedDanmakuAnime.episodes[episodeNumber - 1];
    if (!episode) {
      setSelectedState(false);
      return;
    }
    let cancelled = false;
    const plugin = danmukuPluginInstanceRef.current;
    (async () => {
      try {
        const url = await getDanmakuBySelectedAnime(
          selectedDanmakuAnime,
          episodeNumber,
          'xml'
        );
        if (cancelled || plugin !== danmukuPluginInstanceRef.current) return;
        if (plugin && url !== lastDanmakuUrlRef.current) {
          plugin.config({ danmuku: url });
          plugin.load();
          lastDanmakuUrlRef.current = url;
        }
        setSettingTooltip(
          artPlayerRef.current,
          DANMAKU_SETTING_NAME,
          episode.episodeTitle
        );
        setCurrentTooltip(episode.episodeTitle);
        restoreDanmakuVisibility();
        clearGlobalError();
      } catch (error) {
        if (!cancelled) console.error('獲取彈幕 URL 失敗:', error);
      } finally {
        if (!cancelled) setSelectedState(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    currentEpisodeIndex,
    selectedDanmakuAnime,
    selectedDanmakuEpisode,
    selectedState,
    isDanmakuPluginReady,
  ]);

  // 同步最新值到 refs
  useEffect(() => {
    currentSourceRef.current = currentSource;
    currentIdRef.current = currentId;
    detailRef.current = detail;
    currentEpisodeIndexRef.current = currentEpisodeIndex;
    videoTitleRef.current = videoTitle;
    videoYearRef.current = videoYear;
  }, [
    currentSource,
    currentId,
    detail,
    currentEpisodeIndex,
    videoTitle,
    videoYear,
  ]);

  // 切集時清空"已試過的源"與"自動換源次數"：
  // 某個源只是這一集掛了，不代表下一集也掛，不該把懲罰帶到下一集。
  useEffect(() => {
    const previousEpisode = previousCacheEpisodeRef.current;
    previousCacheEpisodeRef.current = currentEpisodeIndex;
    // 切集或換源立即中止舊下載，是否刪除已落盤緩存由清理開關單獨決定。
    prefetcherRef.current.stop();
    getNextEpisodePrefetcher().stop();
    if (
      previousEpisode !== null &&
      previousEpisode !== currentEpisodeIndex &&
      loadCacheSettings().autoClearOnEpisodeChange
    ) {
      const previousClear = cacheClearPromiseRef.current;
      const stopped = Promise.all([
        prefetcherRef.current.stopAndWait(),
        getNextEpisodePrefetcher().stopAndWait(),
      ]);
      // 新當前集可能正是已預熱的下一集，同時保留它之後一集的預熱。
      const episodePrefix = `${currentSource}:${currentId}`;
      const keepEpisodeKeys = [
        `${episodePrefix}:${currentEpisodeIndex}`,
        `${episodePrefix}:${currentEpisodeIndex + 1}`,
      ];
      const clearing = (async () => {
        await previousClear;
        await stopped;
        await clearVideoCache(keepEpisodeKeys);
      })().catch((error) => {
        console.error('切集自動清理緩存失敗:', error);
      });
      cacheClearPromiseRef.current = clearing;
      void clearing.finally(() => {
        if (cacheClearPromiseRef.current === clearing) {
          cacheClearPromiseRef.current = null;
        }
      });
    }
    triedSourcesRef.current = new Set();
    autoSwitchCountRef.current = 0;
  }, [currentEpisodeIndex]);

  useEffect(() => {
    // 切集/換源後"下一集"的目標變了，舊的預熱隊列立刻作廢。
    // 已經落盤的分片不受影響（緩存鍵與集數無關），不會白費。
    nextWarmupKeyRef.current = null;
    getNextEpisodePrefetcher().stop();
  }, [currentEpisodeIndex, currentSource, currentId]);

  // 視頻播放地址
  const [videoUrl, setVideoUrl] = useState('');

  // 總集數
  const totalEpisodes = detail?.episodes?.length || 0;

  // 用於記錄是否需要在播放器 ready 後跳轉到指定進度
  const resumeTimeRef = useRef<number | null>(null);
  // 上次使用的音量，默認 0.7
  const lastVolumeRef = useRef<number>(0.7);
  // 上次使用的播放速率，默認 1.0
  const lastPlaybackRateRef = useRef<number>(1.0);
  const lastFullscreenRef = useRef<boolean>(false);
  const lastFullscreenWebRef = useRef<boolean>(false);
  // 彈幕插件配置：默認配置疊加本地持久化的用戶設置，保證刷新後自動恢復
  const danmakuConfigRef = useRef<any>(createDanmakuInitialConfig());

  // 換源相關狀態
  const [availableSources, setAvailableSources] = useState<SearchResult[]>([]);
  const [sourceSearchLoading, setSourceSearchLoading] = useState(false);
  const [sourceSearchError, setSourceSearchError] = useState<string | null>(
    null
  );

  // 自動換源的候選列表（P1-5）：必須走 ref，因為讀取它的是注冊在
  // ArtPlayer 創建時（早於後續渲染）的 HLS 錯誤回調。
  useEffect(() => {
    availableSourcesRef.current = availableSources;
  }, [availableSources]);

  // 當前集數的播放地址。監聽器（timeupdate/seeked/pause）是在創建播放器
  // 那一刻注冊的，閉包裡的 videoUrl 會隨切集而過期；預取必須按實時地址走，
  // 否則會把上一集的片段寫進緩存，白燒帶寬。
  const currentVideoUrlRef = useRef<string>('');
  useEffect(() => {
    currentVideoUrlRef.current = videoUrl;
  }, [videoUrl]);

  // 保存優選時的測速結果，避免EpisodeSelector重復測速
  const [precomputedVideoInfo, setPrecomputedVideoInfo] = useState<
    Map<string, VideoProbeInfo>
  >(new Map());

  // 換源加載狀態
  const [isVideoLoading, setIsVideoLoading] = useState(true);
  const [videoLoadingStage, setVideoLoadingStage] = useState<
    'initing' | 'sourceChanging' | 'optimizing'
  >('initing');

  // 播放進度保存相關
  const saveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastSaveTimeRef = useRef<number>(0);

  const artPlayerRef = useRef<any>(null);
  const artRef = useRef<HTMLDivElement | null>(null);
  /** ArtPlayer 根節點，供把返回/標題 portal 進播放器（全屏也能看見） */
  const [playerHost, setPlayerHost] = useState<HTMLElement | null>(null);
  const danmukuPluginInstanceRef = useRef<any>(null); // 彈幕插件實例

  // ---- 進度條懸停預覽 ----
  const previewThumbnailerRef = useRef<PreviewThumbnailer | null>(null);
  const previewTimerRef = useRef<number | null>(null);
  const previewRequestIdRef = useRef(0);
  const [preview, setPreview] = useState<PlayPreviewState | null>(null);
  const lastDanmakuUrlRef = useRef<string>(''); // 上一次加載的彈幕 URL
  const pendingDanmakuVisibleRestoreRef = useRef<boolean | null>(null); // 切集後待恢復的彈幕可見狀態

  // ---- P1-5 / P1-6 相關 ----
  /** 當前 HLS 實例的錯誤恢復狀態機（換源/重建時銷毀重建） */
  const recoveryRef = useRef<PlaybackRecovery | null>(null);
  /** 最近一次渲染的 availableSources，供早於本輪渲染注冊的回調讀取 */
  const availableSourcesRef = useRef<SearchResult[]>([]);
  /** 最近一次渲染的 handleSourceChange，供 HLS 錯誤回調讀取（避免閉包過期） */
  const handleSourceChangeRef = useRef<
    | ((
        newSource: string,
        newId: string,
        newTitle: string,
        options?: { auto?: boolean }
      ) => Promise<void>)
    | null
  >(null);
  /** 本集內已經嘗試過的源（`source:id`），防止自動換源來回橫跳 */
  const triedSourcesRef = useRef<Set<string>>(new Set());
  /** 本集內已自動換源次數 */
  const autoSwitchCountRef = useRef<number>(0);
  /** 當前期望的畫質高度，null 表示自動 */
  const preferredHeightRef = useRef<number | null>(
    loadPreferredQualityHeight()
  );
  const isEpisodeSwitchingRef = useRef(false); // 標記當前是否為切集切換
  const danmakuVisibleRestoreTimerRef = useRef<NodeJS.Timeout | null>(null); // 延遲恢復彈幕可見性的定時器

  // Wake Lock（屏幕常亮）
  const { requestWakeLock, releaseWakeLock } = useWakeLock();

  // 切換集數時臨時隱藏彈幕，待彈幕獲取成功後恢復
  const hideDanmakuDuringEpisodeSwitch = () => {
    if (danmakuVisibleRestoreTimerRef.current) {
      clearTimeout(danmakuVisibleRestoreTimerRef.current);
      danmakuVisibleRestoreTimerRef.current = null;
    }

    const inst = danmukuPluginInstanceRef.current as any;
    const currentVisible =
      typeof inst?.visible === 'boolean'
        ? inst.visible
        : !!danmakuConfigRef.current.visible;

    pendingDanmakuVisibleRestoreRef.current = currentVisible;
    danmakuConfigRef.current.visible = false;

    if (!inst) return;

    try {
      inst.config({ visible: false });
    } catch (_) {
      // ignore
    }

    try {
      if (typeof inst.visible === 'boolean') {
        inst.visible = false;
      }
    } catch (_) {
      // ignore
    }
  };

  const restoreDanmakuVisibility = () => {
    if (pendingDanmakuVisibleRestoreRef.current === null) return;
    const visible = pendingDanmakuVisibleRestoreRef.current;
    if (danmakuVisibleRestoreTimerRef.current)
      clearTimeout(danmakuVisibleRestoreTimerRef.current);
    danmakuVisibleRestoreTimerRef.current = setTimeout(() => {
      danmakuConfigRef.current.visible = visible;
      danmukuPluginInstanceRef.current?.config({ visible });
      pendingDanmakuVisibleRestoreRef.current = null;
      danmakuVisibleRestoreTimerRef.current = null;
    }, DANMAKU_VISIBLE_RESTORE_DELAY_MS);
  };

  // -----------------------------------------------------------------------------
  // 播放源優選
  // -----------------------------------------------------------------------------

  // 播放源優選函數
  const preferBestSource = async (
    sources: SearchResult[],
    isCancelled?: () => boolean
  ): Promise<SearchResult> => {
    if (sources.length === 0) {
      throw new Error('No playback sources to prefer');
    }
    if (sources.length === 1) return sources[0];

    if (isCancelled?.()) {
      throw new Error('Source preference cancelled');
    }

    const batchSize = Math.ceil(sources.length / 2);
    const currentEpisodeIndex = currentEpisodeIndexRef.current;
    const allResults: SourceProbeResult[] = [];
    const failedProbe = (
      source: SearchResult,
      index: number
    ): SourceProbeResult => ({
      source,
      index,
      testResult: {
        quality: 'Error',
        loadSpeed: 'Unknown',
        pingTime: 0,
        hasError: true,
      },
    });

    for (let start = 0; start < sources.length; start += batchSize) {
      if (isCancelled?.()) {
        throw new Error('Source preference cancelled');
      }
      const batchSources = sources.slice(start, start + batchSize);
      const batchResults = await Promise.all(
        batchSources.map(async (source, batchIndex) => {
          const index = start + batchIndex;
          try {
            const episodeUrl = selectEpisodeUrlForSource(
              source,
              currentEpisodeIndex
            );
            if (!episodeUrl) {
              console.warn(
                `Playback source ${source.source_name} has no playable episode URL`
              );
              return failedProbe(source, index);
            }

            const testResult = await getVideoResolutionFromM3u8(episodeUrl);

            return {
              source,
              testResult,
              index,
            };
          } catch {
            return failedProbe(source, index);
          }
        })
      );
      allResults.push(...batchResults);
    }

    const newVideoInfoMap = new Map<string, VideoProbeInfo>();
    allResults.forEach((result) => {
      newVideoInfoMap.set(
        getSourceProbeKey(result.source, currentEpisodeIndex),
        result.testResult
      );
    });

    if (isCancelled?.()) {
      throw new Error('Source preference cancelled');
    }
    setPrecomputedVideoInfo(newVideoInfoMap);

    const rankedSources = rankSourcesByProbeResults(sources, allResults);
    const sortedSources = rankedSources.map((item) => item.source);

    if (isCancelled?.()) {
      throw new Error('Source preference cancelled');
    }
    setAvailableSources(sortedSources);

    const bestSource = rankedSources.find((item) => item.score >= 0);
    if (!bestSource) {
      console.warn('All playback sources failed probing, using first source');
      return sources[0];
    }

    return bestSource.source;
  };

  // 更新視頻地址
  const updateVideoUrl = (
    detailData: SearchResult | null,
    episodeIndex: number
  ) => {
    if (
      !detailData ||
      !detailData.episodes ||
      episodeIndex < 0 ||
      episodeIndex >= detailData.episodes.length
    ) {
      setVideoUrl('');
      return;
    }
    const newUrl = detailData?.episodes[episodeIndex] || '';
    if (!isDirectM3U8Url(newUrl)) {
      console.warn('Rejected non-m3u8 playback URL', {
        source: detailData.source,
        id: detailData.id,
        episodeIndex,
        url: newUrl,
      });
      setVideoUrl('');
      setIsVideoLoading(false);
      setError(
        '播放地址不是有效的 m3u8，已阻止網頁播放頁進入播放器，請切換其他片源。'
      );
      return;
    }
    if (newUrl !== videoUrl) {
      setError(null);
      setVideoUrl(newUrl);
    }
  };

  const ensureVideoSource = (video: HTMLVideoElement | null, url: string) => {
    if (!video || !url) return;
    const sources = Array.from(video.getElementsByTagName('source'));
    const existed = sources.some((s) => s.src === url);
    if (!existed) {
      // 移除舊的 source，保持唯一
      sources.forEach((s) => s.remove());
      const sourceEl = document.createElement('source');
      sourceEl.src = url;
      video.appendChild(sourceEl);
    }

    // 始終允許遠程播放（AirPlay / Cast）
    video.disableRemotePlayback = false;
    // 如果曾經有禁用屬性，移除之
    if (video.hasAttribute('disableRemotePlayback')) {
      video.removeAttribute('disableRemotePlayback');
    }
  };

  const getPlaybackUrl = (url: string, enableBlockAd: boolean) => {
    if (!enableBlockAd || !isDirectM3U8Url(url)) return url;
    return `/api/m3u8/filter?url=${encodeURIComponent(url)}`;
  };

  // 清理播放器資源的統一函數
  const cleanupPlayer = () => {
    // 先取消待執行的退避重試，避免定時器醒來後操作已銷毀的 hls 實例
    recoveryRef.current?.dispose();
    recoveryRef.current = null;
    setPlayerHost(null);

    if (artPlayerRef.current) {
      try {
        lastFullscreenRef.current = !!artPlayerRef.current.fullscreen;
        lastFullscreenWebRef.current = !!artPlayerRef.current.fullscreenWeb;
        if (danmukuPluginInstanceRef.current) {
          const inst = danmukuPluginInstanceRef.current as any;
          if (inst.option) {
            const next = { ...inst.option };
            if ('mount' in next) next.mount = undefined;
            if ('danmuku' in next) next.danmuku = '';
            danmakuConfigRef.current = next;
          } else if (typeof inst.visible === 'boolean') {
            danmakuConfigRef.current.visible = inst.visible;
          }
        }
        // 銷毀 HLS 實例
        if (artPlayerRef.current.video && artPlayerRef.current.video.hls) {
          artPlayerRef.current.video.hls.destroy();
        }

        // 銷毀 ArtPlayer 實例
        artPlayerRef.current.destroy();
        artPlayerRef.current = null;

        console.log('播放器資源已清理');
      } catch (err) {
        console.warn('清理播放器資源時出錯:', err);
        artPlayerRef.current = null;
      }
    }
  };

  // -----------------------------------------------------------------------------
  // 跳過片頭片尾
  // -----------------------------------------------------------------------------

  // 跳過片頭片尾配置相關函數
  const handleSkipConfigChange = async (newConfig: SkipConfig) => {
    if (!currentSourceRef.current || !currentIdRef.current) return;

    try {
      setSkipConfig(newConfig);
      if (!newConfig.enable && !newConfig.intro_time && !newConfig.outro_time) {
        await deleteSkipConfig(currentSourceRef.current, currentIdRef.current);
        artPlayerRef.current.setting.update({
          name: '跳過片頭片尾',
          html: '跳過片頭片尾',
          switch: skipConfigRef.current.enable,
          onSwitch: function (item: any) {
            const newConfig = {
              ...skipConfigRef.current,
              enable: !item.switch,
            };
            handleSkipConfigChange(newConfig);
            return !item.switch;
          },
        });
        artPlayerRef.current.setting.update({
          name: '設置片頭',
          html: '設置片頭',
          icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="12" r="2" fill="#ffffff"/><path d="M9 12L17 12" stroke="#ffffff" stroke-width="2"/><path d="M17 6L17 18" stroke="#ffffff" stroke-width="2"/></svg>',
          tooltip:
            skipConfigRef.current.intro_time === 0
              ? '設置片頭時間'
              : `${formatTime(skipConfigRef.current.intro_time)}`,
          onClick: function () {
            const currentTime = artPlayerRef.current?.currentTime || 0;
            if (currentTime > 0) {
              const newConfig = {
                ...skipConfigRef.current,
                intro_time: currentTime,
              };
              handleSkipConfigChange(newConfig);
              return `${formatTime(currentTime)}`;
            }
          },
        });
        artPlayerRef.current.setting.update({
          name: '設置片尾',
          html: '設置片尾',
          icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 6L7 18" stroke="#ffffff" stroke-width="2"/><path d="M7 12L15 12" stroke="#ffffff" stroke-width="2"/><circle cx="19" cy="12" r="2" fill="#ffffff"/></svg>',
          tooltip:
            skipConfigRef.current.outro_time >= 0
              ? '設置片尾時間'
              : `-${formatTime(-skipConfigRef.current.outro_time)}`,
          onClick: function () {
            const outroTime =
              -(
                artPlayerRef.current?.duration -
                artPlayerRef.current?.currentTime
              ) || 0;
            if (outroTime < 0) {
              const newConfig = {
                ...skipConfigRef.current,
                outro_time: outroTime,
              };
              handleSkipConfigChange(newConfig);
              return `-${formatTime(-outroTime)}`;
            }
          },
        });
      } else {
        await saveSkipConfig(
          currentSourceRef.current,
          currentIdRef.current,
          newConfig
        );
      }
      console.log('跳過片頭片尾配置已保存:', newConfig);
    } catch (err) {
      console.error('保存跳過片頭片尾配置失敗:', err);
    }
  };

  // 當集數索引變化時自動更新視頻地址
  useEffect(() => {
    updateVideoUrl(detail, currentEpisodeIndex);
  }, [detail, currentEpisodeIndex]);

  // 集數切換時同步 URL 中的 ep 參數（1 基），便於刷新/分享後仍停留在當前集（不刷新頁面）
  useEffect(() => {
    if (loading || !detail || !detail.episodes) return;
    if (
      currentEpisodeIndex < 0 ||
      currentEpisodeIndex >= detail.episodes.length
    ) {
      return;
    }
    const ep = currentEpisodeIndex + 1;
    const newUrl = new URL(window.location.href);
    const currentEp = newUrl.searchParams.get('ep');
    if (currentEp === String(ep)) return;
    newUrl.searchParams.set('ep', String(ep));
    window.history.replaceState({}, '', newUrl.toString());
  }, [loading, detail, currentEpisodeIndex]);

  // -----------------------------------------------------------------------------
  // 初始化：拉取全部源並確定播放數據
  // -----------------------------------------------------------------------------

  // 進入頁面時直接獲取全部源信息
  useEffect(() => {
    const fetchSourcesData = async (
      query: string,
      onResult?: (results: SearchResult[]) => void
    ): Promise<SearchResult[]> => {
      setSourceSearchLoading(true);
      setSourceSearchError('');

      const aggregatedResults: SearchResult[] = [];
      const targetYear = videoYearRef.current;

      try {
        // 發起流式搜索請求
        const timeoutSeconds = getRequestTimeout();
        const response = await fetch(
          `/api/search?q=${encodeURIComponent(
            query.trim()
          )}&timeout=${timeoutSeconds}&stream=1`
        );
        if (!response.ok) throw new Error('搜索失敗');

        const reader: ReadableStreamDefaultReader<Uint8Array> | undefined =
          response.body?.getReader();
        if (!reader) throw new Error('無法讀取搜索流');

        const decoder = new TextDecoder();
        let buffer = '';
        let done = false;

        while (!done) {
          const { value, done: readerDone } = await reader.read();
          done = readerDone;

          if (value) {
            buffer += decoder.decode(value, { stream: true });
            const lines: string[] = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (!line.trim()) continue;

              try {
                const data = JSON.parse(line) as {
                  pageResults?: SearchResult[];
                };
                if (data.pageResults) {
                  const filteredResults: SearchResult[] = data.pageResults
                    .map(sanitizePlaybackResult)
                    .filter((r: SearchResult) => {
                      if (!r.episodes.length) return false;
                      const titleMatch = matchesFullSearchTitle(r.title, query);
                      const yearMatch = targetYear
                        ? r.year.toLowerCase() === targetYear.toLowerCase()
                        : true;
                      const typeMatch = searchType
                        ? (searchType === 'tv' && r.episodes.length > 1) ||
                          (searchType === 'movie' && r.episodes.length === 1)
                        : true;
                      return titleMatch && yearMatch && typeMatch;
                    });

                  if (filteredResults.length > 0) {
                    const newOnes = filteredResults.filter(
                      (r) =>
                        !aggregatedResults.some(
                          (item) => item.source === r.source && item.id === r.id
                        )
                    );

                    if (newOnes.length > 0) {
                      aggregatedResults.push(...newOnes);
                      setAvailableSources([...aggregatedResults]);
                      setSourceSearchLoading(false);
                      onResult?.(newOnes);
                    }
                  }
                }
              } catch (err) {
                console.warn('解析行 JSON 失敗:', err);
              }
            }
          }
        }
        setSourceSearchLoading(false);

        return aggregatedResults;
      } catch (err) {
        setSourceSearchError(err instanceof Error ? err.message : '搜索失敗');
        setAvailableSources([]);
        return [];
      }
    };

    /**
     * 初始化播放數據
     */
    function initDetail(rawDetailData: SearchResult) {
      const detailData = sanitizePlaybackResult(rawDetailData);
      if (detailData.episodes.length === 0) {
        setError('此片源沒有可播放的 m3u8 地址，請切換其他片源。');
        setLoading(false);
        setIsVideoLoading(false);
        return;
      }
      setCurrentSource(detailData.source);
      setCurrentId(detailData.id);
      setVideoYear(detailData.year);
      setVideoTitle(detailData.title || videoTitleRef.current);
      setVideoCover(detailData.poster);
      setVideoDoubanId(detailData.douban_id || 0);
      setDetail(detailData);

      // 傳入的起始集數超出本源可用集數范圍時，直接定位到最後一集（而非回到第一集）。
      // 以 URL 的 ep 為准，避免依賴可能尚未寫入的 state / 播放記錄。
      const requestedEp = Number(
        new URLSearchParams(window.location.search).get('ep')
      );
      const requestedIndex =
        Number.isInteger(requestedEp) && requestedEp >= 1
          ? requestedEp - 1
          : currentEpisodeIndex;
      if (
        detailData.episodes.length > 0 &&
        (requestedIndex < 0 || requestedIndex >= detailData.episodes.length)
      ) {
        setCurrentEpisodeIndex(
          requestedIndex < 0 ? 0 : detailData.episodes.length - 1
        );
      }

      // 規范 URL 參數
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('source', detailData.source);
      newUrl.searchParams.set('id', detailData.id);
      newUrl.searchParams.set('year', detailData.year);
      newUrl.searchParams.set('title', detailData.title);
      newUrl.searchParams.delete('prefer');
      window.history.replaceState({}, '', newUrl.toString());

      setLoadingStage('ready');
      setLoadingMessage('✨ 准備就緒，即將開始播放...');
      setTimeout(() => setLoading(false), 500);
    }

    const initAll = async () => {
      if (!currentSource && !currentId && !videoTitle && !searchTitle) {
        setError('缺少必要參數');
        setLoading(false);
        return;
      }

      setLoading(true);
      setLoadingStage(currentSource && currentId ? 'fetching' : 'searching');
      setLoadingMessage(
        currentSource && currentId
          ? '🎬 正在獲取視頻詳情...'
          : '🔍 正在搜索播放源...'
      );
      // 從 localStorage 讀取是否啟用優選播放源（避免狀態延遲）
      const enablePreferBestSourceFromStorage = (() => {
        if (typeof window === 'undefined') return false;
        const saved = localStorage.getItem('enablePreferBestSource');
        if (saved === null) return false;
        try {
          return JSON.parse(saved);
        } catch {
          return false;
        }
      })();

      let detailData: SearchResult | null = null;
      let allResults: SearchResult[] = [];
      let hasInitialized = false; // 標記是否已經初始化過播放數據

      await fetchSourcesData(videoTitle || searchTitle, (newResults) => {
        allResults = [...allResults, ...newResults];

        // 如果還沒確定 detailData，就嘗試找目標源
        if (!detailData && currentSource && currentId) {
          const match = newResults.find(
            (item) => item.source === currentSource && item.id === currentId
          );
          if (match) {
            detailData = match;
            // 如果未啟用優選，立即初始化播放數據
            if (!enablePreferBestSourceFromStorage) {
              initDetail(detailData);
              hasInitialized = true;
            }
            // 如果啟用優選，則等待所有源收集完再決定是否優選
          }
        }
      });

      // 流式搜索結束：如果目標源沒找到，就 fallback
      if (!detailData && allResults.length > 0) {
        detailData = allResults[0];
      }

      // 完全沒結果
      if (!detailData) {
        setError('未找到匹配結果');
        setLoading(false);
        return;
      }

      if (enablePreferBestSourceFromStorage && allResults.length > 1) {
        setLoadingStage('preferring');
        setLoadingMessage('🚀 正在優選播放源...');
        try {
          const bestSource = await preferBestSource(allResults);
          // preferBestSource 內部已經排序了 availableSources 並設置了 precomputedVideoInfo
          detailData = bestSource;
        } catch (err) {
          console.error('優選播放源失敗:', err);
          // 失敗時使用原來的 detailData
        }
      }

      // 如果尚未初始化播放數據，則初始化
      if (!hasInitialized) {
        initDetail(detailData);
      }
    };

    initAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -----------------------------------------------------------------------------
  // 彈幕自動匹配
  // -----------------------------------------------------------------------------

  // 視頻初始化後即可匹配彈幕
  useEffect(() => {
    if (isDanmakuPluginReady && isBlockAdChanged) {
      danmukuPluginInstanceRef.current.config({
        danmuku: lastDanmakuUrlRef.current,
      });
      danmukuPluginInstanceRef.current.load();
      setIsBlockAdChanged(false);
      return;
    }
    if (!detail || !isDanmakuPluginReady || selectedState) return;

    // 取消之前的請求
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    // 獲取嘗試次數設置
    let retryCount = 3;
    try {
      const saved = localStorage.getItem('danmakuRetryCount');
      if (saved !== null) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed)) retryCount = parsed;
      }
    } catch {
      // ignore
    }

    let attempt = 0;
    let success = false;
    let hadRequestError = false;
    let lastRequestError: unknown = null;
    const maxAttempts =
      retryCount === -1 ? 2 : Math.max(1, Math.min(retryCount + 1, 2));

    const fetchDanmaku = async () => {
      setIsDanmakuLoading(true);
      while (
        !success &&
        !abortController.signal.aborted &&
        attempt < maxAttempts
      ) {
        attempt++;
        try {
          const title = videoTitleRef.current;
          const currentEpisodeTitle =
            detailRef.current?.episodes_titles?.[
              currentEpisodeIndexRef.current
            ] || '';
          const epNum = resolveDanmakuEpisodeNumber(
            currentEpisodeTitle,
            currentEpisodeIndexRef.current
          );
          let manualDanmakuAnime: AnimeOption | null = null;
          if (typeof window !== 'undefined') {
            try {
              const storageKeys = [
                getDanmakuPlaybackStorageKey(
                  currentSourceRef.current,
                  currentIdRef.current
                ),
                getDanmakuSourceStorageKey(title, videoYearRef.current),
              ].filter(Boolean);
              for (const key of storageKeys) {
                const saved = localStorage.getItem(key);
                if (saved) {
                  manualDanmakuAnime = JSON.parse(saved) as AnimeOption;
                  break;
                }
              }
            } catch {
              manualDanmakuAnime = null;
            }
          }
          if (!manualDanmakuAnime && selectedDanmakuAnime) {
            manualDanmakuAnime = selectedDanmakuAnime;
          }
          const manualDanmaku = manualDanmakuAnime
            ? findDanmakuEpisodeFromSearch([manualDanmakuAnime], epNum)
            : null;
          if (manualDanmaku && manualDanmakuAnime) {
            const url = getDanmakuUrlByEpisodeId(
              manualDanmaku.episodeId,
              'xml'
            );
            if (
              danmukuPluginInstanceRef.current &&
              url !== lastDanmakuUrlRef.current
            ) {
              danmukuPluginInstanceRef.current.config({ danmuku: url });
              danmukuPluginInstanceRef.current.load();
              lastDanmakuUrlRef.current = url;
            }
            const tooltip =
              manualDanmaku.episodeTitle ||
              `${manualDanmaku.animeTitle} EP${epNum}`;
            if (artPlayerRef.current) {
              setSettingTooltip(
                artPlayerRef.current,
                DANMAKU_SETTING_NAME,
                tooltip
              );
            }
            setSelectedDanmakuSource(manualDanmakuAnime.animeTitle);
            setCurrentTooltip(tooltip);
            restoreDanmakuVisibility();
            clearGlobalError();
            success = true;
            break;
          }

          if (!autoDanmakuEnabled) {
            restoreDanmakuVisibility();
            setIsDanmakuLoading(false);
            return;
          }

          const season = extractSeasonFromTitle(title);
          const result = await findAutoDanmakuMatch({
            title,
            year: videoYearRef.current,
            episodeNumber: epNum,
            season,
            signal: abortController.signal,
            preferSearchSource: true,
          });
          console.log(
            `自動彈幕快速匹配第${attempt}次:`,
            result.source || 'no-match',
            result.fileName || '',
            result.match
          );
          if (abortController.signal.aborted) return;
          const matchedDanmaku: AnimeMatch | null = result.match;

          if (matchedDanmaku) {
            const m = matchedDanmaku;
            const url = getDanmakuUrlByEpisodeId(m.episodeId, 'xml');
            if (
              danmukuPluginInstanceRef.current &&
              url !== lastDanmakuUrlRef.current
            ) {
              danmukuPluginInstanceRef.current.config({ danmuku: url });
              danmukuPluginInstanceRef.current.load();
              lastDanmakuUrlRef.current = url;
            }
            const tooltip = m.episodeTitle || `${m.animeTitle} EP${epNum}`;
            if (artPlayerRef.current) {
              setSettingTooltip(
                artPlayerRef.current,
                DANMAKU_SETTING_NAME,
                tooltip
              );
            }
            setSelectedDanmakuSource(m.animeTitle || '自動彈幕');
            setCurrentTooltip(tooltip);
            restoreDanmakuVisibility();
            clearGlobalError();
            success = true;
            break;
          }

          if (result.error) {
            hadRequestError = true;
            lastRequestError = result.error;
            if (attempt < maxAttempts) {
              await new Promise((res) => setTimeout(res, 500));
              continue;
            }
          }

          break;
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') {
            console.log('自動加載彈幕已取消');
            return;
          }
          hadRequestError = true;
          lastRequestError = err;
          console.error(`自動彈幕匹配第${attempt}次失敗:`, err);
          if (attempt < maxAttempts) {
            await new Promise((res) => setTimeout(res, 500));
          }
        }
      }
      if (!success && !abortController.signal.aborted) {
        const missingDandanplayAuth =
          lastRequestError instanceof DanmakuRequestError &&
          lastRequestError.code === 'DANMAKU_UPSTREAM_AUTH_REQUIRED';
        triggerGlobalError(
          missingDandanplayAuth
            ? '彈幕 API 尚未配置，請設定 NEXT_PUBLIC_DANMU_API_BASE_URL 或 DANDANPLAY_APP_ID / DANDANPLAY_APP_SECRET'
            : hadRequestError
            ? '自動加載彈幕失敗，請手動選擇彈幕源'
            : '未匹配到彈幕，請手動選擇彈幕源'
        );
      }
      if (!abortController.signal.aborted) {
        restoreDanmakuVisibility();
        setIsDanmakuLoading(false);
      }
    };
    fetchDanmaku();

    // 清理函數：當依賴項變化或組件卸載時中止請求
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, [
    currentEpisodeIndex,
    detail,
    autoDanmakuEnabled,
    isDanmakuPluginReady,
    selectedDanmakuAnime,
    videoTitle,
    videoYear,
  ]);

  // -----------------------------------------------------------------------------
  // 播放記錄與跳過配置恢復
  // -----------------------------------------------------------------------------

  // 播放記錄處理
  useEffect(() => {
    // 僅在初次掛載時檢查播放記錄
    const initFromHistory = async () => {
      if (!currentSource || !currentId) return;

      try {
        const allRecords = await getAllPlayRecords();
        const key = generateStorageKey(currentSource, currentId);
        const record = allRecords[key];

        // URL 攜帶的起始集數（1 基，如追更頁按標題匹配到的當前播放集數），優先采用
        const requestedEp = Number(searchParams.get('ep'));
        const requestedIndex =
          Number.isInteger(requestedEp) && requestedEp >= 1
            ? requestedEp - 1
            : -1;

        if (requestedIndex >= 0) {
          // 僅當本地記錄與指定集數一致時才恢復播放進度，否則從該集開頭播放
          const targetTime =
            record && record.index - 1 === requestedIndex
              ? record.play_time
              : 0;
          if (requestedIndex !== currentEpisodeIndex) {
            setCurrentEpisodeIndex(requestedIndex);
          }
          resumeTimeRef.current = targetTime;
          return;
        }

        if (record) {
          const targetIndex = record.index - 1;
          const targetTime = record.play_time;

          // 更新當前選集索引
          if (targetIndex !== currentEpisodeIndex) {
            setCurrentEpisodeIndex(targetIndex);
          }

          // 保存待恢復的播放進度，待播放器就緒後跳轉
          resumeTimeRef.current = targetTime;
        }
      } catch (err) {
        console.error('讀取播放記錄失敗:', err);
      }
    };

    initFromHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 跳過片頭片尾配置處理
  useEffect(() => {
    // 僅在初次掛載時檢查跳過片頭片尾配置
    const initSkipConfig = async () => {
      if (!currentSource || !currentId) return;

      try {
        const config = await getSkipConfig(currentSource, currentId);
        if (config) {
          setSkipConfig(config);
        }
      } catch (err) {
        console.error('讀取跳過片頭片尾配置失敗:', err);
      }
    };

    initSkipConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -----------------------------------------------------------------------------
  // 換源與劇集切換
  // -----------------------------------------------------------------------------

  // 處理換源
  const handleSourceChange = async (
    newSource: string,
    newId: string,
    newTitle: string,
    options?: { auto?: boolean }
  ) => {
    try {
      // 用戶手動換源時清空自動換源的"已試過"記錄與次數；
      // 自動換源則保留，否則會在 A→B→A 之間反復橫跳。
      if (!options?.auto) {
        triedSourcesRef.current.clear();
        autoSwitchCountRef.current = 0;
      }

      setSelectedState(false);
      // 顯示換源加載狀態
      setVideoLoadingStage('sourceChanging');
      setIsVideoLoading(true);

      // 記錄當前播放進度（僅在同一集數切換時恢復）
      const currentPlayTime = artPlayerRef.current?.currentTime || 0;
      console.log('換源前當前播放時間:', currentPlayTime);

      // 清除並設置下一個跳過片頭片尾配置
      if (currentSourceRef.current && currentIdRef.current) {
        try {
          await deleteSkipConfig(
            currentSourceRef.current,
            currentIdRef.current
          );
          await saveSkipConfig(newSource, newId, skipConfigRef.current);
        } catch (err) {
          console.error('清除跳過片頭片尾配置失敗:', err);
        }
      }

      const rawNewDetail = availableSources.find(
        (source) => source.source === newSource && source.id === newId
      );
      if (!rawNewDetail) {
        setError('未找到匹配結果');
        setIsVideoLoading(false);
        return;
      }
      const newDetail = sanitizePlaybackResult(rawNewDetail);
      if (!newDetail.episodes.length) {
        setIsVideoLoading(false);
        setError('此片源沒有可播放的 m3u8 地址，請切換其他片源。');
        return;
      }

      // 嘗試跳轉到當前正在播放的集數
      let targetIndex = currentEpisodeIndex;

      // 集數越界時夾取：大於新源最大集數則跳轉最後一集，負數則回到第一集
      if (!newDetail.episodes || newDetail.episodes.length === 0) {
        targetIndex = 0;
      } else if (targetIndex >= newDetail.episodes.length) {
        targetIndex = newDetail.episodes.length - 1;
      } else if (targetIndex < 0) {
        targetIndex = 0;
      }

      // 如果仍然是同一集數且播放進度有效，則在播放器就緒後恢復到原始進度
      if (targetIndex !== currentEpisodeIndex) {
        resumeTimeRef.current = 0;
      } else if (
        (!resumeTimeRef.current || resumeTimeRef.current === 0) &&
        currentPlayTime > 1
      ) {
        resumeTimeRef.current = currentPlayTime;
      }

      // 更新URL參數（不刷新頁面）
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('source', newSource);
      newUrl.searchParams.set('id', newId);
      newUrl.searchParams.set('year', newDetail.year);
      window.history.replaceState({}, '', newUrl.toString());

      setError(null);
      setVideoTitle(newDetail.title || newTitle);
      setVideoYear(newDetail.year);
      setVideoCover(newDetail.poster);
      setVideoDoubanId(newDetail.douban_id || 0);
      setCurrentSource(newSource);
      setCurrentId(newId);
      setDetail(newDetail);
      setCurrentEpisodeIndex(targetIndex);

      // 設置一個短暫的延時，確保DOM已更新
      setTimeout(() => {
        setIsVideoLoading(false);
      }, 100);
    } catch (err) {
      // 隱藏換源加載狀態
      setIsVideoLoading(false);
      setError(err instanceof Error ? err.message : '換源失敗');
    }
  };

  // 讓 HLS 錯誤回調始終能拿到最新的 handleSourceChange
  // （播放器只在創建時注冊一次錯誤回調，直接引用會拿到過期閉包）
  useEffect(() => {
    handleSourceChangeRef.current = handleSourceChange;
  });

  /**
   * 當前源被判定為"不可自動恢復"後，自動切到下一個候選源（P1-5）。
   *
   * 候選來自已搜索到的全部源（`availableSources`，已按優選評分排序），
   * 依次排除：本集已試過的、沒有劇集列表的、集數短於當前集數的
   * （切過去只能回到第一集，體驗反而更差）。
   *
   * 只讀 ref，因此可以被注冊在任意時刻的回調安全調用。
   */
  const autoSwitchSource = (reason: string) => {
    const currentKey = `${currentSourceRef.current}:${currentIdRef.current}`;
    triedSourcesRef.current.add(currentKey);

    if (autoSwitchCountRef.current >= MAX_AUTO_SOURCE_SWITCHES) {
      setError(
        `播放失敗：${reason}。已自動嘗試 ${autoSwitchCountRef.current} 個片源仍未成功，請手動切換片源`
      );
      return;
    }

    const episodeIndex = currentEpisodeIndexRef.current;
    const candidate = availableSourcesRef.current.find((item) => {
      const key = `${item.source}:${item.id}`;
      if (triedSourcesRef.current.has(key)) return false;
      if (!item.episodes || item.episodes.length === 0) return false;
      return isDirectM3U8Url(item.episodes[episodeIndex]);
    });

    if (!candidate) {
      setError(`播放失敗：${reason}。已無可用備用片源，請手動選擇`);
      return;
    }

    autoSwitchCountRef.current += 1;
    triedSourcesRef.current.add(`${candidate.source}:${candidate.id}`);

    const notice = `播放失敗，已自動切換到「${candidate.source}」`;
    console.warn(
      `[auto-switch] ${reason} → ${candidate.source}:${candidate.id}`
    );
    try {
      if (artPlayerRef.current) {
        artPlayerRef.current.notice.show = notice;
      }
    } catch {
      // ArtPlayer 可能已銷毀
    }

    void handleSourceChangeRef.current?.(
      candidate.source,
      candidate.id,
      candidate.title || '',
      { auto: true }
    );
  };

  useEffect(() => {
    document.addEventListener('keydown', handleKeyboardShortcuts);
    return () => {
      document.removeEventListener('keydown', handleKeyboardShortcuts);
    };
  }, []);

  // 處理集數切換
  const handleEpisodeChange = async (episodeNumber: number) => {
    if (episodeNumber === currentEpisodeIndexRef.current) return;
    if (episodeNumber >= 0 && episodeNumber < totalEpisodes) {
      setSelectedState(false);
      isEpisodeSwitchingRef.current = true;
      hideDanmakuDuringEpisodeSwitch();
      // 在更換集數前保存當前播放進度
      if (artPlayerRef.current && artPlayerRef.current.paused) {
        saveCurrentPlayProgress();
      }
      if (artPlayerRef.current) {
        setCurrentTooltip('');
      }
      // 檢查是否有歷史播放記錄
      try {
        const allRecords = await getAllPlayRecords();
        const key = generateStorageKey(
          currentSourceRef.current,
          currentIdRef.current
        );
        const record = allRecords[key];
        if (
          record &&
          record.index - 1 === episodeNumber &&
          record.play_time > 0
        ) {
          resumeTimeRef.current = record.play_time;
        } else {
          resumeTimeRef.current = 0;
        }
      } catch {
        resumeTimeRef.current = 0;
      }
      setCurrentEpisodeIndex(episodeNumber);
    }
  };

  const handlePreviousEpisode = () => {
    const d = detailRef.current;
    const idx = currentEpisodeIndexRef.current;
    if (d && d.episodes && idx > 0) {
      setSelectedState(false);
      isEpisodeSwitchingRef.current = true;
      hideDanmakuDuringEpisodeSwitch();
      if (artPlayerRef.current && !artPlayerRef.current.paused) {
        saveCurrentPlayProgress();
      }
      if (artPlayerRef.current) {
        setCurrentTooltip('');
      }
      setCurrentEpisodeIndex(idx - 1);
    }
  };

  const handleNextEpisode = () => {
    const d = detailRef.current;
    const idx = currentEpisodeIndexRef.current;
    if (d && d.episodes && idx < d.episodes.length - 1) {
      setSelectedState(false);
      isEpisodeSwitchingRef.current = true;
      hideDanmakuDuringEpisodeSwitch();
      if (artPlayerRef.current && !artPlayerRef.current.paused) {
        saveCurrentPlayProgress();
      }
      if (artPlayerRef.current) {
        setCurrentTooltip('');
      }
      setCurrentEpisodeIndex(idx + 1);
    }
  };

  // -----------------------------------------------------------------------------
  // 鍵盤快捷鍵
  // -----------------------------------------------------------------------------

  // 處理全局快捷鍵
  const handleKeyboardShortcuts = (e: KeyboardEvent) => {
    // 忽略輸入框中的按鍵事件
    if (
      (e.target as HTMLElement).tagName === 'INPUT' ||
      (e.target as HTMLElement).tagName === 'TEXTAREA'
    )
      return;

    // Alt + 左箭頭 = 上一集
    if (e.altKey && e.key === 'ArrowLeft') {
      if (detailRef.current && currentEpisodeIndexRef.current > 0) {
        handlePreviousEpisode();
        e.preventDefault();
      }
    }

    // Alt + 右箭頭 = 下一集
    if (e.altKey && e.key === 'ArrowRight') {
      const d = detailRef.current;
      const idx = currentEpisodeIndexRef.current;
      if (d && idx < d.episodes.length - 1) {
        handleNextEpisode();
        e.preventDefault();
      }
    }

    // 左箭頭 = 快退
    if (!e.altKey && e.key === 'ArrowLeft') {
      if (artPlayerRef.current && artPlayerRef.current.currentTime > 5) {
        artPlayerRef.current.currentTime -= 10;
        e.preventDefault();
      }
    }

    // 右箭頭 = 快進
    if (!e.altKey && e.key === 'ArrowRight') {
      if (
        artPlayerRef.current &&
        artPlayerRef.current.currentTime < artPlayerRef.current.duration - 5
      ) {
        artPlayerRef.current.currentTime += 10;
        e.preventDefault();
      }
    }

    // 上箭頭 = 音量+
    if (e.key === 'ArrowUp') {
      if (artPlayerRef.current && artPlayerRef.current.volume < 1) {
        artPlayerRef.current.volume =
          Math.round((artPlayerRef.current.volume + 0.1) * 10) / 10;
        artPlayerRef.current.notice.show = `音量: ${Math.round(
          artPlayerRef.current.volume * 100
        )}`;
        e.preventDefault();
      }
    }

    // 下箭頭 = 音量-
    if (e.key === 'ArrowDown') {
      if (artPlayerRef.current && artPlayerRef.current.volume > 0) {
        artPlayerRef.current.volume =
          Math.round((artPlayerRef.current.volume - 0.1) * 10) / 10;
        artPlayerRef.current.notice.show = `音量: ${Math.round(
          artPlayerRef.current.volume * 100
        )}`;
        e.preventDefault();
      }
    }

    // 空格 = 播放/暫停
    if (e.key === ' ') {
      if (artPlayerRef.current) {
        artPlayerRef.current.toggle();
        e.preventDefault();
      }
    }

    // f 鍵 = 切換全屏
    if (e.key === 'f' || e.key === 'F') {
      if (artPlayerRef.current) {
        artPlayerRef.current.fullscreen = !artPlayerRef.current.fullscreen;
        e.preventDefault();
      }
    }
  };

  // -----------------------------------------------------------------------------
  // 播放進度保存
  // -----------------------------------------------------------------------------

  // 保存播放進度
  const saveCurrentPlayProgress = async () => {
    if (
      !artPlayerRef.current ||
      !currentSourceRef.current ||
      !currentIdRef.current ||
      !videoTitleRef.current ||
      !detailRef.current?.source_name
    ) {
      return;
    }

    const player = artPlayerRef.current;
    const currentTime = player.currentTime || 0;
    const duration = player.duration || 0;

    // 如果播放時間太短（少於5秒）或者視頻時長無效，不保存
    if (currentTime < 1 || !duration) {
      return;
    }

    try {
      await savePlayRecord(currentSourceRef.current, currentIdRef.current, {
        title: videoTitleRef.current,
        source_name: detailRef.current?.source_name || '',
        year: detailRef.current?.year,
        cover: detailRef.current?.poster || '',
        index: currentEpisodeIndexRef.current + 1, // 轉換為1基索引
        total_episodes: detailRef.current?.episodes.length || 1,
        play_time: Math.floor(currentTime),
        total_time: Math.floor(duration),
        save_time: Date.now(),
        search_title: searchTitle,
      });

      lastSaveTimeRef.current = Date.now();
      console.log('播放進度已保存:', {
        title: videoTitleRef.current,
        episode: currentEpisodeIndexRef.current + 1,
        year: detailRef.current?.year,
        progress: `${Math.floor(currentTime)}/${Math.floor(duration)}`,
      });
    } catch (err) {
      console.error('保存播放進度失敗:', err);
    }
  };

  useEffect(() => {
    // 頁面即將卸載時保存播放進度和清理資源
    const handleBeforeUnload = () => {
      saveCurrentPlayProgress();
      releaseWakeLock();
      cleanupPlayer();
    };

    // 頁面可見性變化時保存播放進度和釋放 Wake Lock
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        saveCurrentPlayProgress();
        releaseWakeLock();
      } else if (document.visibilityState === 'visible') {
        // 頁面重新可見時，如果正在播放則重新請求 Wake Lock
        if (artPlayerRef.current && !artPlayerRef.current.paused) {
          requestWakeLock();
        }
      }
    };

    // 添加事件監聽器
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      // 清理事件監聽器
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [currentEpisodeIndex, detail, artPlayerRef.current]);

  // 清理定時器
  useEffect(() => {
    return () => {
      if (saveIntervalRef.current) {
        clearInterval(saveIntervalRef.current);
      }
    };
  }, []);

  // -----------------------------------------------------------------------------
  // 收藏與追更
  // -----------------------------------------------------------------------------

  const { favorited, following, handleToggleFavorite, handleToggleFollowing } =
    useVideoActions({
      source: currentSource,
      id: currentId,
      sourceRef: currentSourceRef,
      idRef: currentIdRef,
      titleRef: videoTitleRef,
      detailRef: detailRef,
      episodeIndexRef: currentEpisodeIndexRef,
      searchTitle,
    });

  // -----------------------------------------------------------------------------
  // 動態加載播放器庫
  // -----------------------------------------------------------------------------

  const artLibRef = useRef<any>(null);
  const hlsLibRef = useRef<any>(null);
  const danmukuPluginRef = useRef<any>(null);
  const [libsReady, setLibsReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [
          { default: Art },
          { default: Hls },
          { default: artplayerPluginDanmuku },
        ] = await Promise.all([
          import('artplayer'),
          import('hls.js'),
          import('artplayer-plugin-danmuku'),
        ]);
        if (!mounted) return;
        artLibRef.current = Art;
        hlsLibRef.current = Hls;
        danmukuPluginRef.current = wrapArtplayerPluginDanmuku(
          artplayerPluginDanmuku
        );
        setLibsReady(true);
      } catch (err) {
        console.error('加載播放器庫失敗:', err);
        setLibsReady(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // -----------------------------------------------------------------------------
  // ArtPlayer 生命周期
  // -----------------------------------------------------------------------------

  useEffect(() => {
    const Artplayer = artLibRef.current;
    const Hls = hlsLibRef.current;

    // 選集索引越界時夾取：傳入的起始集數大於當前播放源最大集數時播放最後一集，
    // 負數則回到第一集。需在就緒/視頻地址判斷之前修正，避免越界集數導致無法生成視頻地址。
    if (
      detail &&
      detail.episodes &&
      detail.episodes.length > 0 &&
      currentEpisodeIndex !== null &&
      (currentEpisodeIndex < 0 || currentEpisodeIndex >= detail.episodes.length)
    ) {
      setCurrentEpisodeIndex(
        currentEpisodeIndex < 0 ? 0 : detail.episodes.length - 1
      );
      return;
    }

    if (
      !libsReady ||
      !Artplayer ||
      !Hls ||
      !videoUrl ||
      loading ||
      currentEpisodeIndex === null ||
      !artRef.current
    ) {
      return;
    }

    // 確保選集索引有效（僅在劇集列表為空等異常時觸發）
    if (
      !detail ||
      !detail.episodes ||
      detail.episodes.length === 0 ||
      currentEpisodeIndex >= detail.episodes.length ||
      currentEpisodeIndex < 0
    ) {
      setError(`選集索引無效，當前共 ${totalEpisodes} 集`);
      return;
    }

    if (!videoUrl) {
      setError('視頻地址無效');
      return;
    }
    if (!isDirectM3U8Url(videoUrl)) {
      setError('播放地址不是有效的 m3u8，請切換其他片源。');
      setIsVideoLoading(false);
      return;
    }
    const playbackUrl = getPlaybackUrl(videoUrl, blockAdEnabledRef.current);

    // 檢測是否為WebKit瀏覽器
    const isWebkit =
      typeof window !== 'undefined' &&
      typeof (window as any).webkitConvertPointFromNodeToPage === 'function';

    // 切集時無論瀏覽器類型都優先復用實例，避免銷毀播放器
    if (artPlayerRef.current && isEpisodeSwitchingRef.current) {
      artPlayerRef.current.switch = playbackUrl;
      artPlayerRef.current.title = `${videoTitle} - 第${
        currentEpisodeIndex + 1
      }集`;
      artPlayerRef.current.poster = processImageUrl(videoCover);
      if (artPlayerRef.current?.video) {
        ensureVideoSource(
          artPlayerRef.current.video as HTMLVideoElement,
          playbackUrl
        );
      }
      isEpisodeSwitchingRef.current = false;
      return;
    }

    // 非WebKit瀏覽器且播放器已存在，使用switch方法切換
    if (!isWebkit && artPlayerRef.current) {
      artPlayerRef.current.switch = playbackUrl;
      artPlayerRef.current.title = `${videoTitle} - 第${
        currentEpisodeIndex + 1
      }集`;
      artPlayerRef.current.poster = processImageUrl(videoCover);
      if (artPlayerRef.current?.video) {
        ensureVideoSource(
          artPlayerRef.current.video as HTMLVideoElement,
          playbackUrl
        );
      }
      return;
    }

    // WebKit瀏覽器或首次創建：銷毀之前的播放器實例並創建新的
    if (artPlayerRef.current) {
      cleanupPlayer();
    }

    try {
      // 創建新的播放器實例
      Artplayer.PLAYBACK_RATE = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
      Artplayer.USE_RAF = true;

      // 在這裡定義自定義 Loader，確保 Hls 已就緒。
      // blockAd 反映當前開關（切換時會重建播放器），useProxy 需與預取器保持一致。
      const CustomHlsJsLoader = createCustomHlsLoader(Hls, {
        blockAd: blockAdEnabledRef.current,
        useProxy: loadCacheSettings().useProxy,
        onAdFilter: ({ removedSegments, removedSeconds, preservedReason }) => {
          const message =
            preservedReason === 'multiple-renditions'
              ? '多畫質／多音軌時間軸未確認，保留原片'
              : removedSegments > 0
              ? `已移除 ${removedSegments} 段廣告（${removedSeconds.toFixed(
                  1
                )} 秒）`
              : '未切除影片片段，未確認內容保留';
          setSettingTooltip(artPlayerRef.current, AD_SETTING_NAME, message);
        },
      });

      /**
       * 刷新「視頻緩存」設置項的進度提示。
       *
       * ⚠️ 這裡必須走 DOM setter，不能用 `setting.update()`：
       * 本函數由預取回調按**分片頻率**調用（一集幾百次），而 `update()`
       * 內部會無條件 `render()` 把設置面板彈回根面板，導致用戶剛點進
       * 「畫質」子面板就被踢出來，需要連點很多次。詳見 `artplayer-setting.ts`。
       */
      let lastCacheTooltip = '';
      const updateCacheTooltip = (text: string, switchState?: boolean) => {
        const art = artPlayerRef.current;
        if (!art) return;
        if (text !== lastCacheTooltip) {
          setSettingTooltip(art, CACHE_SETTING_NAME, text);
          lastCacheTooltip = text;
        }
        if (switchState !== undefined) {
          setSettingSwitch(art, CACHE_SETTING_NAME, switchState);
        }
      };

      let cacheBandwidthThrottled = false;
      let lastBufferCheckAt = 0;
      const setCacheBandwidthThrottled = (value: boolean) => {
        cacheBandwidthThrottled = value;
        prefetcherRef.current.setThrottled(value);
        getNextEpisodePrefetcher().setThrottled(value);
      };
      const syncCacheBandwidth = (force = false) => {
        const video = artPlayerRef.current?.video;
        if (!video) return;
        const now = Date.now();
        if (!force && now - lastBufferCheckAt < 1_000) return;
        lastBufferCheckAt = now;
        setCacheBandwidthThrottled(
          shouldThrottlePrefetch(video, cacheBandwidthThrottled)
        );
      };

      /**
       * 啟動 / 續跑前向預緩存。
       * ensure 是冪等的：窗口仍然夠用時直接返回，可以放心高頻調用。
       *
       * `preferredHeight` 必須一起傳：多碼率源裡預取器默認取最高帶寬，
       * 用戶把畫質切到低檔後緩存鍵就對不上了（P1-6 與緩存的耦合點）。
       *
       * `episodeKey` 從 ref 實時取——播放器可能跨集復用，閉包裡的集數會過期。
       */
      const ensurePrefetch = (
        m3u8Url: string,
        currentTime: number,
        horizonSeconds?: number
      ) => {
        if (artPlayerRef.current?.video?.seeking) return;
        const clearing = cacheClearPromiseRef.current;
        if (clearing) {
          const episodeIndex = currentEpisodeIndexRef.current;
          void clearing.then(() => {
            if (
              episodeIndex === currentEpisodeIndexRef.current &&
              m3u8Url === currentVideoUrlRef.current &&
              artPlayerRef.current
            ) {
              ensurePrefetch(m3u8Url, currentTime, horizonSeconds);
            }
          });
          return;
        }
        prefetcherRef.current.ensure({
          m3u8Url,
          currentTime,
          blockAd: blockAdEnabledRef.current,
          lookBehindSeconds: 0,
          skipIntroSeconds: skipConfigRef.current.enable
            ? Math.max(0, skipConfigRef.current.intro_time)
            : 0,
          skipOutroSeconds: skipConfigRef.current.enable
            ? Math.max(0, -skipConfigRef.current.outro_time)
            : 0,
          title: videoTitleRef.current || '未知影片',
          source:
            detailRef.current?.source_name ||
            currentSourceRef.current ||
            '未知來源',
          episodeKey: `${currentSourceRef.current}:${currentIdRef.current}:${currentEpisodeIndexRef.current}`,
          preferredHeight: preferredHeightRef.current,
          ...(horizonSeconds === undefined ? {} : { horizonSeconds }),
          onProgress: (stats) => {
            const probe = getSegmentProbe();
            const probed = probe.hits + probe.misses;
            updateCacheTooltip(
              buildCacheTooltip(stats, probed > 0 ? probe.hitRate : null)
            );

            // 當前集的前向視野已經鋪滿 → 順手把下一集的前幾分鐘也預熱掉，
            // 這樣用戶點"下一集"時首屏基本是命中緩存而不是現拉網絡。
            if (stats.state === 'done') warmupNextEpisode();
          },
        });
        syncCacheBandwidth(true);
      };

      /**
       * 預熱下一集（落地路線第 3 步）。
       *
       * 走獨立的預取器實例，因此**不會**打斷當前集的隊列。
       * 只在當前集隊列跑到 `done` 時觸發一次（由 `nextWarmupKeyRef` 去重），
       * 並且隨集數/畫質變化自動失效。
       */
      const warmupNextEpisode = () => {
        if (cacheClearPromiseRef.current) return;
        if (!loadCacheSettings().enabled) return;

        const data = detailRef.current;
        const episodes = data?.episodes;
        if (!episodes || episodes.length === 0) return;

        const nextIndex = currentEpisodeIndexRef.current + 1;
        if (nextIndex >= episodes.length) return;

        const nextUrl = episodes[nextIndex];
        if (!nextUrl) return;

        const preferred = preferredHeightRef.current;
        // 畫質檔位也是預熱鍵的一部分：換了檔位，預熱過的分片 URL 就不同了
        const skip = skipConfigRef.current;
        const skipIntroSeconds = skip.enable ? Math.max(0, skip.intro_time) : 0;
        const skipOutroSeconds = skip.enable
          ? Math.max(0, -skip.outro_time)
          : 0;
        const key = `${currentSourceRef.current}:${
          currentIdRef.current
        }:${nextIndex}:${
          preferred ?? 'auto'
        }:${skipIntroSeconds}:${skipOutroSeconds}`;
        if (nextWarmupKeyRef.current === key) return;
        nextWarmupKeyRef.current = key;

        getNextEpisodePrefetcher().ensure({
          m3u8Url: nextUrl,
          blockAd: blockAdEnabledRef.current,
          currentTime: 0,
          skipIntroSeconds,
          skipOutroSeconds,
          title: videoTitleRef.current || '未知影片',
          source:
            detailRef.current?.source_name ||
            currentSourceRef.current ||
            '未知來源',
          episodeKey: `${currentSourceRef.current}:${currentIdRef.current}:${nextIndex}`,
          preferredHeight: preferred,
          horizonSeconds: NEXT_EPISODE_HORIZON_SECONDS,
          useProxy: loadCacheSettings().useProxy,
          concurrency: 1,
        });
        syncCacheBandwidth(true);
      };

      /**
       * 供播放器事件監聽器使用的入口。
       *
       * 監聽器閉包裡的 `videoUrl` 是創建播放器那一刻的快照，切集後已過期，
       * 因此以 ref 裡的實時地址為准。
       */
      const ensurePrefetchCurrent = (
        currentTime: number,
        horizonSeconds?: number
      ) => {
        const live = currentVideoUrlRef.current;
        if (!live) return;
        ensurePrefetch(live, currentTime, horizonSeconds);
      };

      const cacheModeLabels = {
        low: '低檔',
        medium: '中檔',
        high: '高檔',
        custom: '自定義',
      };
      const restartCacheQueue = () => {
        prefetcherRef.current.stop();
        getNextEpisodePrefetcher().stop();
        nextWarmupKeyRef.current = null;
        if (loadCacheSettings().enabled) {
          ensurePrefetchCurrent(artPlayerRef.current?.currentTime || 0);
        }
      };
      restartPrefetchForSkipRef.current = () => {
        prefetcherRef.current.stop(true);
        getNextEpisodePrefetcher().stop();
        nextWarmupKeyRef.current = null;
        if (loadCacheSettings().enabled) {
          ensurePrefetchCurrent(artPlayerRef.current?.currentTime || 0);
        }
      };

      /** 刷新「畫質」設置項的 tooltip（同樣走 DOM setter，不打斷面板層級） */
      const updateQualityTooltip = (text: string) => {
        const art = artPlayerRef.current;
        if (!art) return;
        setSettingTooltip(art, QUALITY_SETTING_NAME, text);
      };

      /**
       * 把 hls.js 的碼率檔位同步到「畫質」設置項（P1-6）。
       *
       * 必須等 MANIFEST_PARSED：在那之前 `hls.levels` 是空的。
       * 同時把本地記住的檔位重新應用，使換集/換源後用戶的選擇得以延續。
       *
       * 這裡是少數**必須**調用 `setting.update()` 的地方（要替換 selector 數組），
       * 所以用 `updateSettingPreservingPanel` 把面板層級恢復回來，避免順手
       * 把正在看子面板的用戶彈回根面板。
       */
      const syncQualitySetting = (hls: any) => {
        const levels = Array.isArray(hls.levels) ? hls.levels : [];
        const preferred = preferredHeightRef.current;
        const matchedIndex =
          preferred === null ? AUTO_LEVEL : pickLevelIndex(levels, preferred);

        const art = artPlayerRef.current;
        if (art) {
          updateSettingPreservingPanel(art, {
            name: QUALITY_SETTING_NAME,
            tooltip: describeQualityPreference(levels, preferred),
            selector: buildQualityOptions(levels, preferred),
          });
        }

        // 記住的檔位在本次播放列表裡存在時直接套用，否則交給 ABR 自動選擇
        if (matchedIndex >= 0) {
          try {
            hls.currentLevel = matchedIndex;
          } catch (_) {
            // 忽略：極端情況下 levels 正在重建
          }
        }
      };

      artPlayerRef.current = new Artplayer({
        container: artRef.current,
        url: playbackUrl,
        type: 'm3u8',
        poster: videoCover,
        volume: 0.7,
        isLive: false,
        muted: false,
        autoplay: true,
        pip: true,
        autoSize: false,
        autoMini: false,
        screenshot: true,
        setting: true,
        loop: false,
        flip: false,
        playbackRate: true,
        aspectRatio: false,
        fullscreen: true,
        fullscreenWeb: true,
        subtitleOffset: false,
        miniProgressBar: true,
        mutex: true,
        playsInline: true,
        autoPlayback: false,
        airplay: true,
        theme: '#22c55e',
        lang: 'zh-tw',
        hotkey: false,
        fastForward: true,
        autoOrientation: true,
        lock: true,
        moreVideoAttr: {
          crossOrigin: 'anonymous',
        },
        plugins: [danmukuPluginRef.current(danmakuConfigRef.current)],
        // HLS 支持配置
        customType: {
          m3u8: function (video: HTMLVideoElement, url: string) {
            if (!Hls) {
              console.error('HLS.js 未加載');
              return;
            }

            if (video.hls) {
              video.hls.destroy();
            }
            if (!Hls.isSupported()) {
              if (video.canPlayType('application/vnd.apple.mpegurl')) {
                video.src = url;
                ensureVideoSource(video, url);
                if (blockAdEnabledRef.current)
                  setTimeout(
                    () =>
                      setSettingTooltip(
                        artPlayerRef.current,
                        AD_SETTING_NAME,
                        '已啟用；原生 HLS 未回報移除統計'
                      ),
                    0
                  );
              } else {
                setError('此瀏覽器不支援 HLS 播放');
                setIsVideoLoading(false);
              }
              return;
            }
            const hls = new Hls({
              debug: false, // 關閉日志
              // 分片處理移到 Worker；自定義 loader 仍在主線程讀取緩存。
              enableWorker: true,

              // VOD 場景關閉低延遲模式：LL-HLS 會主動壓縮前向緩沖，與"多緩存"目標相悖
              lowLatencyMode: false,

              /* 緩沖/內存相關 */
              // 真正的"緩存後面的"由 VideoPrefetcher 寫入 Cache Storage 承擔，
              // 這裡只需一個適度的內存緩沖，避免移動端內存壓力。
              // 弱網優化：緩沖拉長到 2 分鐘，網絡抖動時不容易轉圈；
              // 實際內存佔用仍由 maxBufferSize（90MB）兜底。
              maxBufferLength: 120, // 前向緩沖目標 120s
              maxMaxBufferLength: 600, // 前向緩沖硬上限 600s
              backBufferLength: 30, // 僅保留 30s 已播放內容，避免內存佔用
              maxBufferSize: 90 * 1000 * 1000, // 約 90MB，超出後觸發清理

              /* 自定義 loader：去廣告 + 緩存優先 */
              loader: CustomHlsJsLoader,
            });

            hls.loadSource(url);
            hls.attachMedia(video);
            video.hls = hls;

            ensureVideoSource(video, url);

            // 啟動前向預緩存。注意：這裡只讀取一次當前時間用於計算窗口起點，
            // 之後的預取循環不會再讀取任何播放狀態，因此暫停後仍會繼續緩存。
            ensurePrefetch(currentVideoUrlRef.current, video.currentTime || 0);

            // ---- P1-5：帶指數退避 + 重試上限 + 自動換源的錯誤恢復 ----
            // 每個 HLS 實例配一個狀態機；換源/重建時舊實例在 cleanupPlayer 裡銷毀。
            const recovery = new PlaybackRecovery();
            recoveryRef.current?.dispose();
            recoveryRef.current = recovery;

            // 新實例 = 新的 ABR 環境：清掉上一集的卡頓記錄與降檔上限，
            // 否則換源後 ABR 會被上一個源的網絡狀況壓著
            stallTimesRef.current = [];
            downshiftNoticeRef.current = null;

            // 播放列表解析成功：建立畫質檔位，並確認鏈路可用
            hls.on(Hls.Events.MANIFEST_PARSED, function () {
              recovery.markHealthy();
              syncQualitySetting(hls);
            });

            hls.on(
              Hls.Events.LEVEL_SWITCHED,
              function (_event: any, data: any) {
                const level = hls.levels?.[data?.level];
                updateQualityTooltip(
                  hls.autoLevelEnabled
                    ? `自動${level ? ` · ${describeLevel(level)}` : ''}`
                    : describeLevel(level)
                );

                // 暫停狀態下切換檔位時，瀏覽器不會自動重繪新解碼的幀，
                // 畫面會停在舊檔位，用戶容易誤判成"切了沒反應"。
                // 用一次 10ms 的微 seek 強制刷新——偏移落在同一分片內，
                // 不會觸發重新加載。
                const media = artPlayerRef.current?.video;
                if (media?.paused && media.currentTime > 0.05) {
                  try {
                    media.currentTime = media.currentTime - 0.01;
                  } catch {
                    // 忽略：極端情況下媒體尚未就緒
                  }
                }
              }
            );

            // 分片加載成功（含命中本項目的片段緩存）即視為鏈路仍在推進
            hls.on(Hls.Events.FRAG_LOADED, function () {
              recovery.markHealthy();
            });

            hls.on(Hls.Events.ERROR, function (event: any, data: any) {
              if (!data?.fatal) {
                // 非致命錯誤 hls.js 會自行重試，這裡只留痕便於排障
                console.warn(
                  'HLS 非致命錯誤:',
                  describeHlsError(data?.type, data?.details),
                  data?.details
                );
                return;
              }

              const decision = recovery.onFatal(data.type, data.details);
              switch (decision.action) {
                case 'retry': {
                  // 指數退避，避免源站掛掉時形成重試風暴
                  console.log(
                    `HLS 網絡錯誤（${decision.reason}），${decision.delayMs}ms 後第 ${decision.attempt} 次重試`
                  );
                  recovery.schedule(decision.delayMs, () => hls.startLoad());
                  break;
                }
                case 'recover-media': {
                  console.log(
                    `HLS 媒體錯誤（${decision.reason}），第 ${decision.attempt} 次恢復`
                  );
                  if (decision.swapAudio) {
                    hls.swapAudioCodec();
                  }
                  hls.recoverMediaError();
                  break;
                }
                case 'switch-source': {
                  console.error('HLS 錯誤無法恢復，准備換源:', decision.reason);
                  recovery.dispose();
                  hls.destroy();
                  autoSwitchSource(decision.reason);
                  break;
                }
                default:
                  break;
              }
            });
          },
        },
        icons: {
          loading:
            '<img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI1MCIgaGVpZ2h0PSI1MCIgdmlld0JveD0iMCAwIDUwIDUwIj48cGF0aCBkPSJNMjUuMjUxIDYuNDYxYy0xMC4zMTggMC0xOC42ODMgOC4zNjUtMTguNjgzIDE4LjY4M2g0LjA2OGMwLTguMDcgNi41NDUtMTQuNjE1IDE0LjYxNS0xNC42MTVWNi40NjF6IiBmaWxsPSIjMDA5Njg4Ij48YW5pbWF0ZVRyYW5zZm9ybSBhdHRyaWJ1dGVOYW1lPSJ0cmFuc2Zvcm0iIGF0dHJpYnV0ZVR5cGU9IlhNTCIgZHVyPSIxcyIgZnJvbT0iMCAyNSAyNSIgcmVwZWF0Q291bnQ9ImluZGVmaW5pdGUiIHRvPSIzNjAgMjUgMjUiIHR5cGU9InJvdGF0ZSIvPjwvcGF0aD48L3N2Zz4=">',
        },
        settings: [
          {
            name: AD_SETTING_NAME,
            html: '去廣告',
            icon: '<text x="50%" y="50%" font-size="20" font-weight="bold" text-anchor="middle" dominant-baseline="middle" fill="#ffffff">AD</text>',
            tooltip: blockAdEnabled ? '已啟用，等待檢查' : '已關閉',
            onClick() {
              const newVal = !blockAdEnabledRef.current;
              try {
                localStorage.setItem('enable_blockad', String(newVal));
              } catch {
                // A blocked preference store must not prevent the switch itself.
              }
              if (artPlayerRef.current) {
                resumeTimeRef.current = artPlayerRef.current.currentTime;
                cleanupPlayer();
              }
              prefetcherRef.current.stop();
              getNextEpisodePrefetcher().stop();
              nextWarmupKeyRef.current = null;
              blockAdEnabledRef.current = newVal;
              setBlockAdEnabled(newVal);
              setIsDanmakuPluginReady(false);
              setIsBlockAdChanged(true);
              return newVal ? '當前開啟' : '當前關閉';
            },
          },
          {
            name: '跳過片頭片尾',
            html: '跳過片頭片尾',
            switch: skipConfigRef.current.enable,
            onSwitch: function (item: any) {
              const newConfig = {
                ...skipConfigRef.current,
                enable: !item.switch,
              };
              handleSkipConfigChange(newConfig);
              return !item.switch;
            },
          },
          {
            html: '刪除跳過配置',
            onClick: function () {
              handleSkipConfigChange({
                enable: false,
                intro_time: 0,
                outro_time: 0,
              });
              return '';
            },
          },
          {
            name: '設置片頭',
            html: '設置片頭',
            icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="12" r="2" fill="#ffffff"/><path d="M9 12L17 12" stroke="#ffffff" stroke-width="2"/><path d="M17 6L17 18" stroke="#ffffff" stroke-width="2"/></svg>',
            tooltip:
              skipConfigRef.current.intro_time === 0
                ? '設置片頭時間'
                : `${formatTime(skipConfigRef.current.intro_time)}`,
            onClick: function () {
              const currentTime = artPlayerRef.current?.currentTime || 0;
              if (currentTime > 0) {
                const newConfig = {
                  ...skipConfigRef.current,
                  intro_time: currentTime,
                };
                handleSkipConfigChange(newConfig);
                return `${formatTime(currentTime)}`;
              }
            },
          },
          {
            name: '設置片尾',
            html: '設置片尾',
            icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 6L7 18" stroke="#ffffff" stroke-width="2"/><path d="M7 12L15 12" stroke="#ffffff" stroke-width="2"/><circle cx="19" cy="12" r="2" fill="#ffffff"/></svg>',
            tooltip:
              skipConfigRef.current.outro_time >= 0
                ? '設置片尾時間'
                : `-${formatTime(-skipConfigRef.current.outro_time)}`,
            onClick: function () {
              const outroTime =
                -(
                  artPlayerRef.current?.duration -
                  artPlayerRef.current?.currentTime
                ) || 0;
              if (outroTime < 0) {
                const newConfig = {
                  ...skipConfigRef.current,
                  outro_time: outroTime,
                };
                handleSkipConfigChange(newConfig);
                return `-${formatTime(-outroTime)}`;
              }
            },
          },
          {
            name: '彈幕源',
            html: '彈幕源',
            tooltip: currentTooltip || '未選擇',
            onClick: function () {
              setShowDanmakuSelector(true);
            },
          },
          {
            // 畫質切換（P1-6）。檔位列表在 MANIFEST_PARSED 後由
            // syncQualitySetting() 動態寫入，這裡先給個佔位。
            // 佔位用 `selector`（而不是 onClick）是刻意為之：ArtPlayer 只有
            // 在 item 帶 selector 時才會渲染成可展開的子面板。
            name: QUALITY_SETTING_NAME,
            html: QUALITY_SETTING_NAME,
            tooltip: '自動',
            selector: [{ html: '自動', value: AUTO_LEVEL, default: true }],
            onSelect: function (item: any) {
              const value = Number(item.value);
              const hls = artPlayerRef.current?.video?.hls;
              const levels: any[] = Array.isArray(hls?.levels)
                ? hls.levels
                : [];

              const isAuto = value === AUTO_LEVEL || Number.isNaN(value);
              const isMax = value === MAX_LEVEL;

              let nextLevel = AUTO_LEVEL;
              let preferred: number | null = null;

              if (isMax) {
                // 「最高畫質」落到本視頻實際存在的最高檔。
                // 記憶用 MAX_QUALITY_HEIGHT(8K) 作哨兵：換到沒有 8K 的劇集時，
                // pickLevelIndex 會落到該劇最高檔，語義自動成立。
                const highest = pickHighestLevelIndex(levels);
                if (highest >= 0) {
                  nextLevel = highest;
                  preferred = MAX_QUALITY_HEIGHT;
                }
              } else if (!isAuto && levels[value]) {
                nextLevel = value;
                // 記的是「有效高度」：源站 master 常缺 RESOLUTION，
                // 那時只能按碼率推斷。用 `level.height` 會讓偏好退化成
                // "自動"，連帶把預取檔位與跨集記憶一起弄丟。
                preferred = resolveLevelHeight(levels[value]) || null;
              }

              try {
                if (hls) {
                  hls.currentLevel = nextLevel;
                  // 用戶手動選了檔位 = 明確表達意願，清掉自動降檔的上限，
                  // 否則 ABR 會被之前的卡頓記錄一直壓著達不到所選檔位
                  hls.autoLevelCapping = -1;
                }
              } catch {
                // 忽略：極端情況下 levels 正在重建
              }
              stallTimesRef.current = [];
              downshiftNoticeRef.current = null;

              // 記憶的是"畫面高度"而非檔位下標：換集/換源後檔位數量與順序都會變，
              // 記下標會指向錯誤的檔位。
              preferredHeightRef.current = preferred;
              savePreferredQualityHeight(preferred);
              updateQualityTooltip(
                preferred === null
                  ? '自動'
                  : describeQualityPreference(levels, preferred)
              );

              // 檔位變了，已緩存的分片屬於舊檔位，按新檔位重排隊列
              ensurePrefetchCurrent(artPlayerRef.current?.currentTime || 0);
              return item.html;
            },
          },
          {
            name: '視頻緩存',
            html: '視頻緩存',
            switch: loadCacheSettings().enabled,
            tooltip: loadCacheSettings().enabled ? '未開始' : '已關閉',
            onSwitch: function (item: any) {
              const enabled = !item.switch;
              saveCacheSettings({ enabled });
              if (enabled) {
                updateCacheTooltip('未開始');
                ensurePrefetchCurrent(artPlayerRef.current?.currentTime || 0);
              } else {
                prefetcherRef.current.stop();
                getNextEpisodePrefetcher().stop();
                nextWarmupKeyRef.current = null;
                updateCacheTooltip('已關閉');
              }
              return enabled;
            },
          },
          {
            name: '緩存模式',
            html: '緩存模式',
            tooltip: `${
              cacheModeLabels[loadCacheSettings().concurrencyMode]
            } · ${loadCacheSettings().concurrency} 個`,
            selector: (['low', 'medium', 'high', 'custom'] as const).map(
              (mode) => ({
                html:
                  mode === 'custom'
                    ? '自定義'
                    : `${cacheModeLabels[mode]}（${
                        { low: 3, medium: 6, high: 9 }[mode]
                      } 個）`,
                value: mode,
                default: mode === loadCacheSettings().concurrencyMode,
              })
            ),
            onSelect: function (item: any) {
              const settings = saveCacheSettings({
                concurrencyMode: item.value,
              });
              restartCacheQueue();
              return `${cacheModeLabels[settings.concurrencyMode]} · ${
                settings.concurrency
              } 個`;
            },
          },
          {
            name: '自定義緩存並發',
            html: '自定義並發',
            tooltip: `${loadCacheSettings().customConcurrency} 個`,
            range: [loadCacheSettings().customConcurrency, 1, 32, 1],
            onChange: function (item: any) {
              return `${item.range[0]} 個`;
            },
            onRange: function (item: any) {
              const settings = saveCacheSettings({
                concurrencyMode: 'custom',
                customConcurrency: Number(item.range[0]),
              });
              updateSettingPreservingPanel(artPlayerRef.current, {
                name: '緩存模式',
                tooltip: `自定義 · ${settings.concurrency} 個`,
                selector: (['low', 'medium', 'high', 'custom'] as const).map(
                  (mode) => ({
                    html:
                      mode === 'custom'
                        ? '自定義'
                        : `${cacheModeLabels[mode]}（${
                            { low: 3, medium: 6, high: 9 }[mode]
                          } 個）`,
                    value: mode,
                    default: mode === 'custom',
                  })
                ),
              });
              restartCacheQueue();
              return `${settings.concurrency} 個`;
            },
          },
          {
            html: '緩存管理',
            onClick: function () {
              setShowCacheManager(true);
              return '';
            },
          },
        ],
        // 控制欄配置
        controls: [
          {
            position: 'left',
            index: 13,
            html: '<i class="art-icon flex"><svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" fill="currentColor"/></svg></i>',
            tooltip: '播放下一集',
            click: function () {
              handleNextEpisode();
            },
          },
        ],
      });

      bindDeferredProgressSeek(artPlayerRef.current);

      const playerEl =
        (artPlayerRef.current.template?.$player as HTMLElement | undefined) ||
        (artRef.current?.querySelector(
          '.art-video-player'
        ) as HTMLElement | null);
      if (playerEl) {
        setPlayerHost(playerEl);
      }

      // 監聽播放器事件
      artPlayerRef.current.on('ready', () => {
        setError(null);

        // 捕獲彈幕插件實例
        if (artPlayerRef.current?.plugins?.artplayerPluginDanmuku) {
          danmukuPluginInstanceRef.current =
            artPlayerRef.current.plugins.artplayerPluginDanmuku;
          console.log('彈幕插件實例已捕獲', danmukuPluginInstanceRef.current);
          setIsDanmakuPluginReady(true);
          if (danmukuPluginInstanceRef.current) {
            try {
              danmukuPluginInstanceRef.current.config(danmakuConfigRef.current);
            } catch (_) {
              // ignore
            }
          }
        }

        // 播放器就緒後，如果正在播放則請求 Wake Lock
        if (artPlayerRef.current && !artPlayerRef.current.paused) {
          requestWakeLock();
        }
        try {
          if (lastFullscreenWebRef.current) {
            artPlayerRef.current.fullscreenWeb = true;
          }
          if (lastFullscreenRef.current) {
            setTimeout(() => {
              artPlayerRef.current.fullscreen = true;
            }, 0);
          }
        } catch (_) {
          // ignore
        }
      });

      // 監聽彈幕配置變化：同步到 ref（供重建播放器時恢復）並持久化到本地，
      // 使用戶調整的彈幕設置（不透明度、字號、速度、顯示區域等）刷新後依然生效。
      artPlayerRef.current.on(
        'artplayerPluginDanmuku:config',
        (option: any) => {
          if (!option || typeof option !== 'object') return;

          // 更新恢復用配置，剔除運行時字段，避免重建播放器時引用已銷毀的節點
          const next = { ...option };
          delete next.mount;
          next.danmuku = '';
          danmakuConfigRef.current = next;

          const picked = pickDanmakuSettings(option);
          // 切集時會臨時隱藏彈幕，此時不持久化可見性，避免把臨時狀態寫入本地
          if (pendingDanmakuVisibleRestoreRef.current !== null) {
            delete picked.visible;
          }
          saveDanmakuSettings(picked);
        }
      );

      // 監聽播放狀態變化，控制 Wake Lock
      artPlayerRef.current.on('play', () => {
        requestWakeLock();
        syncCacheBandwidth(true);
      });

      artPlayerRef.current.on('pause', () => {
        releaseWakeLock();
        saveCurrentPlayProgress();

        // 暫停是預緩存的"黃金窗口"：播放不再搶帶寬，緩存應當全速繼續。
        // 1) 解除 stall 讓路。否則若用戶正好在卡頓時按暫停，video:playing
        //    永遠不會再觸發，預取會被永久掛起——恰好違背"暫停也繼續緩存"。
        // 2) 明確要求"不設時間上限"：把整集剩余分片全部排進隊列，暫停越久
        //    緩存鋪得越遠；字節上限與 LRU 淘汰才是這條路的兜底。
        //    走 ensurePrefetchCurrent 而不是閉包裡的 videoUrl——播放器跨集復用，
        //    閉包裡的地址可能是上一集的。
        setCacheBandwidthThrottled(false);
        ensurePrefetchCurrent(
          artPlayerRef.current.currentTime || 0,
          UNLIMITED_HORIZON_SECONDS
        );
      });

      // ---------------------------------------------------------------------
      // 前向預緩存：窗口維護
      // ---------------------------------------------------------------------
      // 跳轉開始即中止舊請求，保留統計和已寫入緩存；落點確定後重新排隊。
      artPlayerRef.current.on('video:seeking', () => {
        prefetcherRef.current.stop(true);
        setCacheBandwidthThrottled(true);
      });
      artPlayerRef.current.on('video:seeked', () => {
        prefetcherRef.current.stop(true);
        ensurePrefetchCurrent(artPlayerRef.current.currentTime || 0);
      });

      // 播放卡頓時讓出帶寬，恢復後繼續預取。
      // 注意：這是"臨時讓路"，不是"視頻暫停就停緩存"。
      artPlayerRef.current.on('video:waiting', () => {
        setCacheBandwidthThrottled(!artPlayerRef.current?.video?.paused);

        // —— 弱網自動降檔 ——
        // seek/換源也會觸發 waiting，因此 5 秒內的重復事件只記一次；
        // 2 分鐘內累計 4 次視為網絡跟不上當前檔位，把 ABR 上限壓一檔。
        const now = Date.now();
        const stalls = stallTimesRef.current;
        if (stalls.length === 0 || now - stalls[stalls.length - 1] >= 5_000) {
          stalls.push(now);
        }
        while (stalls.length > 0 && now - stalls[0] > 120_000) {
          stalls.shift();
        }

        const hls = artPlayerRef.current?.video?.hls;
        if (!hls || !hls.autoLevelEnabled) return; // 手動檔位由用戶自己負責
        if (stalls.length < 4) return;

        const currentLevel =
          typeof hls.loadLevel === 'number' && hls.loadLevel >= 0
            ? hls.loadLevel
            : typeof hls.currentLevel === 'number' && hls.currentLevel >= 0
            ? hls.currentLevel
            : 0;
        const cap =
          typeof hls.autoLevelCapping === 'number' && hls.autoLevelCapping >= 0
            ? hls.autoLevelCapping
            : Number.POSITIVE_INFINITY;
        const nextCap = Math.max(0, Math.min(currentLevel, cap) - 1);

        if (cap === 0) {
          // 已經是最低檔還在卡：提示換源，不再重復彈
          if (downshiftNoticeRef.current !== 'min') {
            downshiftNoticeRef.current = 'min';
            artPlayerRef.current.notice.show =
              '已降至最低畫質仍卡頓，建議在右側換一個播放源';
          }
          return;
        }

        hls.autoLevelCapping = nextCap;
        if (downshiftNoticeRef.current !== `cap-${nextCap}`) {
          downshiftNoticeRef.current = `cap-${nextCap}`;
          artPlayerRef.current.notice.show =
            '檢測到網絡較慢，已自動降低畫質以減少卡頓';
        }
      });
      artPlayerRef.current.on('video:playing', () => {
        syncCacheBandwidth(true);
      });
      artPlayerRef.current.on('video:progress', () => syncCacheBandwidth());

      // 如果播放器初始化時已經在播放狀態，則請求 Wake Lock
      if (artPlayerRef.current && !artPlayerRef.current.paused) {
        requestWakeLock();
      }

      artPlayerRef.current.on('video:volumechange', () => {
        lastVolumeRef.current = artPlayerRef.current.volume;
      });
      artPlayerRef.current.on('video:ratechange', () => {
        lastPlaybackRateRef.current = artPlayerRef.current.playbackRate;
      });

      // 監聽視頻可播放事件，這時恢復播放進度更可靠
      artPlayerRef.current.on('video:canplay', () => {
        // 若存在需要恢復的播放進度，則跳轉
        if (resumeTimeRef.current && resumeTimeRef.current > 0) {
          try {
            const duration = artPlayerRef.current.duration || 0;
            let target = resumeTimeRef.current;
            if (duration && target >= duration - 2) {
              target = Math.max(0, duration - 5);
            }
            artPlayerRef.current.currentTime = target;
            console.log('成功恢復播放進度到:', resumeTimeRef.current);
          } catch (err) {
            console.warn('恢復播放進度失敗:', err);
          }
        }
        resumeTimeRef.current = null;

        setTimeout(() => {
          if (
            Math.abs(artPlayerRef.current.volume - lastVolumeRef.current) > 0.01
          ) {
            artPlayerRef.current.volume = lastVolumeRef.current;
          }
          if (
            Math.abs(
              artPlayerRef.current.playbackRate - lastPlaybackRateRef.current
            ) > 0.01 &&
            isWebkit
          ) {
            artPlayerRef.current.playbackRate = lastPlaybackRateRef.current;
          }
          artPlayerRef.current.notice.show = '';
        }, 0);

        // 隱藏換源加載狀態
        setIsVideoLoading(false);
      });

      // 監聽視頻時間更新事件：播放進度自動保存 + 跳過片頭片尾
      // （兩個邏輯合並到同一個監聽器，避免重復注冊 timeupdate）
      artPlayerRef.current.on('video:timeupdate', () => {
        const now = Date.now();
        syncCacheBandwidth();

        // —— 播放進度自動保存 ——
        // 間隔優先讀取站點配置（RUNTIME_CONFIG.PLAYBACK_SAVE_INTERVAL，單位秒），
        // 未配置時回退到存儲類型默認值（Upstash 20s，其余 5s）
        const configuredInterval =
          typeof window !== 'undefined'
            ? Number((window as any).RUNTIME_CONFIG?.PLAYBACK_SAVE_INTERVAL)
            : 0;
        const saveInterval =
          configuredInterval > 0
            ? configuredInterval * 1000
            : getDefaultPlaybackSaveInterval(
                process.env.NEXT_PUBLIC_STORAGE_TYPE
              ) * 1000;
        if (now - lastSaveTimeRef.current > saveInterval) {
          saveCurrentPlayProgress();
          lastSaveTimeRef.current = now;
        }

        // —— 前向預緩存窗口續跑 ——
        // 播放自然推進（未觸發 seek）時，每 30 秒檢查一次窗口余量並續跑
        if (now - lastPrefetchCheckRef.current > 30_000) {
          lastPrefetchCheckRef.current = now;
          ensurePrefetchCurrent(artPlayerRef.current.currentTime || 0);
        }

        // —— 跳過片頭片尾 ——
        if (!skipConfigRef.current.enable) return;

        const currentTime = artPlayerRef.current.currentTime || 0;
        const duration = artPlayerRef.current.duration || 0;

        // 限制跳過檢查頻率為1.5秒一次
        if (now - lastSkipCheckRef.current < 1500) return;
        lastSkipCheckRef.current = now;

        // 跳過片頭
        if (
          skipConfigRef.current.intro_time > 0 &&
          currentTime < skipConfigRef.current.intro_time
        ) {
          artPlayerRef.current.currentTime = skipConfigRef.current.intro_time;
          artPlayerRef.current.notice.show = `已跳過片頭 (${formatTime(
            skipConfigRef.current.intro_time
          )})`;
        }

        // 跳過片尾
        if (
          skipConfigRef.current.outro_time < 0 &&
          duration > 0 &&
          currentTime >
            artPlayerRef.current.duration + skipConfigRef.current.outro_time
        ) {
          if (
            currentEpisodeIndexRef.current <
            (detailRef.current?.episodes?.length || 1) - 1
          ) {
            handleNextEpisode();
          } else {
            artPlayerRef.current.pause();
          }
          artPlayerRef.current.notice.show = `已跳過片尾 (${formatTime(
            skipConfigRef.current.outro_time
          )})`;
        }
      });

      artPlayerRef.current.on('error', (err: any) => {
        console.error('播放器錯誤:', err);
        if (artPlayerRef.current.currentTime > 0) {
          return;
        }
      });

      // 監聽視頻播放結束事件：釋放 Wake Lock 並自動播放下一集
      artPlayerRef.current.on('video:ended', () => {
        releaseWakeLock();
        const d = detailRef.current;
        const idx = currentEpisodeIndexRef.current;
        if (d && d.episodes && idx < d.episodes.length - 1) {
          setTimeout(() => {
            handleNextEpisode();
          }, 1000);
        }
      });

      if (artPlayerRef.current?.video) {
        ensureVideoSource(
          artPlayerRef.current.video as HTMLVideoElement,
          playbackUrl
        );
      }
    } catch (err) {
      console.error('創建播放器失敗:', err);
      setError('播放器初始化失敗');
    }
  }, [
    libsReady,
    videoUrl,
    loading,
    blockAdEnabled,
    currentEpisodeIndex,
    detail,
  ]);

  // -----------------------------------------------------------------------------
  // 進度條懸停預覽
  // -----------------------------------------------------------------------------

  // 抽幀器實例生命周期：切集 / 換源 / 去廣告開關變化時重建，
  // 其 loader 配置與主播放器完全一致，保證預覽分片同樣命中 Cache Storage / 同源代理。
  useEffect(() => {
    if (!libsReady || !videoUrl) return;
    const Hls = hlsLibRef.current;
    if (!Hls) return;

    const thumb = new PreviewThumbnailer();
    previewThumbnailerRef.current?.destroy();
    previewThumbnailerRef.current = thumb;
    thumb.load(
      getPlaybackUrl(videoUrl, blockAdEnabledRef.current),
      Hls,
      createCustomHlsLoader(Hls, {
        blockAd: blockAdEnabledRef.current,
        useProxy: loadCacheSettings().useProxy,
        // 預覽抽幀不計入「緩存命中率」診斷，避免污染主播放器統計
        onProbe: () => undefined,
      })
    );
    setPreview(null);

    return () => {
      // Invalidate captures from the old source before their promises settle.
      previewRequestIdRef.current++;
      thumb.destroy();
      if (previewThumbnailerRef.current === thumb) {
        previewThumbnailerRef.current = null;
      }
    };
  }, [libsReady, videoUrl, blockAdEnabled]);

  // 鼠標懸停及拖動處理器共享預覽；觸摸抽幀串行執行，避免移動時反復取消。
  // playerHost 變化代表播放器已重建（進度條 DOM 換新），需重新綁定。
  useEffect(() => {
    if (!playerHost) return;
    const progressEl =
      (artPlayerRef.current?.template?.$progress as HTMLElement | null) ||
      (playerHost.querySelector('.art-progress') as HTMLElement | null);
    if (!progressEl) return;

    let dragging = false;
    let touchTime: number | null = null;
    let capturingTouch = false;
    let capturedTouchTime: number | null = null;

    const scheduleTouchCapture = () => {
      if (
        touchTime === null ||
        capturingTouch ||
        previewTimerRef.current !== null ||
        touchTime === capturedTouchTime
      ) {
        return;
      }
      const id = previewRequestIdRef.current;
      previewTimerRef.current = window.setTimeout(() => {
        previewTimerRef.current = null;
        const thumb = previewThumbnailerRef.current;
        const time = touchTime;
        if (!thumb || time === null) return;
        capturingTouch = true;
        capturedTouchTime = time;
        thumb.capture(time).then((image) => {
          if (id !== previewRequestIdRef.current) return;
          capturingTouch = false;
          // 保留上一幀直到新幀就緒；移動中的時間標簽仍實時更新。
          if (image) {
            setPreview((p) => (p?.visible ? { ...p, image } : p));
          }
          scheduleTouchCapture();
        });
      }, 120);
    };

    const showPreview = (ratio: number, input: 'mouse' | 'touch') => {
      const duration = artPlayerRef.current?.duration || 0;
      if (!Number.isFinite(duration) || duration <= 0) return;
      const time = ratio * duration;
      setPreview((p) => ({
        visible: true,
        time,
        left:
          input === 'touch' || artLibRef.current?.utils?.isMobile
            ? 50
            : ratio * 100,
        image: p?.visible ? p.image : null,
      }));
      if (input === 'touch') {
        touchTime = time;
        scheduleTouchCapture();
        return;
      }
      // 先使已在進行中的抽幀失效，避免舊圖串到新位置
      const id = ++previewRequestIdRef.current;
      previewThumbnailerRef.current?.cancel();

      if (previewTimerRef.current != null)
        clearTimeout(previewTimerRef.current);
      previewTimerRef.current = window.setTimeout(() => {
        previewTimerRef.current = null;
        const thumb = previewThumbnailerRef.current;
        if (!thumb) return;
        thumb.capture(time).then((image) => {
          if (id !== previewRequestIdRef.current) return;
          setPreview((p) =>
            image && p && p.visible && Math.abs(p.time - time) < 0.5
              ? { ...p, image }
              : p
          );
        });
      }, 120);
    };

    const hidePreview = () => {
      dragging = false;
      touchTime = null;
      capturedTouchTime = null;
      capturingTouch = false;
      if (previewTimerRef.current != null) {
        clearTimeout(previewTimerRef.current);
        previewTimerRef.current = null;
      }
      previewRequestIdRef.current++;
      previewThumbnailerRef.current?.cancel();
      setPreview((p) => (p ? { ...p, visible: false } : p));
    };

    const onDragMove = (event: Event) => {
      const { ratio, input } = (event as CustomEvent<ProgressPreviewMove>)
        .detail;
      if (!dragging && input === 'touch') hidePreview();
      dragging = true;
      showPreview(ratio, input);
    };
    const onPointerMove = (e: PointerEvent) => {
      // 觸摸由拖動處理器驅動，不依賴瀏覽器是否產生 pointermove。
      if (e.pointerType === 'touch' || dragging) return;
      const rect = progressEl.getBoundingClientRect();
      const rotated = artPlayerRef.current?.isRotate;
      const size = rotated ? rect.height : rect.width;
      if (size <= 0) return;
      const offset = rotated ? e.clientY - rect.top : e.clientX - rect.left;
      showPreview(Math.min(1, Math.max(0, offset / size)), 'mouse');
    };
    const onPointerLeave = () => {
      if (!dragging) hidePreview();
    };

    progressEl.addEventListener(PROGRESS_PREVIEW_MOVE, onDragMove);
    progressEl.addEventListener(PROGRESS_PREVIEW_END, hidePreview);
    progressEl.addEventListener('pointermove', onPointerMove);
    progressEl.addEventListener('pointerleave', onPointerLeave);

    return () => {
      progressEl.removeEventListener(PROGRESS_PREVIEW_MOVE, onDragMove);
      progressEl.removeEventListener(PROGRESS_PREVIEW_END, hidePreview);
      progressEl.removeEventListener('pointermove', onPointerMove);
      progressEl.removeEventListener('pointerleave', onPointerLeave);
      hidePreview();
      setPreview(null);
    };
  }, [playerHost]);

  // 當組件卸載時清理定時器、Wake Lock 和播放器資源
  useEffect(() => {
    // 監聽頁面可見性變化
    const handleVisibilityChange = () => {
      if (
        !document.hidden &&
        artPlayerRef.current &&
        !artPlayerRef.current.paused
      ) {
        // 頁面變為可見且視頻正在播放時，重新請求 Wake Lock
        requestWakeLock();
      } else if (document.hidden) {
        // 頁面隱藏時，釋放 Wake Lock（系統會自動釋放，但我們也主動釋放）
        releaseWakeLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (danmakuVisibleRestoreTimerRef.current) {
        clearTimeout(danmakuVisibleRestoreTimerRef.current);
        danmakuVisibleRestoreTimerRef.current = null;
      }

      // 清理定時器
      if (saveIntervalRef.current) {
        clearInterval(saveIntervalRef.current);
      }

      // 釋放 Wake Lock
      releaseWakeLock();

      // 移除可見性監聽
      document.removeEventListener('visibilitychange', handleVisibilityChange);

      // 停止前向預緩存（含下一集預熱隊列）
      restartPrefetchForSkipRef.current = null;
      prefetcherRef.current.stop();
      getNextEpisodePrefetcher().stop();

      // 銷毀播放器實例
      cleanupPlayer();
    };
  }, []);

  // -----------------------------------------------------------------------------
  // 彈幕選擇回調（供渲染層綁定 DanmakuSelector）
  // -----------------------------------------------------------------------------

  const handleDanmakuSelect = (anime: AnimeOption, episodeNumber?: number) => {
    const sourceName = anime.animeTitle;
    abortControllerRef.current?.abort();
    setIsDanmakuLoading(false);
    try {
      const serializedAnime = JSON.stringify(anime);
      localStorage.setItem(
        getDanmakuSourceStorageKey(videoTitle, videoYear),
        serializedAnime
      );
      const playbackStorageKey = getDanmakuPlaybackStorageKey(
        currentSource,
        currentId
      );
      if (playbackStorageKey)
        localStorage.setItem(playbackStorageKey, serializedAnime);
    } catch {
      // Storage can be unavailable in private browsing; playback still works.
    }
    setSelectedDanmakuSource(sourceName);
    selectedDanmakuSourceRef.current = sourceName;
    setShowDanmakuSelector(false);
    setSelectedDanmakuAnime(anime);
    setSelectedDanmakuEpisode(episodeNumber);
    setSelectedState(true);
  };

  const handleDanmakuClose = () => {
    setShowDanmakuSelector(false);
    // 更新 tooltip（走 DOM setter，不觸發面板重建）
    setSettingTooltip(
      artPlayerRef.current,
      DANMAKU_SETTING_NAME,
      currentTooltip || '未選擇'
    );
  };

  // -----------------------------------------------------------------------------
  // 返回給渲染層
  // -----------------------------------------------------------------------------

  return {
    // 加載 / 錯誤
    loading,
    loadingStage,
    loadingMessage,
    error,
    // 視頻與元數據
    detail,
    totalEpisodes,
    videoTitle,
    videoYear,
    videoDoubanId,
    currentSource,
    currentId,
    searchTitle,
    currentEpisodeIndex,
    videoUrl,
    skipConfig,
    // 播放器
    artRef,
    playerHost,
    preview,
    isVideoLoading,
    videoLoadingStage,
    setLoading,
    setIsVideoLoading,
    setVideoLoadingStage,
    // 源 / 換源
    availableSources,
    sourceSearchLoading,
    sourceSearchError,
    precomputedVideoInfo,
    preferBestSource,
    handleSourceChange,
    handleEpisodeChange,
    // 彈幕
    showDanmakuSelector,
    isDanmakuLoading,
    handleDanmakuSelect,
    handleDanmakuClose,
    // 緩存管理
    showCacheManager,
    setShowCacheManager,
    // 收藏 / 追更
    favorited,
    following,
    handleToggleFavorite,
    handleToggleFollowing,
  };
}
