/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, no-console */

'use client';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { Suspense, useEffect, useRef, useState } from 'react';

import {
  BangumiCalendarData,
  GetBangumiCalendarData,
} from '@/lib/bangumi.client';
// 客戶端收藏 API
import {
  clearAllFavorites,
  FollowingRefreshItem,
  getAllFavorites,
  getAllFollowings,
  getAllPlayRecords,
  getTodayUpdated,
  refreshFollowingsStream,
  saveTodayUpdated,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { getDoubanCategories } from '@/lib/douban.client';
import {
  buildPlayRecordTitleIndex,
  computeUnwatchedEpisodes,
} from '@/lib/following';
import { getSwal } from '@/lib/sweetalert';
import { DoubanItem, SearchResult } from '@/lib/types';

import CapsuleSwitch from '@/components/CapsuleSwitch';
import ContinueWatching from '@/components/ContinueWatching';
import { useNavigationLoading } from '@/components/NavigationLoadingProvider';
import PageLayout from '@/components/PageLayout';
import ScrollableRow from '@/components/ScrollableRow';
import { useSite } from '@/components/SiteProvider';
import VideoCard from '@/components/VideoCard';

function HomeClient() {
  const [activeTab, setActiveTab] = useState<
    'home' | 'history' | 'following' | 'favorites'
  >('home');
  const [hotMovies, setHotMovies] = useState<DoubanItem[]>([]);
  const [hotMoviesLoading, setHotMoviesLoading] = useState(true);
  const [hotTvShows, setHotTvShows] = useState<DoubanItem[]>([]);
  const [hotTvShowsLoading, setHotTvShowsLoading] = useState(true);
  const [hotVarietyShows, setHotVarietyShows] = useState<DoubanItem[]>([]);
  const [adultRecommendations, setAdultRecommendations] = useState<
    SearchResult[]
  >([]);
  const [adultRefreshKey, setAdultRefreshKey] = useState('');
  const [hotVarietyShowsLoading, setHotVarietyShowsLoading] = useState(true);
  const [bangumiCalendarData, setBangumiCalendarData] = useState<
    BangumiCalendarData[]
  >([]);
  const [bangumiCalendarLoading, setBangumiCalendarLoading] = useState(true);
  const { announcement } = useSite();
  const { startLoading } = useNavigationLoading();

  const [showAnnouncement, setShowAnnouncement] = useState(false);

  // 檢查是否啟用簡潔模式
  const [simpleMode, setSimpleMode] = useState(false);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
    if (typeof window !== 'undefined') {
      const savedSimpleMode = localStorage.getItem('simpleMode');
      if (savedSimpleMode !== null) {
        try {
          setSimpleMode(JSON.parse(savedSimpleMode));
        } catch {
          setSimpleMode(false);
        }
      }
    }
  }, []);

  // 檢查公告彈窗狀態
  useEffect(() => {
    if (typeof window !== 'undefined' && announcement) {
      const hasSeenAnnouncement = localStorage.getItem('hasSeenAnnouncement');
      if (hasSeenAnnouncement !== announcement) {
        setShowAnnouncement(true);
      } else {
        setShowAnnouncement(Boolean(!hasSeenAnnouncement && announcement));
      }
    }
  }, [announcement]);

  // 收藏夾數據
  type FavoriteItem = {
    id: string;
    source: string;
    title: string;
    poster: string;
    episodes: number;
    source_name: string;
    currentEpisode?: number;
    search_title?: string;
  };

  const [favoriteItems, setFavoriteItems] = useState<FavoriteItem[]>([]);
  const [favoriteLoading, setFavoriteLoading] = useState(false);

  type FollowingItem = {
    id: string;
    source: string;
    title: string;
    poster: string;
    episodes: number;
    watchedEpisodes: number;
    unwatchedEpisodes: number;
    source_name: string;
    year: string;
    search_title?: string;
    save_time: number;
  };

  const [followingItems, setFollowingItems] = useState<FollowingItem[]>([]);
  const [followingListLoading, setFollowingListLoading] = useState(false);
  const [followingUpdatesLoading, setFollowingUpdatesLoading] = useState(false);
  const latestPlayRecordsRef = useRef<Record<string, any>>({});

  // 追更集數刷新進度（流式）
  const [refreshProgress, setRefreshProgress] = useState<{
    total: number;
    success: number;
    failed: number;
    updated: number;
    running: boolean;
  }>({ total: 0, success: 0, failed: 0, updated: 0, running: false });
  const refreshProgressRef = useRef({
    total: 0,
    success: 0,
    failed: 0,
    updated: 0,
    running: false,
  });
  const [, setRefreshFailedItems] = useState<FollowingRefreshItem[]>([]);
  const refreshFailedRef = useRef<FollowingRefreshItem[]>([]);
  // 本輪刷新中「集數有更新」的追更條目（今日有新集數，頁面展示）
  type TodayUpdatedItem = FollowingItem & {
    oldEpisodes: number;
    newEpisodes: number;
  };
  const [todayUpdatedItems, setTodayUpdatedItems] = useState<
    TodayUpdatedItem[]
  >([]);
  const todayUpdatedRef = useRef<TodayUpdatedItem[]>([]);
  // 記錄「今日新更」列表當前所屬日期，用於跨天時自動清空
  const todayUpdatedDateRef = useRef<string>('');
  // 將「今日新更」列表持久化到服務端（保留一天、跟隨賬號跨設備）
  const todayUpdatedPersistRef = useRef<Promise<void>>(Promise.resolve());
  const persistTodayUpdated = async (items: TodayUpdatedItem[]) => {
    const snapshot = items.map((item) => ({ ...item }));
    try {
      const now = new Date();
      const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
        2,
        '0'
      )}-${String(now.getDate()).padStart(2, '0')}`;
      const pending = todayUpdatedPersistRef.current
        .catch(() => undefined)
        .then(() => saveTodayUpdated({ date, items: snapshot }));
      todayUpdatedPersistRef.current = pending;
      await pending;
    } catch (err) {
      console.error('持久化「今日新更」記錄失敗:', err);
    }
  };
  // 當前完整追更工作列表（隨流式結果實時更新），供重試失敗項時取最新數據
  const latestFollowingsRef = useRef<Record<string, any>>({});
  // 本次網頁會話是否已自動刷新過追更（網頁加載後僅第一次進入追更頁自動刷新一次）
  const hasAutoRefreshedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const loadRecommendData = async () => {
      const savedSimpleMode = localStorage.getItem('simpleMode');
      let isSimpleMode = false;
      if (savedSimpleMode) {
        try {
          isSimpleMode = JSON.parse(savedSimpleMode);
        } catch {
          isSimpleMode = false;
        }
      }

      if (isSimpleMode) {
        if (cancelled) return;
        setHotMoviesLoading(false);
        setHotTvShowsLoading(false);
        setHotVarietyShowsLoading(false);
        setBangumiCalendarLoading(false);
        return;
      }

      void fetch('/api/adult/recommends?limit=24')
        .then((response) => (response.ok ? response.json() : { list: [] }))
        .then((data) => {
          if (cancelled) return;
          setAdultRecommendations(Array.isArray(data.list) ? data.list : []);
          setAdultRefreshKey(data.refreshKey || '');
        })
        .catch(() => {
          if (cancelled) return;
          setAdultRecommendations([]);
          setAdultRefreshKey('');
        });

      setHotMoviesLoading(true);
      setHotTvShowsLoading(true);
      setHotVarietyShowsLoading(true);
      setBangumiCalendarLoading(true);

      void (async () => {
        try {
          const moviesData = await getDoubanCategories({
            kind: 'movie',
            category: '熱門',
            type: '全部',
          });
          if (
            !cancelled &&
            moviesData?.code === 200 &&
            Array.isArray(moviesData.list)
          ) {
            setHotMovies(moviesData.list);
          }
        } catch (error) {
          console.error('獲取熱門電影失敗:', error);
        } finally {
          if (!cancelled) setHotMoviesLoading(false);
        }
      })();

      void (async () => {
        try {
          const tvShowsData = await getDoubanCategories({
            kind: 'tv',
            category: 'tv',
            type: 'tv',
          });
          if (
            !cancelled &&
            tvShowsData?.code === 200 &&
            Array.isArray(tvShowsData.list)
          ) {
            setHotTvShows(tvShowsData.list);
          }
        } catch (error) {
          console.error('獲取熱門劇集失敗:', error);
        } finally {
          if (!cancelled) setHotTvShowsLoading(false);
        }
      })();

      void (async () => {
        try {
          const varietyShowsData = await getDoubanCategories({
            kind: 'tv',
            category: 'show',
            type: 'show',
          });
          if (
            !cancelled &&
            varietyShowsData?.code === 200 &&
            Array.isArray(varietyShowsData.list)
          ) {
            setHotVarietyShows(varietyShowsData.list);
          }
        } catch (error) {
          console.error('獲取熱門綜藝失敗:', error);
        } finally {
          if (!cancelled) setHotVarietyShowsLoading(false);
        }
      })();

      void (async () => {
        try {
          const bangumiData = await GetBangumiCalendarData();
          if (!cancelled && Array.isArray(bangumiData)) {
            setBangumiCalendarData(bangumiData);
          }
        } catch (error) {
          console.error('獲取新番放送失敗:', error);
        } finally {
          if (!cancelled) setBangumiCalendarLoading(false);
        }
      })();
    };

    void loadRecommendData();

    return () => {
      cancelled = true;
    };
  }, []);

  // 處理收藏數據更新的函數
  const updateFavoriteItems = async (allFavorites: Record<string, any>) => {
    const allPlayRecords = (await getAllPlayRecords()) || {};

    // 根據保存時間排序（從近到遠）
    const sorted = Object.entries(allFavorites || {})
      .filter(([, fav]) => fav && typeof fav === 'object')
      .sort(([, a], [, b]) => (b.save_time || 0) - (a.save_time || 0))
      .map(([key, fav]) => {
        const plusIndex = key.indexOf('+');
        const source = key.slice(0, plusIndex);
        const id = key.slice(plusIndex + 1);

        // 查找對應的播放記錄，獲取當前集數
        const playRecord = allPlayRecords[key];
        const currentEpisode = playRecord?.index;

        return {
          id,
          source,
          title: fav.title,
          year: fav.year,
          poster: fav.cover,
          episodes: fav.total_episodes,
          source_name: fav.source_name,
          currentEpisode,
          search_title: fav?.search_title,
        } as FavoriteItem;
      });
    setFavoriteItems(sorted);
  };

  const updateFollowingItems = async (
    allFollowings: Record<string, any>,
    providedPlayRecords?: Record<string, any>
  ) => {
    const allPlayRecords =
      providedPlayRecords ??
      latestPlayRecordsRef.current ??
      (await getAllPlayRecords()) ??
      {};
    latestPlayRecordsRef.current = allPlayRecords;

    // 按標題索引播放記錄，優先按標題匹配「當前播放集數/總集數」，
    // 解決用戶換片源觀看後追更 key(source+id) 與播放記錄 key 對不上而取不到的問題。
    const playRecordTitleIndex = buildPlayRecordTitleIndex(allPlayRecords);

    const sorted = Object.entries(allFollowings || {})
      .filter(([, item]) => item && typeof item === 'object')
      .sort(([, a], [, b]) => (b.save_time || 0) - (a.save_time || 0))
      .map(([key, item]) => {
        const plusIndex = key.indexOf('+');
        const source = key.slice(0, plusIndex);
        const id = key.slice(plusIndex + 1);
        // 匹配順序：先按追更標題精確命中最新播放記錄，未命中再回退 source+id 直查
        const matchedPlayRecord =
          playRecordTitleIndex.get(item.title) ?? allPlayRecords[key];
        const watchedEpisodes =
          matchedPlayRecord?.index ?? item.watched_episodes ?? 0;
        const totalEpisodes =
          item.total_episodes || matchedPlayRecord?.total_episodes || 1;
        const unwatchedEpisodes = computeUnwatchedEpisodes({
          totalEpisodes,
          watchedEpisodes,
        });

        return {
          id,
          source,
          title: item.title,
          poster: item.cover,
          episodes: totalEpisodes,
          watchedEpisodes,
          unwatchedEpisodes,
          source_name: item.source_name,
          year: item.year && item.year !== 'unknown' ? item.year : '',
          search_title:
            item.search_title && item.search_title !== item.title
              ? item.search_title
              : '',
          save_time: item.save_time,
        } as FollowingItem;
      });
    setFollowingItems(sorted);
  };

  // 更新進度（同步 ref 與 state，避免異步競態）
  const updateProgress = (
    patch: Partial<typeof refreshProgressRef.current>
  ) => {
    refreshProgressRef.current = {
      ...refreshProgressRef.current,
      ...patch,
    };
    setRefreshProgress({ ...refreshProgressRef.current });
  };

  // 核心：對指定追更子集執行流式刷新，並實時更新 UI 與進度
  const runFollowingRefresh = async (
    targetFollowings: Record<string, any>,
    playRecords: Record<string, any>,
    isRetry: boolean
  ) => {
    const playRecordTitleIndex = buildPlayRecordTitleIndex(playRecords);
    const targetCount = Object.keys(targetFollowings).length;
    if (targetCount === 0) {
      updateProgress({
        total: 0,
        success: 0,
        failed: 0,
        updated: 0,
        running: false,
      });
      setFollowingItems([]);
      return;
    }

    // 完整工作列表：以當前最新完整列表為基礎
    const workingFollowings: Record<string, any> = {
      ...latestFollowingsRef.current,
    };
    // 確保目標項都在工作列表中（首次刷新時 latestFollowingsRef 可能為空）
    Object.entries(targetFollowings).forEach(([k, v]) => {
      if (!workingFollowings[k]) workingFollowings[k] = v;
    });
    latestFollowingsRef.current = workingFollowings;

    // 失敗列表每輪清空；「今日新更」僅跨天清空，同一天內再次刷新保留當天記錄
    refreshFailedRef.current = [];
    setRefreshFailedItems([]);
    const todayStr = new Date().toDateString();
    if (todayStr !== todayUpdatedDateRef.current) {
      todayUpdatedDateRef.current = todayStr;
      todayUpdatedRef.current = [];
      setTodayUpdatedItems([]);
      // 跨天清空服務端「今日新更」記錄
      persistTodayUpdated([]);
    }

    if (isRetry) {
      // 重試失敗項：總數保持與總追更數一致，success/updated 累加，failed 歸零重計
      updateProgress({ failed: 0, running: true });
    } else {
      // 全新一輪刷新：total = 總追更數，其余歸零
      const totalCount =
        Object.keys(latestFollowingsRef.current).length || targetCount;
      updateProgress({
        total: totalCount,
        success: 0,
        failed: 0,
        updated: 0,
        running: true,
      });
    }

    const applyItem = (key: string, totalEpisodes?: number, title?: string) => {
      const existing = workingFollowings[key];
      if (!existing) return;
      if (totalEpisodes && totalEpisodes > 0) {
        workingFollowings[key] = {
          ...existing,
          total_episodes: totalEpisodes,
          title: title || existing.title,
        };
        latestFollowingsRef.current = { ...workingFollowings };
      }
      // 實時刷新列表 UI（含「有新未觀看集數」與「全部追更」）
      updateFollowingItems(workingFollowings, playRecords);
    };

    try {
      await refreshFollowingsStream(
        targetFollowings,
        {
          // 僅在首次刷新時用服務端返回的總數校准（重試時保持 total 不變）
          onStart: (t) => {
            if (!isRetry && t) {
              updateProgress({ total: t });
            }
          },
          onItemResult: (item) => {
            // 記錄更新前的舊集數，用於展示「新更新了多少集」
            const oldEpisodes = workingFollowings[item.key]?.total_episodes;
            applyItem(item.key, item.total_episodes, item.title);
            if (item.updated) {
              const updated = workingFollowings[item.key];
              const plusIndex = item.key.indexOf('+');
              const source = item.key.slice(0, plusIndex);
              const id = item.key.slice(plusIndex + 1);
              const watchedEpisodes =
                playRecordTitleIndex.get(item.title || updated?.title)?.index ??
                playRecords[item.key]?.index ??
                updated?.watched_episodes ??
                0;
              const newEpisodes =
                item.total_episodes || updated?.total_episodes || 0;
              const entry: TodayUpdatedItem = {
                id,
                source,
                title: item.title || updated?.title || item.key,
                poster: updated?.cover || '',
                episodes: newEpisodes,
                watchedEpisodes,
                unwatchedEpisodes: computeUnwatchedEpisodes({
                  totalEpisodes: newEpisodes,
                  watchedEpisodes,
                }),
                source_name: updated?.source_name || '',
                year:
                  updated?.year && updated.year !== 'unknown'
                    ? updated.year
                    : '',
                save_time: updated?.save_time || 0,
                oldEpisodes: oldEpisodes || 0,
                newEpisodes,
              };
              // 合並進「今日新更」：同一影片已存在則更新其記錄，否則追加（保留一天）
              const existingIdx = todayUpdatedRef.current.findIndex(
                (e) => e.source === entry.source && e.id === entry.id
              );
              if (existingIdx >= 0) {
                todayUpdatedRef.current[existingIdx] = {
                  ...entry,
                  oldEpisodes: todayUpdatedRef.current[existingIdx].oldEpisodes,
                };
              } else {
                todayUpdatedRef.current = [...todayUpdatedRef.current, entry];
              }
              setTodayUpdatedItems([...todayUpdatedRef.current]);
              // 持久化到服務端（保留一天、跟隨賬號跨設備）
              persistTodayUpdated(todayUpdatedRef.current);
            }
            updateProgress({
              success: refreshProgressRef.current.success + 1,
              updated:
                refreshProgressRef.current.updated + (item.updated ? 1 : 0),
            });
          },
          onItemFailed: (item) => {
            refreshFailedRef.current = [...refreshFailedRef.current, item];
            setRefreshFailedItems(refreshFailedRef.current);
            updateProgress({
              failed: refreshProgressRef.current.failed + 1,
            });
          },
          onComplete: () => {
            // 成功/失敗/更新數已通過逐條事件累加，此處僅結束運行態
            updateProgress({ running: false });
            // 最終以服務端寫回後的完整列表為准
            updateFollowingItems(workingFollowings, playRecords);
          },
        },
        // 傳入完整工作列表作為廣播/緩存基礎：重試失敗項時 targetFollowings 僅為子集，
        // 若不傳完整列表，refreshFollowingsStream 會用子集覆蓋完整追更緩存與 UI，
        // 導致「全部追更」只剩失敗項。
        workingFollowings
      );
    } catch (error) {
      console.error('刷新追更失敗', error);
    } finally {
      updateProgress({ running: false });
    }
  };

  const refreshFollowingRecords = async (
    allFollowings?: Record<string, any>,
    allPlayRecords?: Record<string, any>
  ) => {
    const followings = allFollowings ?? (await getAllFollowings());
    const playRecords =
      allPlayRecords ??
      latestPlayRecordsRef.current ??
      (await getAllPlayRecords());
    latestPlayRecordsRef.current = playRecords;
    latestFollowingsRef.current = { ...followings };

    // 首次進入追更頁的全新一輪完整刷新：設置 total = 總追更數
    await runFollowingRefresh(followings, playRecords, false);
  };

  // 重試刷新失敗的追更項
  const retryFailedFollowings = async () => {
    const failed = refreshFailedRef.current;
    if (failed.length === 0) return;

    const playRecords =
      latestPlayRecordsRef.current ?? (await getAllPlayRecords());
    latestPlayRecordsRef.current = playRecords;

    // 從完整工作列表中取出失敗項的最新數據作為重試目標
    const retryTarget: Record<string, any> = {};
    failed.forEach((f) => {
      const latest = latestFollowingsRef.current[f.key];
      if (latest) retryTarget[f.key] = latest;
    });

    if (Object.keys(retryTarget).length === 0) return;
    // 重試失敗項：保持 total 與總追更數一致，success/updated 累加
    await runFollowingRefresh(retryTarget, playRecords, true);
  };

  // 手動刷新：重新讀取最新追更數據並執行一輪完整刷新
  const handleManualRefresh = async () => {
    if (refreshProgressRef.current.running) return;
    try {
      const allFollowings = await getAllFollowings();
      const allPlayRecords = await getAllPlayRecords();
      await refreshFollowingRecords(allFollowings, allPlayRecords);
    } catch (err) {
      console.error('手動刷新追更失敗', err);
    }
  };

  useEffect(() => {
    if (activeTab !== 'favorites') return;

    const loadFavorites = async () => {
      setFavoriteLoading(true);
      try {
        const allFavorites = await getAllFavorites();
        await updateFavoriteItems(allFavorites);
      } finally {
        setFavoriteLoading(false);
      }
    };

    loadFavorites();

    // 監聽收藏更新事件
    const unsubscribe = subscribeToDataUpdates(
      'favoritesUpdated',
      (newFavorites: Record<string, any>) => {
        updateFavoriteItems(newFavorites);
      }
    );

    return unsubscribe;
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'following') return;

    const loadFollowings = async () => {
      setFollowingListLoading(true);
      setFollowingUpdatesLoading(true);
      try {
        // 進入追更頁時以遠端 /api/followings 為准：若有本地緩存則先返回緩存用於立即展示，
        // 後台再以遠端覆蓋本地緩存（若不一致）；若無緩存則阻塞拉取遠端。
        const allFollowings = await getAllFollowings(true);
        const allPlayRecords = await getAllPlayRecords();
        latestPlayRecordsRef.current = allPlayRecords;

        // 從服務端恢復「今日新更」記錄（保留一天、跟隨賬號跨設備）
        try {
          const saved = await getTodayUpdated();
          const todayStr = new Date().toDateString();
          if (saved && saved.items && saved.items.length > 0) {
            // 僅當服務端記錄屬於今天時才恢復，否則視為跨天自動清空
            const savedDate = new Date(saved.date + 'T00:00:00');
            const isToday =
              savedDate.getFullYear() === new Date().getFullYear() &&
              savedDate.getMonth() === new Date().getMonth() &&
              savedDate.getDate() === new Date().getDate();
            if (isToday) {
              todayUpdatedDateRef.current = todayStr;
              todayUpdatedRef.current = saved.items as TodayUpdatedItem[];
              setTodayUpdatedItems([...todayUpdatedRef.current]);
            }
          }
        } catch (err) {
          console.error('恢復「今日新更」記錄失敗:', err);
        }

        // 先展示本地追更數據（緩存），避免「全部追更/有未觀看」被更新請求阻塞而顯示加載中
        await updateFollowingItems(allFollowings, allPlayRecords);
        setFollowingListLoading(false);
        setFollowingUpdatesLoading(false);

        // 網頁加載後僅第一次進入追更頁自動刷新一次，之後改為手動刷新。
        // 後台執行（不 await），讓界面先展示緩存數據，刷新完成後通過事件/回調更新。
        if (!hasAutoRefreshedRef.current) {
          hasAutoRefreshedRef.current = true;
          refreshFollowingRecords(allFollowings, allPlayRecords);
        }
      } finally {
        setFollowingListLoading(false);
        setFollowingUpdatesLoading(false);
      }
    };

    loadFollowings();

    const unsubscribe = subscribeToDataUpdates(
      'followingsUpdated',
      (newFollowings: Record<string, any>) => {
        latestFollowingsRef.current = { ...newFollowings };
        updateFollowingItems(newFollowings, latestPlayRecordsRef.current);

        // 取消追更後，同步移除「今日新更」中對應的條目並持久化
        const current = todayUpdatedRef.current;
        if (current.length > 0) {
          const kept = current.filter(
            (item) => !!newFollowings[`${item.source}+${item.id}`]
          );
          if (kept.length !== current.length) {
            todayUpdatedRef.current = kept;
            setTodayUpdatedItems([...kept]);
            persistTodayUpdated(kept);
          }
        }
      }
    );

    return unsubscribe;
  }, [activeTab]);

  const handleCloseAnnouncement = (announcement: string) => {
    setShowAnnouncement(false);
    localStorage.setItem('hasSeenAnnouncement', announcement); // 記錄已查看彈窗
  };

  // 點擊進度圓圈：展示刷新結果（成功/失敗明細），失敗時可重試
  const handleShowRefreshResult = async () => {
    const Swal = await getSwal();
    const failed = refreshFailedRef.current;
    const {
      success,
      failed: failedCount,
      updated,
      total,
      running,
    } = refreshProgress;

    const escapeHtml = (value: unknown) =>
      String(value ?? '').replace(
        /[&<>"']/g,
        (character) =>
          ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
          }[character] || character)
      );
    const failedHtml =
      failed.length > 0
        ? `<div class="mt-3 text-left max-h-60 overflow-y-auto rounded-lg bg-gray-100 dark:bg-gray-800 p-3">
             <div class="text-sm font-semibold mb-2 text-red-500">未成功獲取集數 (${
               failed.length
             })：</div>
             ${failed
               .map(
                 (f) =>
                   `<div class="flex items-start justify-between gap-2 py-1.5 text-xs border-b border-gray-200 dark:border-gray-700 last:border-0">
                      <div class="flex-1 min-w-0">
                        <div class="text-gray-700 dark:text-gray-300 truncate">${escapeHtml(
                          f.title || f.key
                        )}</div>
                        <div class="text-red-400 mt-0.5">原因：${escapeHtml(
                          f.reason || '未知'
                        )}</div>
                      </div>
                    </div>`
               )
               .join('')}
           </div>`
        : '';

    const canRetry = failed.length > 0 && !running;

    Swal.fire({
      title: running ? '正在刷新集數…' : '刷新結果',
      html: `
        <div class="text-sm text-gray-600 dark:text-gray-300">
          <div class="flex items-center justify-center gap-2 mb-2">
            ${
              running
                ? '<div class="animate-spin rounded-full h-4 w-4 border-b-2 border-green-500"></div>'
                : ''
            }
            <span>成功獲取 <b class="text-green-600">${success}</b> / ${total}</span>
          </div>
          <div class="text-xs text-gray-500 dark:text-gray-400">
            新更影片數：<b class="text-blue-600">${updated}</b> | 失敗：<b class="text-red-500">${failedCount}</b>
          </div>
        </div>
        ${failedHtml}
      `,
      icon: failedCount > 0 ? 'warning' : 'success',
      showCancelButton: canRetry,
      confirmButtonText: canRetry ? '重試失敗項' : '知道了',
      cancelButtonText: '關閉',
      confirmButtonColor: '#10b981',
      cancelButtonColor: '#6b7280',
    }).then((result) => {
      if (result.isConfirmed && canRetry) {
        retryFailedFollowings();
      }
    });
  };

  return (
    <PageLayout>
      <div className='px-2 sm:px-10 py-4 sm:py-8 overflow-visible'>
        {/* 頂部 Tab 切換 */}
        <div className='mb-8 flex justify-center'>
          <CapsuleSwitch
            options={
              simpleMode
                ? [
                    { label: '歷史', value: 'history' },
                    { label: '追更', value: 'following' },
                    { label: '收藏夾', value: 'favorites' },
                  ]
                : [
                    { label: '首頁', value: 'home' },
                    { label: '歷史', value: 'history' },
                    { label: '追更', value: 'following' },
                    { label: '收藏夾', value: 'favorites' },
                  ]
            }
            active={simpleMode && activeTab === 'home' ? 'history' : activeTab}
            onChange={(value) =>
              setActiveTab(
                value as 'home' | 'history' | 'following' | 'favorites'
              )
            }
          />
        </div>

        <div className='max-w-[95%] mx-auto'>
          {activeTab === 'history' ? (
            // 歷史視圖 - 顯示所有播放記錄的網格佈局
            <ContinueWatching showAll={true} />
          ) : activeTab === 'following' ? (
            <section className='mb-8'>
              <div className='mb-4 flex items-center justify-between'>
                <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
                  我的追更
                </h2>
                <div className='flex items-center gap-2'>
                  {/* 手動刷新按鈕 */}
                  <button
                    onClick={handleManualRefresh}
                    disabled={refreshProgress.running}
                    className='flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 shadow-sm transition-colors hover:border-green-400 hover:text-green-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-green-500 dark:hover:text-green-400'
                    title='手動刷新所有追更集數'
                  >
                    <svg
                      className={`h-3.5 w-3.5 ${
                        refreshProgress.running ? 'animate-spin' : ''
                      }`}
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      strokeWidth='2'
                      strokeLinecap='round'
                      strokeLinejoin='round'
                    >
                      <path d='M21 12a9 9 0 1 1-2.64-6.36' />
                      <polyline points='21 3 21 9 15 9' />
                    </svg>
                    <span>刷新</span>
                  </button>
                  {/* 刷新進度圓圈：顯示成功獲取集數個數，點擊查看明細/失敗列表 */}
                  {refreshProgress.total > 0 && (
                    <button
                      onClick={handleShowRefreshResult}
                      className='group flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 shadow-sm transition-colors hover:border-green-400 hover:text-green-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-green-500 dark:hover:text-green-400'
                      title='點擊查看刷新明細'
                    >
                      {refreshProgress.running ? (
                        <svg
                          className='h-4 w-4 animate-spin text-green-500'
                          viewBox='0 0 24 24'
                          fill='none'
                        >
                          <circle
                            className='opacity-25'
                            cx='12'
                            cy='12'
                            r='10'
                            stroke='currentColor'
                            strokeWidth='4'
                          />
                          <path
                            className='opacity-75'
                            fill='currentColor'
                            d='M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z'
                          />
                        </svg>
                      ) : (
                        <span
                          className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold text-white ${
                            refreshProgress.failed > 0
                              ? 'bg-amber-500'
                              : 'bg-green-500'
                          }`}
                        >
                          ✓
                        </span>
                      )}
                      <span>
                        成功 {refreshProgress.success}/{refreshProgress.total}
                      </span>
                      {refreshProgress.failed > 0 && (
                        <span className='text-red-500'>
                          ({refreshProgress.failed} 失敗)
                        </span>
                      )}
                    </button>
                  )}
                </div>
              </div>

              <div className='space-y-8'>
                <div>
                  <h3 className='mb-4 text-sm font-medium text-gray-600 dark:text-gray-300'>
                    今日新更
                  </h3>
                  {(followingUpdatesLoading || refreshProgress.running) &&
                  todayUpdatedItems.length === 0 ? (
                    <div className='flex justify-center py-8'>
                      <div className='flex items-center gap-2 text-gray-500 dark:text-gray-400'>
                        <div className='animate-spin rounded-full h-5 w-5 border-b-2 border-green-500'></div>
                        <span className='text-sm'>加載中...</span>
                      </div>
                    </div>
                  ) : todayUpdatedItems.length > 0 ? (
                    <div className='justify-start grid grid-cols-3 gap-x-2 gap-y-14 sm:gap-y-20 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8'>
                      {todayUpdatedItems.map((item) => (
                        <div
                          key={`${item.source}-${item.id}-updated`}
                          className='w-full'
                        >
                          <VideoCard
                            id={item.id}
                            title={item.title}
                            poster={item.poster}
                            year={
                              item.year && item.year !== 'unknown'
                                ? item.year
                                : ''
                            }
                            source={item.source}
                            source_name={item.source_name}
                            episodes={item.episodes}
                            currentEpisode={item.watchedEpisodes}
                            from='playrecord'
                            hideProgress
                            type={item.episodes > 1 ? 'tv' : ''}
                          />
                          <div className='mt-2 text-center text-xs font-medium text-green-600 dark:text-green-400'>
                            新更新 {item.newEpisodes - item.oldEpisodes} 集（
                            {item.oldEpisodes} → {item.newEpisodes}）
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className='text-center text-gray-500 py-6 dark:text-gray-400'>
                      暫無新集數更新
                    </div>
                  )}
                </div>

                <div>
                  <h3 className='mb-4 text-sm font-medium text-gray-600 dark:text-gray-300'>
                    有未觀看
                  </h3>
                  {(followingUpdatesLoading || refreshProgress.running) &&
                  followingItems.filter((item) => item.unwatchedEpisodes > 0)
                    .length === 0 ? (
                    <div className='flex justify-center py-8'>
                      <div className='flex items-center gap-2 text-gray-500 dark:text-gray-400'>
                        <div className='animate-spin rounded-full h-5 w-5 border-b-2 border-green-500'></div>
                        <span className='text-sm'>加載中...</span>
                      </div>
                    </div>
                  ) : followingItems.filter(
                      (item) => item.unwatchedEpisodes > 0
                    ).length > 0 ? (
                    <div className='justify-start grid grid-cols-3 gap-x-2 gap-y-14 sm:gap-y-20 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8'>
                      {followingItems
                        .filter((item) => item.unwatchedEpisodes > 0)
                        .map((item) => (
                          <div key={item.source + item.id} className='w-full'>
                            <VideoCard
                              id={item.id}
                              title={item.title}
                              poster={item.poster}
                              year={
                                item.year && item.year !== 'unknown'
                                  ? item.year
                                  : ''
                              }
                              source={item.source}
                              source_name={item.source_name}
                              episodes={item.episodes}
                              currentEpisode={item.watchedEpisodes}
                              from='playrecord'
                              hideProgress
                              type={item.episodes > 1 ? 'tv' : ''}
                            />
                            <div className='mt-2 text-center text-xs font-medium text-red-500 dark:text-red-400'>
                              還有 {item.unwatchedEpisodes} 集未看
                            </div>
                          </div>
                        ))}
                    </div>
                  ) : (
                    <div className='text-center text-gray-500 py-6 dark:text-gray-400'>
                      暫無未觀看
                    </div>
                  )}
                </div>

                <div>
                  <h3 className='mb-4 text-sm font-medium text-gray-600 dark:text-gray-300'>
                    全部追更
                  </h3>
                  {followingListLoading ? (
                    <div className='flex justify-center py-8'>
                      <div className='flex items-center gap-2 text-gray-500 dark:text-gray-400'>
                        <div className='animate-spin rounded-full h-5 w-5 border-b-2 border-green-500'></div>
                        <span className='text-sm'>加載中...</span>
                      </div>
                    </div>
                  ) : (
                    <div className='justify-start grid grid-cols-3 gap-x-2 gap-y-14 sm:gap-y-20 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8'>
                      {followingItems.map((item) => (
                        <div
                          key={`${item.source}-${item.id}-all`}
                          className='w-full'
                        >
                          <VideoCard
                            id={item.id}
                            title={item.title}
                            poster={item.poster}
                            year={
                              item.year && item.year !== 'unknown'
                                ? item.year
                                : ''
                            }
                            source={item.source}
                            source_name={item.source_name}
                            episodes={item.episodes}
                            currentEpisode={item.watchedEpisodes}
                            from='playrecord'
                            hideProgress
                            type={item.episodes > 1 ? 'tv' : ''}
                          />
                          <div className='mt-2 text-center text-xs text-gray-500 dark:text-gray-400'>
                            已看 {item.watchedEpisodes}/{item.episodes}
                          </div>
                        </div>
                      ))}
                      {followingItems.length === 0 && (
                        <div className='col-span-full text-center text-gray-500 py-8 dark:text-gray-400'>
                          暫無追更內容
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </section>
          ) : activeTab === 'favorites' ? (
            // 收藏夾視圖
            <section className='mb-8'>
              <div className='mb-4 flex items-center justify-between'>
                <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
                  我的收藏
                </h2>
                {favoriteItems.length > 0 && (
                  <button
                    className='text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                    onClick={async () => {
                      const Swal = await getSwal();
                      const { isConfirmed } = await Swal.fire({
                        title: '確認清空',
                        text: '確定要清空所有收藏嗎？',
                        icon: 'warning',
                        showCancelButton: true,
                        confirmButtonText: '確定',
                        cancelButtonText: '取消',
                      });
                      if (isConfirmed) {
                        await clearAllFavorites();
                        setFavoriteItems([]);
                        await Swal.fire({
                          icon: 'success',
                          title: '已清空',
                          text: '所有收藏已清空',
                          timer: 2000,
                          showConfirmButton: false,
                        });
                      }
                    }}
                  >
                    清空
                  </button>
                )}
              </div>
              {favoriteLoading ? (
                <div className='flex justify-center py-8'>
                  <div className='flex items-center gap-2 text-gray-500 dark:text-gray-400'>
                    <div className='animate-spin rounded-full h-5 w-5 border-b-2 border-green-500'></div>
                    <span className='text-sm'>加載中...</span>
                  </div>
                </div>
              ) : (
                <div className='justify-start grid grid-cols-3 gap-x-2 gap-y-14 sm:gap-y-20 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8'>
                  {favoriteItems.map((item) => (
                    <div key={item.id + item.source} className='w-full'>
                      <VideoCard
                        query={item.search_title}
                        {...item}
                        from='favorite'
                        type={item.episodes > 1 ? 'tv' : ''}
                      />
                    </div>
                  ))}
                  {favoriteItems.length === 0 && (
                    <div className='col-span-full text-center text-gray-500 py-8 dark:text-gray-400'>
                      暫無收藏內容
                    </div>
                  )}
                </div>
              )}
            </section>
          ) : (
            // 首頁視圖
            <>
              {/* 繼續觀看 - 組件內部已處理簡潔模式 */}
              <ContinueWatching />

              {/* 簡潔模式下只顯示收藏夾，但在服務器端渲染時先不渲染 */}
              {isClient && !simpleMode && (
                <>
                  {/* 成人推薦 */}
                  {adultRecommendations.length > 0 && (
                    <section className='mb-8'>
                      <div className='mb-4 flex items-center justify-between'>
                        <div className='flex items-center gap-3'>
                          <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
                            成人推薦
                          </h2>
                          {adultRefreshKey && (
                            <span className='rounded-full bg-green-500/10 px-2 py-1 text-xs font-medium text-green-600 dark:text-green-300'>
                              每日更新 {adultRefreshKey}
                            </span>
                          )}
                        </div>
                        <Link
                          href='/adult'
                          onClick={startLoading}
                          className='flex items-center text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                        >
                          查看更多
                          <ChevronRight className='w-4 h-4 ml-1' />
                        </Link>
                      </div>
                      <ScrollableRow>
                        {adultRecommendations.map((item) => (
                          <div
                            key={`${item.source}-${item.id}`}
                            className='min-w-[96px] w-24 sm:min-w-[180px] sm:w-44'
                          >
                            <VideoCard
                              from='search'
                              id={item.id}
                              title={item.title}
                              poster={item.poster}
                              source={item.source}
                              source_name={item.source_name}
                              year={item.year}
                              type='movie'
                            />
                          </div>
                        ))}
                      </ScrollableRow>
                    </section>
                  )}

                  {/* 熱門電影 */}
                  <section className='mb-8'>
                    <div className='mb-4 flex items-center justify-between'>
                      <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
                        熱門電影
                      </h2>
                      <Link
                        href='/douban?type=movie'
                        onClick={startLoading}
                        className='flex items-center text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                      >
                        查看更多
                        <ChevronRight className='w-4 h-4 ml-1' />
                      </Link>
                    </div>
                    <ScrollableRow>
                      {hotMoviesLoading
                        ? // 加載狀態顯示灰色佔位數據
                          Array.from({ length: 8 }).map((_, index) => (
                            <div
                              key={index}
                              className='min-w-[96px] w-24 sm:min-w-[180px] sm:w-44'
                            >
                              <div className='relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-gray-200 animate-pulse dark:bg-gray-800'>
                                <div className='absolute inset-0 bg-gray-300 dark:bg-gray-700'></div>
                              </div>
                              <div className='mt-2 h-4 bg-gray-200 rounded animate-pulse dark:bg-gray-800'></div>
                            </div>
                          ))
                        : // 顯示真實數據
                          hotMovies.map((movie, index) => (
                            <div
                              key={index}
                              className='min-w-[96px] w-24 sm:min-w-[180px] sm:w-44'
                            >
                              <VideoCard
                                from='douban'
                                title={movie.title}
                                poster={movie.poster}
                                douban_id={Number(movie.id)}
                                rate={movie.rate}
                                year={movie.year}
                                type='movie'
                              />
                            </div>
                          ))}
                    </ScrollableRow>
                  </section>

                  {/* 熱門劇集 */}
                  <section className='mb-8'>
                    <div className='mb-4 flex items-center justify-between'>
                      <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
                        熱門劇集
                      </h2>
                      <Link
                        href='/douban?type=tv'
                        onClick={startLoading}
                        className='flex items-center text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                      >
                        查看更多
                        <ChevronRight className='w-4 h-4 ml-1' />
                      </Link>
                    </div>
                    <ScrollableRow>
                      {hotTvShowsLoading
                        ? // 加載狀態顯示灰色佔位數據
                          Array.from({ length: 8 }).map((_, index) => (
                            <div
                              key={index}
                              className='min-w-[96px] w-24 sm:min-w-[180px] sm:w-44'
                            >
                              <div className='relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-gray-200 animate-pulse dark:bg-gray-800'>
                                <div className='absolute inset-0 bg-gray-300 dark:bg-gray-700'></div>
                              </div>
                              <div className='mt-2 h-4 bg-gray-200 rounded animate-pulse dark:bg-gray-800'></div>
                            </div>
                          ))
                        : // 顯示真實數據
                          hotTvShows.map((show, index) => (
                            <div
                              key={index}
                              className='min-w-[96px] w-24 sm:min-w-[180px] sm:w-44'
                            >
                              <VideoCard
                                from='douban'
                                title={show.title}
                                poster={show.poster}
                                douban_id={Number(show.id)}
                                rate={show.rate}
                                year={show.year}
                              />
                            </div>
                          ))}
                    </ScrollableRow>
                  </section>

                  {/* 每日新番放送 */}
                  <section className='mb-8'>
                    <div className='mb-4 flex items-center justify-between'>
                      <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
                        新番放送
                      </h2>
                      <Link
                        href='/douban?type=anime'
                        onClick={startLoading}
                        className='flex items-center text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                      >
                        查看更多
                        <ChevronRight className='w-4 h-4 ml-1' />
                      </Link>
                    </div>
                    <ScrollableRow>
                      {bangumiCalendarLoading
                        ? // 加載狀態顯示灰色佔位數據
                          Array.from({ length: 8 }).map((_, index) => (
                            <div
                              key={index}
                              className='min-w-[96px] w-24 sm:min-w-[180px] sm:w-44'
                            >
                              <div className='relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-gray-200 animate-pulse dark:bg-gray-800'>
                                <div className='absolute inset-0 bg-gray-300 dark:bg-gray-700'></div>
                              </div>
                              <div className='mt-2 h-4 bg-gray-200 rounded animate-pulse dark:bg-gray-800'></div>
                            </div>
                          ))
                        : // 展示當前日期的番劇
                          (() => {
                            // 獲取當前日期對應的星期
                            const today = new Date();
                            const weekdays = [
                              'Sun',
                              'Mon',
                              'Tue',
                              'Wed',
                              'Thu',
                              'Fri',
                              'Sat',
                            ];
                            const currentWeekday = weekdays[today.getDay()];

                            // 找到當前星期對應的番劇數據
                            const todayAnimes =
                              (Array.isArray(bangumiCalendarData)
                                ? bangumiCalendarData
                                : []
                              ).find(
                                (item) => item?.weekday?.en === currentWeekday
                              )?.items || [];

                            return todayAnimes
                              .filter(Boolean)
                              .map((anime, index) => (
                                <div
                                  key={`${anime.id}-${index}`}
                                  className='min-w-[96px] w-24 sm:min-w-[180px] sm:w-44'
                                >
                                  <VideoCard
                                    from='douban'
                                    title={anime.name_cn || anime.name || ''}
                                    poster={
                                      anime.images?.large ||
                                      anime.images?.common ||
                                      anime.images?.medium ||
                                      anime.images?.small ||
                                      anime.images?.grid ||
                                      ''
                                    }
                                    douban_id={anime.id}
                                    rate={anime.rating?.score?.toString() || ''}
                                    year={anime.air_date?.split('-')?.[0] || ''}
                                    isBangumi={true}
                                  />
                                </div>
                              ));
                          })()}
                    </ScrollableRow>
                  </section>

                  {/* 熱門綜藝 */}
                  <section className='mb-8'>
                    <div className='mb-4 flex items-center justify-between'>
                      <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
                        熱門綜藝
                      </h2>
                      <Link
                        href='/douban?type=show'
                        onClick={startLoading}
                        className='flex items-center text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                      >
                        查看更多
                        <ChevronRight className='w-4 h-4 ml-1' />
                      </Link>
                    </div>
                    <ScrollableRow>
                      {hotVarietyShowsLoading
                        ? // 加載狀態顯示灰色佔位數據
                          Array.from({ length: 8 }).map((_, index) => (
                            <div
                              key={index}
                              className='min-w-[96px] w-24 sm:min-w-[180px] sm:w-44'
                            >
                              <div className='relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-gray-200 animate-pulse dark:bg-gray-800'>
                                <div className='absolute inset-0 bg-gray-300 dark:bg-gray-700'></div>
                              </div>
                              <div className='mt-2 h-4 bg-gray-200 rounded animate-pulse dark:bg-gray-800'></div>
                            </div>
                          ))
                        : // 顯示真實數據
                          hotVarietyShows.map((show, index) => (
                            <div
                              key={index}
                              className='min-w-[96px] w-24 sm:min-w-[180px] sm:w-44'
                            >
                              <VideoCard
                                from='douban'
                                title={show.title}
                                poster={show.poster}
                                douban_id={Number(show.id)}
                                rate={show.rate}
                                year={show.year}
                              />
                            </div>
                          ))}
                    </ScrollableRow>
                  </section>
                </>
              )}
            </>
          )}
        </div>
      </div>
      {announcement && showAnnouncement && (
        <div
          className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm dark:bg-black/70 p-4 transition-opacity duration-300 ${
            showAnnouncement ? '' : 'opacity-0 pointer-events-none'
          }`}
        >
          <div className='w-full max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-gray-900 transform transition-all duration-300 hover:shadow-2xl'>
            <div className='flex justify-between items-start mb-4'>
              <h3 className='text-2xl font-bold tracking-tight text-gray-800 dark:text-white border-b border-green-500 pb-1'>
                提示
              </h3>
              <button
                onClick={() => handleCloseAnnouncement(announcement)}
                className='text-gray-400 hover:text-gray-500 dark:text-gray-500 dark:hover:text-white transition-colors'
                aria-label='關閉'
              ></button>
            </div>
            <div className='mb-6'>
              <div className='relative overflow-hidden rounded-lg mb-4 bg-green-50 dark:bg-green-900/20'>
                <div className='absolute inset-y-0 left-0 w-1.5 bg-green-500 dark:bg-green-400'></div>
                <p className='ml-4 text-gray-600 dark:text-gray-300 leading-relaxed'>
                  {announcement}
                </p>
              </div>
            </div>
            <button
              onClick={() => handleCloseAnnouncement(announcement)}
              className='w-full rounded-lg bg-gradient-to-r from-green-600 to-green-700 px-4 py-3 text-white font-medium shadow-md hover:shadow-lg hover:from-green-700 hover:to-green-800 dark:from-green-600 dark:to-green-700 dark:hover:from-green-700 dark:hover:to-green-800 transition-all duration-300 transform hover:-translate-y-0.5'
            >
              我知道了
            </button>
          </div>
        </div>
      )}
    </PageLayout>
  );
}

export default function Home() {
  return (
    <Suspense>
      <HomeClient />
    </Suspense>
  );
}
