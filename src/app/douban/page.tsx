/* eslint-disable no-console,react-hooks/exhaustive-deps,@typescript-eslint/no-explicit-any */

'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { GetBangumiCalendarData } from '@/lib/bangumi.client';
import { getCustomCategories } from '@/lib/config.client';
import {
  getDoubanCategories,
  getDoubanList,
  getDoubanRecommends,
} from '@/lib/douban.client';
import { DoubanItem, DoubanResult } from '@/lib/types';

import DoubanCardSkeleton from '@/components/DoubanCardSkeleton';
import DoubanCustomSelector from '@/components/DoubanCustomSelector';
import DoubanSelector from '@/components/DoubanSelector';
import PageLayout from '@/components/PageLayout';
import VideoCard from '@/components/VideoCard';

function DoubanPageClient() {
  const searchParams = useSearchParams();
  const [doubanData, setDoubanData] = useState<DoubanItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [selectorsReady, setSelectorsReady] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadingRef = useRef<HTMLDivElement>(null);
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 用於存儲最新參數值的 refs
  const currentParamsRef = useRef({
    type: '',
    primarySelection: '',
    secondarySelection: '',
    multiLevelSelection: {} as Record<string, string>,
    selectedWeekday: '',
    currentPage: 0,
  });

  const type = searchParams.get('type') || 'movie';

  // 獲取 runtimeConfig 中的自定義分類數據
  const [customCategories, setCustomCategories] = useState<
    Array<{ name: string; type: 'movie' | 'tv'; query: string }>
  >([]);

  // 選擇器狀態 - 完全獨立，不依賴URL參數
  const [primarySelection, setPrimarySelection] = useState<string>(() => {
    if (type === 'movie') return '熱門';
    if (type === 'tv' || type === 'show') return '最近熱門';
    if (type === 'anime') return '每日放送';
    return '';
  });
  const [secondarySelection, setSecondarySelection] = useState<string>(() => {
    if (type === 'movie') return '全部';
    if (type === 'tv') return 'tv';
    if (type === 'show') return 'show';
    return '全部';
  });

  // MultiLevelSelector 狀態
  const [multiLevelValues, setMultiLevelValues] = useState<
    Record<string, string>
  >({
    type: 'all',
    region: 'all',
    year: 'all',
    platform: 'all',
    label: 'all',
    sort: 'T',
  });

  // 星期選擇器狀態
  const [selectedWeekday, setSelectedWeekday] = useState<string>('');

  // 獲取自定義分類數據
  useEffect(() => {
    getCustomCategories().then((categories) => {
      setCustomCategories(categories);
    });
  }, []);

  // 同步最新參數值到 ref
  useEffect(() => {
    currentParamsRef.current = {
      type,
      primarySelection,
      secondarySelection,
      multiLevelSelection: multiLevelValues,
      selectedWeekday,
      currentPage,
    };
  }, [
    type,
    primarySelection,
    secondarySelection,
    multiLevelValues,
    selectedWeekday,
    currentPage,
  ]);

  // 初始化時標記選擇器為準備好狀態
  useEffect(() => {
    // 短暫延遲確保初始狀態設置完成
    const timer = setTimeout(() => {
      setSelectorsReady(true);
    }, 50);

    return () => clearTimeout(timer);
  }, []); // 只在組件掛載時執行一次

  // type變化時立即重置selectorsReady（最高優先級）
  useEffect(() => {
    setSelectorsReady(false);
    setLoading(true); // 立即顯示loading狀態
  }, [type]);

  // 當type變化時重置選擇器狀態
  useEffect(() => {
    if (type === 'custom' && customCategories.length > 0) {
      // 自定義分類模式：優先選擇 movie，如果沒有 movie 則選擇 tv
      const types = Array.from(
        new Set(customCategories.map((cat) => cat.type))
      );
      if (types.length > 0) {
        // 優先選擇 movie，如果沒有 movie 則選擇 tv
        let selectedType = types[0]; // 默認選擇第一個
        if (types.includes('movie')) {
          selectedType = 'movie';
        } else {
          selectedType = 'tv';
        }
        setPrimarySelection(selectedType);

        // 設置選中類型的第一個分類的 query 作為二級選擇
        const firstCategory = customCategories.find(
          (cat) => cat.type === selectedType
        );
        if (firstCategory) {
          setSecondarySelection(firstCategory.query);
        }
      }
    } else {
      // 原有邏輯
      if (type === 'movie') {
        setPrimarySelection('熱門');
        setSecondarySelection('全部');
      } else if (type === 'tv') {
        setPrimarySelection('最近熱門');
        setSecondarySelection('tv');
      } else if (type === 'show') {
        setPrimarySelection('最近熱門');
        setSecondarySelection('show');
      } else if (type === 'anime') {
        setPrimarySelection('每日放送');
        setSecondarySelection('全部');
      } else {
        setPrimarySelection('');
        setSecondarySelection('全部');
      }
    }

    // 清空 MultiLevelSelector 狀態
    setMultiLevelValues({
      type: 'all',
      region: 'all',
      year: 'all',
      platform: 'all',
      label: 'all',
      sort: 'T',
    });

    // 使用短暫延遲確保狀態更新完成後標記選擇器準備好
    const timer = setTimeout(() => {
      setSelectorsReady(true);
    }, 50);

    return () => clearTimeout(timer);
  }, [type, customCategories]);

  // 生成骨架屏數據
  const skeletonData = Array.from({ length: 25 }, (_, index) => index);

  // 參數快照比較函數
  const isSnapshotEqual = useCallback(
    (
      snapshot1: {
        type: string;
        primarySelection: string;
        secondarySelection: string;
        multiLevelSelection: Record<string, string>;
        selectedWeekday: string;
        currentPage: number;
      },
      snapshot2: {
        type: string;
        primarySelection: string;
        secondarySelection: string;
        multiLevelSelection: Record<string, string>;
        selectedWeekday: string;
        currentPage: number;
      }
    ) => {
      return (
        snapshot1.type === snapshot2.type &&
        snapshot1.primarySelection === snapshot2.primarySelection &&
        snapshot1.secondarySelection === snapshot2.secondarySelection &&
        snapshot1.selectedWeekday === snapshot2.selectedWeekday &&
        snapshot1.currentPage === snapshot2.currentPage &&
        JSON.stringify(snapshot1.multiLevelSelection) ===
          JSON.stringify(snapshot2.multiLevelSelection)
      );
    },
    []
  );

  // 生成API請求參數的輔助函數
  const getRequestParams = useCallback(
    (pageStart: number) => {
      // 當type為tv或show時，kind統一為'tv'，category使用type本身
      if (type === 'tv' || type === 'show') {
        return {
          kind: 'tv' as const,
          category: type,
          type: secondarySelection,
          pageLimit: 25,
          pageStart,
        };
      }

      // 電影類型保持原邏輯
      return {
        kind: type as 'tv' | 'movie',
        category: primarySelection,
        type: secondarySelection,
        pageLimit: 25,
        pageStart,
      };
    },
    [type, primarySelection, secondarySelection]
  );

  // 防抖的數據加載函數
  const loadInitialData = useCallback(async () => {
    // 創建當前參數的快照
    const requestSnapshot = {
      type,
      primarySelection,
      secondarySelection,
      multiLevelSelection: multiLevelValues,
      selectedWeekday,
      currentPage: 0,
    };

    try {
      setLoading(true);
      // 確保在加載初始數據時重置頁面狀態
      setDoubanData([]);
      setCurrentPage(0);
      setHasMore(true);
      setIsLoadingMore(false);

      let data: DoubanResult;

      if (type === 'custom') {
        // 自定義分類模式：根據選中的一級和二級選項獲取對應的分類
        const selectedCategory = customCategories.find(
          (cat) =>
            cat.type === primarySelection && cat.query === secondarySelection
        );

        if (selectedCategory) {
          data = await getDoubanList({
            tag: selectedCategory.query,
            type: selectedCategory.type,
            pageLimit: 25,
            pageStart: 0,
          });
        } else {
          throw new Error('沒有找到對應的分類');
        }
      } else if (type === 'anime' && primarySelection === '每日放送') {
        const calendarData = await GetBangumiCalendarData();
        const weekdayData = calendarData.find(
          (item) => item.weekday.en === selectedWeekday
        );
        if (weekdayData) {
          data = {
            code: 200,
            message: 'success',
            list: weekdayData.items.map((item) => ({
              id: item.id?.toString() || '',
              title: item.name_cn || item.name,
              poster:
                item.images.large ||
                item.images.common ||
                item.images.medium ||
                item.images.small ||
                item.images.grid,
              rate: item.rating?.score?.toString() || '',
              year: item.air_date?.split('-')?.[0] || '',
            })),
          };
        } else {
          throw new Error('沒有找到對應的日期');
        }
      } else if (type === 'anime') {
        data = await getDoubanRecommends({
          kind: primarySelection === '番劇' ? 'tv' : 'movie',
          pageLimit: 25,
          pageStart: 0,
          category: '動畫',
          format: primarySelection === '番劇' ? '電視劇' : '',
          region: multiLevelValues.region
            ? (multiLevelValues.region as string)
            : '',
          year: multiLevelValues.year ? (multiLevelValues.year as string) : '',
          platform: multiLevelValues.platform
            ? (multiLevelValues.platform as string)
            : '',
          sort: multiLevelValues.sort ? (multiLevelValues.sort as string) : '',
          label: multiLevelValues.label
            ? (multiLevelValues.label as string)
            : '',
        });
      } else if (primarySelection === '全部') {
        data = await getDoubanRecommends({
          kind: type === 'show' ? 'tv' : (type as 'tv' | 'movie'),
          pageLimit: 25,
          pageStart: 0, // 初始數據加載始終從第一頁開始
          category: multiLevelValues.type
            ? (multiLevelValues.type as string)
            : '',
          format: type === 'show' ? '綜藝' : type === 'tv' ? '電視劇' : '',
          region: multiLevelValues.region
            ? (multiLevelValues.region as string)
            : '',
          year: multiLevelValues.year ? (multiLevelValues.year as string) : '',
          platform: multiLevelValues.platform
            ? (multiLevelValues.platform as string)
            : '',
          sort: multiLevelValues.sort ? (multiLevelValues.sort as string) : '',
          label: multiLevelValues.label
            ? (multiLevelValues.label as string)
            : '',
        });
      } else {
        data = await getDoubanCategories(getRequestParams(0));
      }

      if (data.code === 200) {
        // 檢查參數是否仍然一致，如果一致才設置數據
        // 使用 ref 獲取最新的當前值
        const currentSnapshot = { ...currentParamsRef.current };

        if (isSnapshotEqual(requestSnapshot, currentSnapshot)) {
          setDoubanData(data.list);
          setHasMore(data.list.length !== 0);
          setLoading(false);
        } else {
          console.log('參數不一致，不執行任何操作，避免設置過期數據');
        }
        // 如果參數不一致，不執行任何操作，避免設置過期數據
      } else {
        throw new Error(data.message || '獲取數據失敗');
      }
    } catch (err) {
      console.error(err);
      setLoading(false); // 發生錯誤時總是停止loading狀態
    }
  }, [
    type,
    primarySelection,
    secondarySelection,
    multiLevelValues,
    selectedWeekday,
    getRequestParams,
    customCategories,
  ]);

  // 只在選擇器準備好後才加載數據
  useEffect(() => {
    // 只有在選擇器準備好時才開始加載
    if (!selectorsReady) {
      return;
    }

    // 清除之前的防抖定時器
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    // 使用防抖機制加載數據，避免連續狀態更新觸發多次請求
    debounceTimeoutRef.current = setTimeout(() => {
      loadInitialData();
    }, 100); // 100ms 防抖延遲

    // 清理函數
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, [
    selectorsReady,
    type,
    primarySelection,
    secondarySelection,
    multiLevelValues,
    selectedWeekday,
    loadInitialData,
  ]);

  // 單獨處理 currentPage 變化（加載更多）
  useEffect(() => {
    if (currentPage > 0) {
      const fetchMoreData = async () => {
        // 創建當前參數的快照
        const requestSnapshot = {
          type,
          primarySelection,
          secondarySelection,
          multiLevelSelection: multiLevelValues,
          selectedWeekday,
          currentPage,
        };

        try {
          setIsLoadingMore(true);

          let data: DoubanResult;
          if (type === 'custom') {
            // 自定義分類模式：根據選中的一級和二級選項獲取對應的分類
            const selectedCategory = customCategories.find(
              (cat) =>
                cat.type === primarySelection &&
                cat.query === secondarySelection
            );

            if (selectedCategory) {
              data = await getDoubanList({
                tag: selectedCategory.query,
                type: selectedCategory.type,
                pageLimit: 25,
                pageStart: currentPage * 25,
              });
            } else {
              throw new Error('沒有找到對應的分類');
            }
          } else if (type === 'anime' && primarySelection === '每日放送') {
            // 每日放送模式下，不進行數據請求，返回空數據
            data = {
              code: 200,
              message: 'success',
              list: [],
            };
          } else if (type === 'anime') {
            data = await getDoubanRecommends({
              kind: primarySelection === '番劇' ? 'tv' : 'movie',
              pageLimit: 25,
              pageStart: currentPage * 25,
              category: '動畫',
              format: primarySelection === '番劇' ? '電視劇' : '',
              region: multiLevelValues.region
                ? (multiLevelValues.region as string)
                : '',
              year: multiLevelValues.year
                ? (multiLevelValues.year as string)
                : '',
              platform: multiLevelValues.platform
                ? (multiLevelValues.platform as string)
                : '',
              sort: multiLevelValues.sort
                ? (multiLevelValues.sort as string)
                : '',
              label: multiLevelValues.label
                ? (multiLevelValues.label as string)
                : '',
            });
          } else if (primarySelection === '全部') {
            data = await getDoubanRecommends({
              kind: type === 'show' ? 'tv' : (type as 'tv' | 'movie'),
              pageLimit: 25,
              pageStart: currentPage * 25,
              category: multiLevelValues.type
                ? (multiLevelValues.type as string)
                : '',
              format: type === 'show' ? '綜藝' : type === 'tv' ? '電視劇' : '',
              region: multiLevelValues.region
                ? (multiLevelValues.region as string)
                : '',
              year: multiLevelValues.year
                ? (multiLevelValues.year as string)
                : '',
              platform: multiLevelValues.platform
                ? (multiLevelValues.platform as string)
                : '',
              sort: multiLevelValues.sort
                ? (multiLevelValues.sort as string)
                : '',
              label: multiLevelValues.label
                ? (multiLevelValues.label as string)
                : '',
            });
          } else {
            data = await getDoubanCategories(
              getRequestParams(currentPage * 25)
            );
          }

          if (data.code === 200) {
            // 檢查參數是否仍然一致，如果一致才設置數據
            // 使用 ref 獲取最新的當前值
            const currentSnapshot = { ...currentParamsRef.current };

            if (isSnapshotEqual(requestSnapshot, currentSnapshot)) {
              setDoubanData((prev) => [...prev, ...data.list]);
              setHasMore(data.list.length !== 0);
            } else {
              console.log('參數不一致，不執行任何操作，避免設置過期數據');
            }
          } else {
            throw new Error(data.message || '獲取數據失敗');
          }
        } catch (err) {
          console.error(err);
        } finally {
          setIsLoadingMore(false);
        }
      };

      fetchMoreData();
    }
  }, [
    currentPage,
    type,
    primarySelection,
    secondarySelection,
    customCategories,
    multiLevelValues,
    selectedWeekday,
  ]);

  // 設置滾動監聽
  useEffect(() => {
    // 如果沒有更多數據或正在加載，則不設置監聽
    if (!hasMore || isLoadingMore || loading) {
      return;
    }

    // 確保 loadingRef 存在
    if (!loadingRef.current) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoadingMore) {
          setCurrentPage((prev) => prev + 1);
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(loadingRef.current);
    observerRef.current = observer;

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [hasMore, isLoadingMore, loading]);

  // 處理選擇器變化
  const handlePrimaryChange = useCallback(
    (value: string) => {
      // 只有當值真正改變時才設置loading狀態
      if (value !== primarySelection) {
        setLoading(true);
        // 立即重置頁面狀態，防止基於舊狀態的請求
        setCurrentPage(0);
        setDoubanData([]);
        setHasMore(true);
        setIsLoadingMore(false);

        // 清空 MultiLevelSelector 狀態
        setMultiLevelValues({
          type: 'all',
          region: 'all',
          year: 'all',
          platform: 'all',
          label: 'all',
          sort: 'T',
        });

        // 如果是自定義分類模式，同時更新一級和二級選擇器
        if (type === 'custom' && customCategories.length > 0) {
          const firstCategory = customCategories.find(
            (cat) => cat.type === value
          );
          if (firstCategory) {
            // 批量更新狀態，避免多次觸發數據加載
            setPrimarySelection(value);
            setSecondarySelection(firstCategory.query);
          } else {
            setPrimarySelection(value);
          }
        } else {
          // 電視劇和綜藝切換到"最近熱門"時，重置二級分類為第一個選項
          if ((type === 'tv' || type === 'show') && value === '最近熱門') {
            setPrimarySelection(value);
            if (type === 'tv') {
              setSecondarySelection('tv');
            } else if (type === 'show') {
              setSecondarySelection('show');
            }
          } else {
            setPrimarySelection(value);
          }
        }
      }
    },
    [primarySelection, type, customCategories]
  );

  const handleSecondaryChange = useCallback(
    (value: string) => {
      // 只有當值真正改變時才設置loading狀態
      if (value !== secondarySelection) {
        setLoading(true);
        // 立即重置頁面狀態，防止基於舊狀態的請求
        setCurrentPage(0);
        setDoubanData([]);
        setHasMore(true);
        setIsLoadingMore(false);
        setSecondarySelection(value);
      }
    },
    [secondarySelection]
  );

  const handleMultiLevelChange = useCallback(
    (values: Record<string, string>) => {
      // 比較兩個對象是否相同，忽略順序
      const isEqual = (
        obj1: Record<string, string>,
        obj2: Record<string, string>
      ) => {
        const keys1 = Object.keys(obj1).sort();
        const keys2 = Object.keys(obj2).sort();

        if (keys1.length !== keys2.length) return false;

        return keys1.every((key) => obj1[key] === obj2[key]);
      };

      // 如果相同，則不設置loading狀態
      if (isEqual(values, multiLevelValues)) {
        return;
      }

      setLoading(true);
      // 立即重置頁面狀態，防止基於舊狀態的請求
      setCurrentPage(0);
      setDoubanData([]);
      setHasMore(true);
      setIsLoadingMore(false);
      setMultiLevelValues(values);
    },
    [multiLevelValues]
  );

  const handleWeekdayChange = useCallback((weekday: string) => {
    setSelectedWeekday(weekday);
  }, []);

  const getPageTitle = () => {
    // 根據 type 生成標題
    return type === 'movie'
      ? '電影'
      : type === 'tv'
      ? '電視劇'
      : type === 'anime'
      ? '動漫'
      : type === 'show'
      ? '綜藝'
      : '自定義';
  };

  const getPageDescription = () => {
    if (type === 'anime' && primarySelection === '每日放送') {
      return '來自 Bangumi 番組計劃的精選內容';
    }
    return '來自豆瓣的精選內容';
  };

  const getActivePath = () => {
    const params = new URLSearchParams();
    if (type) params.set('type', type);

    const queryString = params.toString();
    const activePath = `/douban${queryString ? `?${queryString}` : ''}`;
    return activePath;
  };

  return (
    <PageLayout activePath={getActivePath()}>
      <div className='px-4 sm:px-10 py-4 sm:py-8 overflow-visible'>
        {/* 頁面標題和選擇器 */}
        <div className='mb-6 sm:mb-8 space-y-4 sm:space-y-6'>
          {/* 頁面標題 */}
          <div>
            <h1 className='text-2xl sm:text-3xl font-bold text-gray-800 mb-1 sm:mb-2 dark:text-gray-200'>
              {getPageTitle()}
            </h1>
            <p className='text-sm sm:text-base text-gray-600 dark:text-gray-400'>
              {getPageDescription()}
            </p>
          </div>

          {/* 選擇器組件 */}
          {type !== 'custom' ? (
            <div className='bg-white/60 dark:bg-gray-800/40 rounded-2xl p-4 sm:p-6 border border-gray-200/30 dark:border-gray-700/30 backdrop-blur-sm'>
              <DoubanSelector
                type={type as 'movie' | 'tv' | 'show' | 'anime'}
                primarySelection={primarySelection}
                secondarySelection={secondarySelection}
                onPrimaryChange={handlePrimaryChange}
                onSecondaryChange={handleSecondaryChange}
                onMultiLevelChange={handleMultiLevelChange}
                onWeekdayChange={handleWeekdayChange}
              />
            </div>
          ) : (
            <div className='bg-white/60 dark:bg-gray-800/40 rounded-2xl p-4 sm:p-6 border border-gray-200/30 dark:border-gray-700/30 backdrop-blur-sm'>
              <DoubanCustomSelector
                customCategories={customCategories}
                primarySelection={primarySelection}
                secondarySelection={secondarySelection}
                onPrimaryChange={handlePrimaryChange}
                onSecondaryChange={handleSecondaryChange}
              />
            </div>
          )}
        </div>

        {/* 內容展示區域 */}
        <div className='max-w-[95%] mx-auto mt-8 overflow-visible'>
          {/* 內容網格 */}
          <div className='justify-start grid grid-cols-3 gap-x-2 gap-y-12 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))] sm:gap-x-8 sm:gap-y-20'>
            {loading || !selectorsReady
              ? // 顯示骨架屏
                skeletonData.map((index) => <DoubanCardSkeleton key={index} />)
              : // 顯示實際數據
                doubanData.map((item, index) => (
                  <div key={`${item.title}-${index}`} className='w-full'>
                    <VideoCard
                      from='douban'
                      title={item.title}
                      poster={item.poster}
                      douban_id={Number(item.id)}
                      rate={item.rate}
                      year={item.year}
                      type={type === 'movie' ? 'movie' : ''} // 電影類型嚴格控制，tv 不控
                      isBangumi={
                        type === 'anime' && primarySelection === '每日放送'
                      }
                    />
                  </div>
                ))}
          </div>

          {/* 加載更多指示器 */}
          {hasMore && !loading && (
            <div
              ref={(el) => {
                if (el && el.offsetParent !== null) {
                  (
                    loadingRef as React.MutableRefObject<HTMLDivElement | null>
                  ).current = el;
                }
              }}
              className='flex justify-center mt-12 py-8'
            >
              {isLoadingMore && (
                <div className='flex items-center gap-2'>
                  <div className='animate-spin rounded-full h-6 w-6 border-b-2 border-green-500'></div>
                  <span className='text-gray-600'>加載中...</span>
                </div>
              )}
            </div>
          )}

          {/* 沒有更多數據提示 */}
          {!hasMore && doubanData.length > 0 && (
            <div className='text-center text-gray-500 py-8'>已加載全部內容</div>
          )}

          {/* 空狀態 */}
          {!loading && doubanData.length === 0 && (
            <div className='text-center text-gray-500 py-8'>暫無相關內容</div>
          )}
        </div>
      </div>
    </PageLayout>
  );
}

export default function DoubanPage() {
  return (
    <Suspense>
      <DoubanPageClient />
    </Suspense>
  );
}
