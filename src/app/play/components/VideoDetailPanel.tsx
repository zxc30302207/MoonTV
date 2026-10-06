/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, no-console, @next/next/no-img-element */

'use client';

import { Download, Heart } from 'lucide-react';

import { SearchResult } from '@/lib/types';

import DoubanComments from '@/components/DoubanComments';
import ExternalPlayerMenu from '@/components/ExternalPlayerMenu';
import { FollowingIconButton } from '@/components/FollowingIcon';

interface VideoDetailPanelProps {
  videoTitle: string;
  videoYear: string;
  totalEpisodes: number;
  currentEpisodeIndex: number;
  detail: SearchResult | null;
  favorited: boolean;
  following: boolean;
  onToggleFavorite: () => void;
  onToggleFollowing: () => void;
  videoUrl: string;
  videoDoubanId: number;
  currentSource: string;
  currentId: string;
  onDownload: () => void;
}

/**
 * 播放頁下方的影片標題、操作按鈕與簡介區域。
 */
export function VideoDetailPanel(props: VideoDetailPanelProps) {
  const {
    videoTitle,
    videoYear,
    totalEpisodes,
    currentEpisodeIndex,
    detail,
    favorited,
    following,
    onToggleFavorite,
    onToggleFollowing,
    videoUrl,
    videoDoubanId,
    currentSource,
    currentId,
    onDownload,
  } = props;

  return (
    <div className='grid grid-cols-1 gap-4'>
      {/* 文字區 */}
      <div className='w-full'>
        <div className='p-6 flex flex-col min-h-0'>
          {/* 標題 */}
          <h1 className='text-3xl font-bold mb-2 tracking-wide flex items-center flex-shrink-0 text-center md:text-left w-full'>
            {videoTitle || '影片標題'}
            {totalEpisodes > 1 && (
              <span className='text-gray-500 dark:text-gray-400 text-2xl ml-3'>
                {detail?.episodes_titles?.[currentEpisodeIndex] ||
                  `第 ${currentEpisodeIndex + 1} 集`}
              </span>
            )}
            <div className='ml-3 flex flex-shrink-0 items-center gap-3'>
              <button
                type='button'
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleFavorite();
                }}
                className={`flex h-8 w-8 items-center justify-center rounded-full shadow-md transition-all duration-300 ease-out hover:scale-[1.1] ${
                  favorited
                    ? 'bg-red-500 text-white hover:bg-red-600'
                    : 'bg-gray-200 text-gray-600 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                }`}
                title={favorited ? '取消收藏' : '加入收藏'}
                aria-label={favorited ? '取消收藏' : '加入收藏'}
              >
                <Heart
                  className={`h-4 w-4 ${
                    favorited
                      ? 'fill-white stroke-white'
                      : 'fill-transparent stroke-current stroke-[1.5]'
                  }`}
                />
              </button>
              {videoUrl && (
                <button
                  type='button'
                  onClick={() => onDownload()}
                  className='flex h-8 w-8 items-center justify-center rounded-full bg-blue-500 text-white shadow-md transition-all duration-300 ease-out hover:scale-[1.1] hover:bg-blue-600'
                  title='下載視頻'
                  aria-label='下載視頻'
                >
                  <Download className='h-4 w-4' />
                </button>
              )}
              <ExternalPlayerMenu
                mediaUrl={videoUrl}
                title={`${videoTitle}${
                  totalEpisodes > 1
                    ? ` ${
                        detail?.episodes_titles?.[currentEpisodeIndex] ||
                        `EP${currentEpisodeIndex + 1}`
                      }`
                    : ''
                }`}
                className='flex-shrink-0'
              />
              {videoDoubanId !== 0 && (
                <a
                  href={`https://movie.douban.com/subject/${videoDoubanId.toString()}`}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='flex h-8 w-8 items-center justify-center rounded-full bg-green-500 text-white shadow-md transition-all duration-300 ease-out hover:scale-[1.1] hover:bg-green-600'
                  title='打開豆瓣頁面'
                  aria-label='打開豆瓣頁面'
                >
                  <svg
                    width='16'
                    height='16'
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    strokeWidth='2'
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    aria-hidden='true'
                  >
                    <path d='M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71'></path>
                    <path d='M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'></path>
                  </svg>
                </a>
              )}
              {currentSource && currentId && (
                <FollowingIconButton
                  following={following}
                  size={16}
                  padding={8}
                  theme='detail'
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleFollowing();
                  }}
                />
              )}
            </div>
          </h1>

          {/* 關鍵信息行 */}
          <div className='flex flex-wrap items-center gap-3 text-base mb-4 opacity-80 flex-shrink-0'>
            {detail?.class && (
              <span className='text-green-600 font-semibold'>
                {detail.class}
              </span>
            )}
            {(detail?.year || videoYear) && (
              <span>{detail?.year || videoYear}</span>
            )}
            {detail?.source_name && (
              <span className='border border-gray-500/60 px-2 py-[1px] rounded'>
                {detail.source_name}
              </span>
            )}
            {detail?.type_name && <span>{detail.type_name}</span>}
          </div>
          {/* 劇情簡介 */}
          {detail?.desc && (
            <div
              className='mt-0 text-base leading-relaxed opacity-90 overflow-y-auto pr-2 flex-1 min-h-0 scrollbar-hide'
              style={{ whiteSpace: 'pre-line' }}
            >
              {detail.desc}
            </div>
          )}
        </div>
      </div>
      {videoDoubanId !== 0 && (
        <section className='px-6 pb-6'>
          <div className='border-t border-gray-200 pt-6 dark:border-gray-800'>
            <h2 className='mb-4 text-xl font-semibold'>豆瓣短評</h2>
            <DoubanComments doubanId={videoDoubanId} />
          </div>
        </section>
      )}
    </div>
  );
}
