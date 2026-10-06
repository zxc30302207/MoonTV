/* eslint-disable no-console, react-hooks/exhaustive-deps, @typescript-eslint/no-explicit-any */

'use client';

import { useEffect, useRef, useState } from 'react';

import {
  type DoubanCollectionId,
  getDoubanCollection,
} from '@/lib/douban.client';
import type { DoubanItem } from '@/lib/types';

import { BackButton } from '@/components/BackButton';
import DoubanCardSkeleton from '@/components/DoubanCardSkeleton';
import PageLayout from '@/components/PageLayout';
import VideoCard from '@/components/VideoCard';

interface CollectionOption {
  id: DoubanCollectionId;
  label: string;
}

const COLLECTIONS: CollectionOption[] = [
  { id: 'movie_top250', label: 'Top250' },
  { id: 'movie_weekly_best', label: '每周口碑榜' },
];

function RankingClient() {
  const [activeId, setActiveId] = useState<DoubanCollectionId>('movie_top250');
  const [data, setData] = useState<DoubanItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const loadingRef = useRef<HTMLDivElement>(null);

  const loadMorePendingRef = useRef(false);

  // 切換榜單或離開頁面後，忽略舊請求的結果。
  useEffect(() => {
    let cancelled = false;
    const initial = currentPage === 0;
    if (initial) {
      setLoading(true);
      setData([]);
      setHasMore(true);
    } else {
      setIsLoadingMore(true);
    }
    void (async () => {
      try {
        const result = await getDoubanCollection(
          activeId,
          currentPage * 25,
          25
        );
        if (!cancelled && result.code === 200) {
          setData((previous) =>
            initial ? result.list : [...previous, ...result.list]
          );
          setHasMore(result.list.length !== 0);
        }
      } catch (error) {
        if (!cancelled) console.error('獲取榜單失敗', error);
      } finally {
        if (!cancelled) {
          setLoading(false);
          setIsLoadingMore(false);
          loadMorePendingRef.current = false;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeId, currentPage]);

  // 無限滾動
  useEffect(() => {
    if (!hasMore || isLoadingMore || loading) return;
    if (!loadingRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries[0].isIntersecting &&
          hasMore &&
          !isLoadingMore &&
          !loadMorePendingRef.current
        ) {
          loadMorePendingRef.current = true;
          setCurrentPage((prev) => prev + 1);
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(loadingRef.current);
    return () => observer.disconnect();
  }, [hasMore, isLoadingMore, loading]);

  return (
    <PageLayout activePath='/ranking'>
      <div className='px-4 sm:px-10 py-4 sm:py-8'>
        <div className='mb-6 flex items-center gap-3'>
          <BackButton showLabel />
          <div>
            <h1 className='text-2xl sm:text-3xl font-bold text-gray-800 dark:text-gray-200'>
              豆瓣榜單
            </h1>
            <p className='text-sm text-gray-600 dark:text-gray-400'>
              來自豆瓣的精選榜單
            </p>
          </div>
        </div>

        {/* 榜單切換 */}
        <div className='mb-6 inline-flex rounded-full bg-gray-200/60 p-1 dark:bg-gray-700/60'>
          {COLLECTIONS.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                if (activeId === c.id) return;
                setCurrentPage(0);
                setIsLoadingMore(false);
                loadMorePendingRef.current = false;
                setActiveId(c.id);
              }}
              className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                activeId === c.id
                  ? 'bg-white text-gray-900 dark:bg-gray-500 dark:text-gray-100'
                  : 'text-gray-700 dark:text-gray-400'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* 內容網格 */}
        <div className='max-w-[95%] mx-auto'>
          <div className='grid grid-cols-3 gap-x-2 gap-y-12 sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))] sm:gap-x-8 sm:gap-y-20'>
            {loading
              ? Array.from({ length: 25 }, (_, i) => (
                  <DoubanCardSkeleton key={i} />
                ))
              : data.map((item, index) => (
                  <div key={`${item.title}-${index}`} className='w-full'>
                    <VideoCard
                      from='douban'
                      title={item.title}
                      poster={item.poster}
                      douban_id={Number(item.id)}
                      rate={item.rate}
                      year={item.year}
                      type=''
                    />
                  </div>
                ))}
          </div>

          {hasMore && !loading && (
            <div
              ref={(el) => {
                if (el && el.offsetParent !== null) {
                  (loadingRef as any).current = el;
                }
              }}
              className='flex justify-center py-8'
            >
              {isLoadingMore && (
                <div className='flex items-center gap-2'>
                  <div className='h-6 w-6 animate-spin rounded-full border-b-2 border-green-500' />
                  <span className='text-gray-600'>加載中...</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </PageLayout>
  );
}

export default function RankingPage() {
  return <RankingClient />;
}
