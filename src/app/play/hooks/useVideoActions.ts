/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, no-console, @next/next/no-img-element */

'use client';

import { useEffect, useState } from 'react';

import {
  deleteFavorite,
  deleteFollowing,
  generateStorageKey,
  isFavorited,
  isFollowing,
  saveFavorite,
  saveFollowing,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { SearchResult } from '@/lib/types';

/** 最小化的引用類型，避免依賴 React 類型細節 */
interface RefLike<T> {
  current: T;
}

interface VideoActionsDeps {
  /** 當前播放源的標識（用於狀態訂閱），空串表示尚未確定 */
  source: string;
  /** 當前視頻 id（用於狀態訂閱） */
  id: string;
  sourceRef: RefLike<string>;
  idRef: RefLike<string>;
  titleRef: RefLike<string>;
  detailRef: RefLike<SearchResult | null>;
  episodeIndexRef: RefLike<number>;
  /** 搜索標題，寫入收藏/追更記錄用於後續跳轉 */
  searchTitle: string;
}

/**
 * 管理當前視頻的收藏（favorite）與追更（following）狀態，
 * 包括初始加載、跨端數據更新訂閱以及切換邏輯。
 */
export function useVideoActions(deps: VideoActionsDeps) {
  const {
    source,
    id,
    sourceRef,
    idRef,
    titleRef,
    detailRef,
    episodeIndexRef,
    searchTitle,
  } = deps;

  const [favorited, setFavorited] = useState(false);
  const [following, setFollowing] = useState(false);

  // 每當 source 或 id 變化時檢查收藏狀態
  useEffect(() => {
    if (!source || !id) return;
    (async () => {
      try {
        const fav = await isFavorited(source, id);
        setFavorited(fav);
      } catch (err) {
        console.error('檢查收藏狀態失敗:', err);
      }
    })();
  }, [source, id]);

  // 監聽收藏數據更新事件
  useEffect(() => {
    if (!source || !id) return;

    const unsubscribe = subscribeToDataUpdates(
      'favoritesUpdated',
      (favorites: Record<string, any>) => {
        const key = generateStorageKey(source, id);
        const isFav = !!favorites[key];
        setFavorited(isFav);
      }
    );

    return unsubscribe;
  }, [source, id]);

  // 切換收藏
  const handleToggleFavorite = async () => {
    if (
      !titleRef.current ||
      !detailRef.current ||
      !sourceRef.current ||
      !idRef.current
    )
      return;

    try {
      if (favorited) {
        // 如果已收藏，刪除收藏
        await deleteFavorite(sourceRef.current, idRef.current);
        setFavorited(false);
      } else {
        // 如果未收藏，添加收藏
        await saveFavorite(sourceRef.current, idRef.current, {
          title: titleRef.current,
          source_name: detailRef.current?.source_name || '',
          year: detailRef.current?.year,
          cover: detailRef.current?.poster || '',
          total_episodes: detailRef.current?.episodes.length || 1,
          save_time: Date.now(),
          search_title: searchTitle,
        });
        setFavorited(true);
      }
    } catch (err) {
      console.error('切換收藏失敗:', err);
    }
  };

  // 追更狀態加載與訂閱
  useEffect(() => {
    if (!source || !id) return;

    const refreshFollowingState = async () => {
      const isFollow = await isFollowing(source, id);
      setFollowing(isFollow);
    };

    refreshFollowingState();

    const unsubscribe = subscribeToDataUpdates(
      'followingsUpdated',
      (followings: Record<string, any>) => {
        const key = generateStorageKey(source, id);
        setFollowing(!!followings[key]);
      }
    );

    return unsubscribe;
  }, [source, id]);

  const handleToggleFollowing = async () => {
    if (
      !titleRef.current ||
      !detailRef.current ||
      !sourceRef.current ||
      !idRef.current
    )
      return;

    try {
      if (following) {
        await deleteFollowing(sourceRef.current, idRef.current);
        setFollowing(false);
      } else {
        await saveFollowing(sourceRef.current, idRef.current, {
          title: titleRef.current,
          source_name: detailRef.current?.source_name || '',
          year: detailRef.current?.year,
          cover: detailRef.current?.poster || '',
          total_episodes: detailRef.current?.episodes.length || 1,
          watched_episodes: episodeIndexRef.current + 1,
          save_time: Date.now(),
          search_title: searchTitle,
          source: sourceRef.current,
          id: idRef.current,
        });
        setFollowing(true);
      }
    } catch (err) {
      console.error('切換追更失敗:', err);
    }
  };

  return { favorited, following, handleToggleFavorite, handleToggleFollowing };
}
