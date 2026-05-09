/* eslint-disable no-console */
'use client';

import { useEffect, useState } from 'react';

import type { PlayRecord } from '@/lib/db.client';
import {
  clearAllPlayRecords,
  getAllPlayRecords,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { getSwal } from '@/lib/sweetalert';

import ScrollableRow from '@/components/ScrollableRow';
import VideoCard from '@/components/VideoCard';

interface ContinueWatchingProps {
  className?: string;
  showAll?: boolean; // 是否顯示所有記錄（網格佈局）
  hideHeader?: boolean; // 是否隱藏標題欄
}

export default function ContinueWatching({ className, showAll = false, hideHeader = false }: ContinueWatchingProps) {
  const [playRecords, setPlayRecords] = useState<
    (PlayRecord & { key: string })[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [simpleMode, setSimpleMode] = useState(false);
  const [isClient, setIsClient] = useState(false);

  // 檢查是否啟用簡潔模式
  useEffect(() => {
    setIsClient(true);
    if (typeof window !== 'undefined') {
      const savedSimpleMode = localStorage.getItem('simpleMode');
      if (savedSimpleMode !== null) {
        setSimpleMode(JSON.parse(savedSimpleMode));
      }
    }
  }, []);

  // 處理播放記錄數據更新的函數
  const updatePlayRecords = (allRecords: Record<string, PlayRecord>) => {
    // 將記錄轉換為數組並根據 save_time 由近到遠排序
    const recordsArray = Object.entries(allRecords).map(([key, record]) => ({
      ...record,
      key,
    }));

    // 按 save_time 降序排序（最新的在前面）
    const sortedRecords = recordsArray.sort(
      (a, b) => b.save_time - a.save_time
    );

    setPlayRecords(sortedRecords);
  };

  useEffect(() => {
    const fetchPlayRecords = async () => {
      try {
        setLoading(true);

        // 從緩存或API獲取所有播放記錄
        const allRecords = await getAllPlayRecords();
        updatePlayRecords(allRecords);
      } catch (error) {
        console.error('獲取播放記錄失敗:', error);
        setPlayRecords([]);
      } finally {
        setLoading(false);
      }
    };

    fetchPlayRecords();

    // 監聽播放記錄更新事件
    const unsubscribe = subscribeToDataUpdates(
      'playRecordsUpdated',
      (newRecords: Record<string, PlayRecord>) => {
        updatePlayRecords(newRecords);
      }
    );

    return unsubscribe;
  }, []);

  // 如果沒有播放記錄，則不渲染組件
  if (!loading && playRecords.length === 0) {
    return null;
  }

  // 計算播放進度百分比
  const getProgress = (record: PlayRecord) => {
    if (record.total_time === 0) return 0;
    return (record.play_time / record.total_time) * 100;
  };

  // 從 key 中解析 source 和 id
  const parseKey = (key: string) => {
    const [source, id] = key.split('+');
    return { source, id };
  };

  return (
    <section className={`mb-8 ${className || ''}`}>
      {!hideHeader && (
        <div className='mb-4 flex items-center justify-between'>
          <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
            繼續觀看
          </h2>
          {!loading && playRecords.length > 0 && (
            <button
              className='text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
              onClick={async () => {
                const Swal = await getSwal();
                const { isConfirmed } = await Swal.fire({
                  title: '確認清空',
                  text: '確定要清空所有播放記錄嗎？',
                  icon: 'warning',
                  showCancelButton: true,
                  confirmButtonText: '確定',
                  cancelButtonText: '取消',
                });
                if (isConfirmed) {
                  await clearAllPlayRecords();
                  setPlayRecords([]);
                  await Swal.fire({
                    icon: 'success',
                    title: '已清空',
                    text: '所有播放記錄已清空',
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
      )}

      {isClient && (simpleMode || showAll) ? (
        // 簡潔模式：使用網格佈局，類似收藏夾
        <div className='justify-start grid grid-cols-3 gap-x-2 gap-y-14 sm:gap-y-20 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8'>
          {loading
            ? // 加載狀態顯示灰色佔位數據
              Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className='w-full'>
                  <div className='relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-gray-200 animate-pulse dark:bg-gray-800'>
                    <div className='absolute inset-0 bg-gray-300 dark:bg-gray-700'></div>
                  </div>
                  <div className='mt-2 h-4 bg-gray-200 rounded animate-pulse dark:bg-gray-800'></div>
                </div>
              ))
            : // 顯示真實數據
              playRecords.map((record) => {
                const { source, id } = parseKey(record.key);
                return (
                  <div key={record.key} className='w-full'>
                    <VideoCard
                      id={id}
                      title={record.title}
                      poster={record.cover}
                      year={record.year}
                      source={source}
                      source_name={record.source_name}
                      progress={getProgress(record)}
                      episodes={record.total_episodes}
                      currentEpisode={record.index}
                      query={record.search_title}
                      from='playrecord'
                      onDelete={() =>
                        setPlayRecords((prev) =>
                          prev.filter((r) => r.key !== record.key)
                        )
                      }
                      type={record.total_episodes > 1 ? 'tv' : ''}
                    />
                  </div>
                );
              })}
        </div>
      ) : (
        // 正常模式：使用橫向滾動佈局
        <ScrollableRow>
          {loading
            ? // 加載狀態顯示灰色佔位數據
              Array.from({ length: 6 }).map((_, index) => (
                <div
                  key={index}
                  className='min-w-[96px] w-24 sm:min-w-[180px] sm:w-44'
                >
                  <div className='relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-gray-200 animate-pulse dark:bg-gray-800'>
                    <div className='absolute inset-0 bg-gray-300 dark:bg-gray-700'></div>
                  </div>
                  <div className='mt-2 h-4 bg-gray-200 rounded animate-pulse dark:bg-gray-800'></div>
                  <div className='mt-1 h-3 bg-gray-200 rounded animate-pulse dark:bg-gray-800'></div>
                </div>
              ))
            : // 顯示真實數據
              playRecords.map((record) => {
                const { source, id } = parseKey(record.key);
                return (
                  <div
                    key={record.key}
                    className='min-w-[96px] w-24 sm:min-w-[180px] sm:w-44'
                  >
                    <VideoCard
                      id={id}
                      title={record.title}
                      poster={record.cover}
                      year={record.year}
                      source={source}
                      source_name={record.source_name}
                      progress={getProgress(record)}
                      episodes={record.total_episodes}
                      currentEpisode={record.index}
                      query={record.search_title}
                      from='playrecord'
                      onDelete={() =>
                        setPlayRecords((prev) =>
                          prev.filter((r) => r.key !== record.key)
                        )
                      }
                      type={record.total_episodes > 1 ? 'tv' : ''}
                    />
                  </div>
                );
              })}
        </ScrollableRow>
      )}
    </section>
  );
}
