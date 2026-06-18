/* eslint-disable @next/next/no-img-element */

import { useRouter } from 'next/navigation';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  type VideoProbeInfo,
  getSourceProbeKey,
  selectEpisodeUrlForSource,
} from '@/lib/source-preference';
import { SearchResult } from '@/lib/types';
import { getVideoResolutionFromM3u8, processImageUrl } from '@/lib/utils';

// 定義視頻信息類型
type VideoInfo = VideoProbeInfo;

interface EpisodeSelectorProps {
  /** 總集數 */
  totalEpisodes: number;
  /** 劇集標題 */
  episodes_titles: string[];
  /** 每頁顯示多少集，默認 50 */
  episodesPerPage?: number;
  /** 當前選中的集數（1 開始） */
  value?: number;
  /** 用戶點擊選集後的回調 */
  onChange?: (episodeNumber: number) => void;
  /** 換源相關 */
  onSourceChange?: (source: string, id: string, title: string) => void;
  currentSource?: string;
  currentId?: string;
  videoTitle?: string;
  videoYear?: string;
  availableSources?: SearchResult[];
  sourceSearchLoading?: boolean;
  sourceSearchError?: string | null;
  /** 預計算的測速結果，避免重復測速 */
  precomputedVideoInfo?: Map<string, VideoInfo>;
  /** 優選播放源相關 */
  preferBestSource?: (
    sources: SearchResult[],
    isCancelled?: () => boolean
  ) => Promise<SearchResult>;
  setLoading: (loading: boolean) => void;
  /** 設置視頻是否正在加載中的狀態 */
  setIsVideoLoading: (loading: boolean) => void;
  /** 設置視頻加載階段的狀態 */
  setVideoLoadingStage: (
    stage: 'initing' | 'sourceChanging' | 'optimizing'
  ) => void;
}

/**
 * 選集組件，支持分頁、自動滾動聚焦當前分頁標簽，以及換源功能。
 */
const EpisodeSelector: React.FC<EpisodeSelectorProps> = ({
  totalEpisodes,
  episodes_titles,
  episodesPerPage = 50,
  value = 1,
  onChange,
  onSourceChange,
  currentSource,
  currentId,
  videoTitle,
  availableSources = [],
  sourceSearchLoading = false,
  sourceSearchError = null,
  precomputedVideoInfo,
  preferBestSource,
  setLoading,
  setIsVideoLoading,
  setVideoLoadingStage,
}) => {
  const router = useRouter();
  const pageCount = Math.ceil(totalEpisodes / episodesPerPage);

  // 存儲每個源的視頻信息
  const [videoInfoMap, setVideoInfoMap] = useState<Map<string, VideoInfo>>(
    new Map()
  );
  const [attemptedSources, setAttemptedSources] = useState<Set<string>>(
    new Set()
  );

  // 使用 ref 來避免閉包問題
  const attemptedSourcesRef = useRef<Set<string>>(new Set());
  const videoInfoMapRef = useRef<Map<string, VideoInfo>>(new Map());

  // 同步狀態到 ref
  useEffect(() => {
    attemptedSourcesRef.current = attemptedSources;
  }, [attemptedSources]);

  useEffect(() => {
    videoInfoMapRef.current = videoInfoMap;
  }, [videoInfoMap]);

  // 主要的 tab 狀態：'episodes' 或 'sources'
  // 當只有一集時默認展示 "換源"，並隱藏 "選集" 標簽
  const [activeTab, setActiveTab] = useState<'episodes' | 'sources'>(
    totalEpisodes > 1 ? 'episodes' : 'sources'
  );

  // 當前分頁索引（0 開始）
  const initialPage = Math.floor((value - 1) / episodesPerPage);
  const [currentPage, setCurrentPage] = useState<number>(initialPage);

  // 是否倒序顯示
  const [descending, setDescending] = useState<boolean>(false);
  // 優選播放源加載狀態
  const [isOptimizing, setIsOptimizing] = useState<boolean>(false);
  // 取消優選標志
  const cancelOptimizationRef = useRef<boolean>(false);

  // 根據 descending 狀態計算實際顯示的分頁索引
  const displayPage = useMemo(() => {
    if (descending) {
      return pageCount - 1 - currentPage;
    }
    return currentPage;
  }, [currentPage, descending, pageCount]);

  // 獲取視頻信息的函數 - 移除 attemptedSources 依賴避免不必要的重新創建
  const currentEpisodeIndex = Math.max(0, value - 1);

  const getVideoInfo = useCallback(
    async (source: SearchResult) => {
      const sourceKey = getSourceProbeKey(source, currentEpisodeIndex);

      // 使用 ref 獲取最新的狀態，避免閉包問題
      if (attemptedSourcesRef.current.has(sourceKey)) {
        return;
      }

      const episodeUrl = selectEpisodeUrlForSource(source, currentEpisodeIndex);
      if (!episodeUrl) return;

      // 標記為已嘗試
      setAttemptedSources((prev) => new Set(prev).add(sourceKey));

      try {
        const info = await getVideoResolutionFromM3u8(episodeUrl);
        setVideoInfoMap((prev) => new Map(prev).set(sourceKey, info));
      } catch (error) {
        // 失敗時保存錯誤狀態
        setVideoInfoMap((prev) =>
          new Map(prev).set(sourceKey, {
            quality: '錯誤',
            loadSpeed: '未知',
            pingTime: 0,
            hasError: true,
          })
        );
      }
    },
    [currentEpisodeIndex]
  );

  // 當有預計算結果時，先合並到videoInfoMap中
  useEffect(() => {
    if (precomputedVideoInfo && precomputedVideoInfo.size > 0) {
      // 原子性地更新兩個狀態，避免時序問題
      setVideoInfoMap((prev) => {
        const newMap = new Map(prev);
        precomputedVideoInfo.forEach((value, key) => {
          newMap.set(key, value);
        });
        return newMap;
      });

      setAttemptedSources((prev) => {
        const newSet = new Set(prev);
        precomputedVideoInfo.forEach((_info, key) => {
          newSet.add(key);
        });
        return newSet;
      });

      // 同步更新 ref，確保 getVideoInfo 能立即看到更新
      precomputedVideoInfo.forEach((_info, key) => {
        attemptedSourcesRef.current.add(key);
      });
    }
  }, [precomputedVideoInfo]);

  // 讀取本地「優選和測速」開關，默認開啟
  const [optimizationEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('enableOptimization');
      if (saved !== null) {
        try {
          return JSON.parse(saved);
        } catch {
          /* ignore */
        }
      }
    }
    return true;
  });

  // 當切換到換源tab並且有源數據時，異步獲取視頻信息 - 移除 attemptedSources 依賴避免循環觸發
  useEffect(() => {
    const fetchVideoInfosInBatches = async () => {
      if (
        !optimizationEnabled || // 若關閉測速則直接退出
        activeTab !== 'sources' ||
        availableSources.length === 0
      )
        return;

      // 篩選出尚未測速的播放源
      const pendingSources = availableSources.filter((source) => {
        const sourceKey = getSourceProbeKey(source, currentEpisodeIndex);
        return !attemptedSourcesRef.current.has(sourceKey);
      });

      if (pendingSources.length === 0) return;

      const batchSize = Math.ceil(pendingSources.length / 2);

      for (let start = 0; start < pendingSources.length; start += batchSize) {
        const batch = pendingSources.slice(start, start + batchSize);
        await Promise.all(batch.map(getVideoInfo));
      }
    };

    fetchVideoInfosInBatches();
    // 依賴項保持與之前一致
  }, [
    activeTab,
    availableSources,
    currentEpisodeIndex,
    getVideoInfo,
    optimizationEnabled,
  ]);

  // 升序分頁標簽
  const categoriesAsc = useMemo(() => {
    return Array.from({ length: pageCount }, (_, i) => {
      const start = i * episodesPerPage + 1;
      const end = Math.min(start + episodesPerPage - 1, totalEpisodes);
      return { start, end };
    });
  }, [pageCount, episodesPerPage, totalEpisodes]);

  // 根據 descending 狀態決定分頁標簽的排序和內容
  const categories = useMemo(() => {
    if (descending) {
      // 倒序時，label 也倒序顯示
      return [...categoriesAsc]
        .reverse()
        .map(({ start, end }) => `${end}-${start}`);
    }
    return categoriesAsc.map(({ start, end }) => `${start}-${end}`);
  }, [categoriesAsc, descending]);

  const categoryContainerRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // 當分頁切換時，將激活的分頁標簽滾動到視口中間
  useEffect(() => {
    const btn = buttonRefs.current[displayPage];
    const container = categoryContainerRef.current;
    if (btn && container) {
      // 手動計算滾動位置，只滾動分頁標簽容器
      const containerRect = container.getBoundingClientRect();
      const btnRect = btn.getBoundingClientRect();
      const scrollLeft = container.scrollLeft;

      // 計算按鈕相對於容器的位置
      const btnLeft = btnRect.left - containerRect.left + scrollLeft;
      const btnWidth = btnRect.width;
      const containerWidth = containerRect.width;

      // 計算目標滾動位置，使按鈕居中
      const targetScrollLeft = btnLeft - (containerWidth - btnWidth) / 2;

      // 平滑滾動到目標位置
      container.scrollTo({
        left: targetScrollLeft,
        behavior: 'smooth',
      });
    }
  }, [displayPage, pageCount]);

  // 處理換源tab點擊，只在點擊時才搜索
  const handleSourceTabClick = () => {
    setActiveTab('sources');
  };

  const handleCategoryClick = useCallback(
    (index: number) => {
      if (descending) {
        // 在倒序時，需要將顯示索引轉換為實際索引
        setCurrentPage(pageCount - 1 - index);
      } else {
        setCurrentPage(index);
      }
    },
    [descending, pageCount]
  );

  const handleEpisodeClick = useCallback(
    (episodeNumber: number) => {
      onChange?.(episodeNumber);
    },
    [onChange]
  );

  const handleSourceClick = useCallback(
    (source: SearchResult) => {
      if (!source || !source.source || !source.id) return;
      // 確保傳遞完整的參數
      onSourceChange?.(
        source.source,
        source.id,
        source.title || source.source_name || ''
      );
    },
    [onSourceChange]
  );

  const currentStart = currentPage * episodesPerPage + 1;
  const currentEnd = Math.min(
    currentStart + episodesPerPage - 1,
    totalEpisodes
  );

  return (
    <div className='px-4 py-0 h-full bg-black/10 dark:bg-white/5 flex flex-col border-t border-b md:border-r border-white/0 dark:border-white/30 overflow-hidden'>
      {/* 主要的 Tab 切換 - 無縫融入設計 */}
      <div className='flex mb-1 -mx-6 flex-shrink-0'>
        {totalEpisodes > 1 && (
          <div
            onClick={() => setActiveTab('episodes')}
            className={`flex-1 py-3 px-6 text-center cursor-pointer transition-all duration-200 font-medium
              ${
                activeTab === 'episodes'
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-gray-700 hover:text-green-600 bg-black/5 dark:bg-white/5 dark:text-gray-300 dark:hover:text-green-400 hover:bg-black/3 dark:hover:bg-white/3'
              }
            `.trim()}
          >
            選集
          </div>
        )}
        <div
          onClick={handleSourceTabClick}
          className={`flex-1 py-3 px-6 text-center cursor-pointer transition-all duration-200 font-medium flex items-center justify-center
            ${
              activeTab === 'sources'
                ? 'text-green-600 dark:text-green-400'
                : 'text-gray-700 hover:text-green-600 bg-black/5 dark:bg-white/5 dark:text-gray-300 dark:hover:text-green-400 hover:bg-black/3 dark:hover:bg-white/3'
            }
          `.trim()}
        >
          <span>換源</span>
          {preferBestSource &&
            availableSources &&
            availableSources.length > 0 && (
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  if (isOptimizing) return; // 防止重復點擊
                  if (!availableSources || availableSources.length === 0)
                    return;
                  // 重置取消標志
                  cancelOptimizationRef.current = false;
                  setIsOptimizing(true);
                  setVideoLoadingStage('optimizing');
                  setIsVideoLoading(true);
                  preferBestSource(
                    availableSources,
                    () => cancelOptimizationRef.current
                  )
                    .then((bestSource) => {
                      // 如果已取消，則忽略結果
                      if (cancelOptimizationRef.current) return;
                      // 確保bestSource有效
                      if (
                        bestSource &&
                        (bestSource.source !== currentSource ||
                          bestSource.id !== currentId)
                      ) {
                        // 切換到最佳播放源
                        handleSourceClick(bestSource);
                      } else {
                        setIsVideoLoading(false);
                      }
                    })
                    .catch((_err: Error) => {
                      // 靜默處理錯誤，因為已經有UI提示
                    })
                    .finally(() => {
                      if (!cancelOptimizationRef.current) {
                        setIsOptimizing(false);
                        setIsVideoLoading(false);
                        if (setLoading) setLoading(false);
                      }
                      // 重置取消標志
                      cancelOptimizationRef.current = false;
                    });
                }}
                className={`ml-2 bg-blue-500 text-white text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center shadow-md transition-all duration-300 ease-out ${
                  isOptimizing
                    ? 'opacity-50 cursor-not-allowed'
                    : 'hover:bg-blue-600 hover:scale-110 cursor-pointer'
                }`}
                title={isOptimizing ? '優選進行中...' : '優選播放源'}
              >
                <svg
                  className='w-3.5 h-3.5'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  strokeWidth='2'
                  strokeLinecap='round'
                  strokeLinejoin='round'
                >
                  <path d='M13 2L3 14h9l-1 8 10-12h-9l1-8z' />
                </svg>
              </div>
            )}
        </div>
      </div>

      {/* 選集 Tab 內容 */}
      {activeTab === 'episodes' && (
        <>
          {/* 分類標簽 */}
          <div className='flex items-center gap-4 mb-4 border-b border-gray-300 dark:border-gray-700 -mx-6 px-6 flex-shrink-0'>
            <div
              className='flex-1 overflow-x-auto scrollbar-hide'
              ref={categoryContainerRef}
            >
              <div className='flex gap-2 min-w-max'>
                {categories.map((label, idx) => {
                  const isActive = idx === displayPage;
                  return (
                    <button
                      key={label}
                      ref={(el) => {
                        buttonRefs.current[idx] = el;
                      }}
                      onClick={() => handleCategoryClick(idx)}
                      className={`w-20 relative py-2 text-sm font-medium transition-colors whitespace-nowrap flex-shrink-0 text-center
                        ${
                          isActive
                            ? 'text-green-500 dark:text-green-400'
                            : 'text-gray-700 hover:text-green-600 dark:text-gray-300 dark:hover:text-green-400'
                        }
                      `.trim()}
                    >
                      {label}
                      {isActive && (
                        <div className='absolute bottom-0 left-0 right-0 h-0.5 bg-green-500 dark:bg-green-400' />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            {/* 向上/向下按鈕 */}
            <button
              className='flex-shrink-0 w-8 h-8 rounded-md flex items-center justify-center text-gray-700 hover:text-green-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:text-green-400 dark:hover:bg-white/20 transition-colors transform translate-y-[-4px]'
              onClick={() => {
                // 切換集數排序（正序/倒序）
                setDescending((prev) => !prev);
              }}
            >
              <svg
                className='w-4 h-4'
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth='2'
                  d='M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4'
                />
              </svg>
            </button>
          </div>

          {/* 集數網格 */}
          <div className='overflow-y-auto flex-1 pb-4 scrollbar-hide'>
            <div className='grid grid-cols-3 sm:grid-cols-4 gap-3'>
              {(() => {
                const len = currentEnd - currentStart + 1;
                const episodes = Array.from({ length: len }, (_, i) =>
                  descending ? currentEnd - i : currentStart + i
                );
                return episodes;
              })().map((episodeNumber) => {
                const isActive = episodeNumber === value;
                return (
                  <button
                    key={episodeNumber}
                    onClick={() => handleEpisodeClick(episodeNumber - 1)}
                    className={`h-9 px-1 py-1 flex items-center justify-center text-xs font-medium rounded transition-all duration-200 whitespace-nowrap font-mono
                      ${
                        isActive
                          ? 'bg-green-500 text-white shadow-lg shadow-green-500/25 dark:bg-green-600'
                          : 'bg-gray-200 text-gray-700 hover:bg-gray-300 hover:scale-105 dark:bg-white/10 dark:text-gray-300 dark:hover:bg-white/20'
                      }`.trim()}
                  >
                    {(() => {
                      const title = episodes_titles?.[episodeNumber - 1];
                      if (!title) {
                        return episodeNumber;
                      }
                      // 如果匹配"第X集"格式，提取中間的數字
                      const match = title.match(/第(\d+)集/);
                      if (match) {
                        return match[1];
                      }
                      return title;
                    })()}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* 換源 Tab 內容 */}
      {activeTab === 'sources' && (
        <div className='flex flex-col h-full mt-4'>
          {sourceSearchLoading && (
            <div className='flex items-center justify-center py-8'>
              <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-green-500'></div>
              <span className='ml-2 text-sm text-gray-600 dark:text-gray-300'>
                搜索中...
              </span>
            </div>
          )}

          {isOptimizing && (
            <div className='flex items-center justify-center py-3'>
              <div className='flex items-center'>
                <div className='animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500'></div>
                <span className='ml-2 text-sm text-gray-600 dark:text-gray-300'>
                  優選播放源中...
                </span>
              </div>
              <button
                onClick={() => {
                  cancelOptimizationRef.current = true;
                  setIsOptimizing(false);
                  if (setLoading) setLoading(false);
                }}
                className='ml-4 text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 px-2 py-1 rounded border border-red-300 dark:border-red-700 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors'
              >
                取消
              </button>
            </div>
          )}

          {sourceSearchError && (
            <div className='flex items-center justify-center py-8'>
              <div className='text-center'>
                <div className='text-red-500 text-2xl mb-2'>⚠️</div>
                <p className='text-sm text-red-600 dark:text-red-400'>
                  {sourceSearchError}
                </p>
              </div>
            </div>
          )}

          {!sourceSearchLoading &&
            !sourceSearchError &&
            availableSources.length === 0 && (
              <div className='flex items-center justify-center py-8'>
                <div className='text-center'>
                  <div className='text-gray-400 text-2xl mb-2'>📺</div>
                  <p className='text-sm text-gray-600 dark:text-gray-300'>
                    暫無可用的換源
                  </p>
                </div>
              </div>
            )}

          {!sourceSearchLoading &&
            !sourceSearchError &&
            availableSources.length > 0 && (
              <div className='flex-1 overflow-y-auto space-y-2 pb-20 scrollbar-hide'>
                {[...availableSources]
                  .sort((a, b) => {
                    const aIsCurrent =
                      a.source?.toString() === currentSource?.toString() &&
                      a.id?.toString() === currentId?.toString();
                    const bIsCurrent =
                      b.source?.toString() === currentSource?.toString() &&
                      b.id?.toString() === currentId?.toString();
                    if (aIsCurrent && !bIsCurrent) return -1;
                    if (!aIsCurrent && bIsCurrent) return 1;
                    return 0;
                  })
                  .map((source, index) => {
                    const isCurrentSource =
                      source.source?.toString() === currentSource?.toString() &&
                      source.id?.toString() === currentId?.toString();
                    return (
                      <div
                        key={`${source.source}-${source.id}`}
                        onClick={() =>
                          !isCurrentSource && handleSourceClick(source)
                        }
                        className={`flex items-start gap-3 px-2 py-3 rounded-lg transition-all select-none duration-200 relative
                      ${
                        isCurrentSource
                          ? 'bg-green-500/10 dark:bg-green-500/20 border-green-500/30 border'
                          : 'hover:bg-gray-200/50 dark:hover:bg-white/10 hover:scale-[1.02] cursor-pointer'
                      }`.trim()}
                      >
                        {/* 封面 */}
                        <div className='flex-shrink-0 w-12 h-20 bg-gray-300 dark:bg-gray-600 rounded overflow-hidden'>
                          {source.episodes && source.episodes.length > 0 && (
                            <img
                              src={processImageUrl(source.poster)}
                              alt={source.title}
                              className='w-full h-full object-cover'
                              onError={(e) => {
                                const target = e.target as HTMLImageElement;
                                target.style.display = 'none';
                              }}
                            />
                          )}
                        </div>

                        {/* 信息區域 */}
                        <div className='flex-1 min-w-0 flex flex-col justify-between h-20'>
                          {/* 標題和分辨率 - 頂部 */}
                          <div className='flex items-start justify-between gap-3 h-6'>
                            <div className='flex-1 min-w-0 relative group/title'>
                              <h3 className='font-medium text-base truncate text-gray-900 dark:text-gray-100 leading-none'>
                                {source.title}
                              </h3>
                              {/* 標題級別的 tooltip - 第一個元素不顯示 */}
                              {index !== 0 && (
                                <div className='absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-1 bg-gray-800 text-white text-xs rounded-md shadow-lg opacity-0 invisible group-hover/title:opacity-100 group-hover/title:visible transition-all duration-200 ease-out delay-100 whitespace-nowrap z-[500] pointer-events-none'>
                                  {source.title}
                                  <div className='absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-800'></div>
                                </div>
                              )}
                            </div>
                            {(() => {
                              const sourceKey = getSourceProbeKey(
                                source,
                                currentEpisodeIndex
                              );
                              const videoInfo = videoInfoMap.get(sourceKey);

                              if (videoInfo && videoInfo.quality !== '未知') {
                                if (videoInfo.hasError) {
                                  return (
                                    <div className='bg-gray-500/10 dark:bg-gray-400/20 text-red-600 dark:text-red-400 px-1.5 py-0 rounded text-xs flex-shrink-0 min-w-[50px] text-center'>
                                      檢測失敗
                                    </div>
                                  );
                                } else {
                                  // 根據分辨率設置不同顏色：2K、4K為紫色，1080p、720p為綠色，其他為黃色
                                  const isUltraHigh = ['4K', '2K'].includes(
                                    videoInfo.quality
                                  );
                                  const isHigh = ['1080p', '720p'].includes(
                                    videoInfo.quality
                                  );
                                  const textColorClasses = isUltraHigh
                                    ? 'text-purple-600 dark:text-purple-400'
                                    : isHigh
                                    ? 'text-green-600 dark:text-green-400'
                                    : 'text-yellow-600 dark:text-yellow-400';

                                  return (
                                    <div
                                      className={`bg-gray-500/10 dark:bg-gray-400/20 ${textColorClasses} px-1.5 py-0 rounded text-xs flex-shrink-0 min-w-[50px] text-center`}
                                    >
                                      {videoInfo.quality}
                                    </div>
                                  );
                                }
                              }

                              return null;
                            })()}
                          </div>

                          {/* 源名稱和集數信息 - 垂直居中 */}
                          <div className='flex items-center justify-between'>
                            <span className='text-xs px-2 py-1 border border-gray-500/60 rounded text-gray-700 dark:text-gray-300'>
                              {source.source_name}
                            </span>
                            {source.episodes.length > 1 && (
                              <span className='text-xs text-gray-500 dark:text-gray-400 font-medium'>
                                {source.episodes.length} 集
                              </span>
                            )}
                          </div>

                          {/* 網絡信息 - 底部 */}
                          <div className='flex items-end h-6'>
                            {(() => {
                              const sourceKey = getSourceProbeKey(
                                source,
                                currentEpisodeIndex
                              );
                              const videoInfo = videoInfoMap.get(sourceKey);
                              if (videoInfo) {
                                if (!videoInfo.hasError) {
                                  return (
                                    <div className='flex items-end gap-3 text-xs'>
                                      <div className='text-green-600 dark:text-green-400 font-medium text-xs'>
                                        {videoInfo.loadSpeed}
                                      </div>
                                      <div className='text-orange-600 dark:text-orange-400 font-medium text-xs'>
                                        {videoInfo.pingTime}ms
                                      </div>
                                    </div>
                                  );
                                } else {
                                  return (
                                    <div className='text-red-500/90 dark:text-red-400 font-medium text-xs'>
                                      無測速數據
                                    </div>
                                  ); // 佔位div
                                }
                              }
                            })()}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                <div className='flex-shrink-0 mt-auto pt-2 border-t border-gray-400 dark:border-gray-700'>
                  <button
                    onClick={() => {
                      if (videoTitle) {
                        router.push(
                          `/search?q=${encodeURIComponent(videoTitle)}`
                        );
                      }
                    }}
                    className='w-full text-center text-xs text-gray-500 dark:text-gray-400 hover:text-green-500 dark:hover:text-green-400 transition-colors py-2'
                  >
                    影片匹配有誤？點擊去搜索
                  </button>
                </div>
              </div>
            )}
        </div>
      )}
    </div>
  );
};

export default EpisodeSelector;
