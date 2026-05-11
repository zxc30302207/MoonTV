/* eslint-disable @next/next/no-img-element */

'use client';

import { MessageCircle, RotateCcw, Star, ThumbsUp } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import type {
  DoubanComment,
  DoubanCommentsResult,
} from '@/lib/douban-comments';

interface DoubanCommentsProps {
  doubanId: number;
}

const COMMENTS_LIMIT = 20;

export default function DoubanComments({ doubanId }: DoubanCommentsProps) {
  const [comments, setComments] = useState<DoubanComment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [started, setStarted] = useState(false);

  const fetchComments = useCallback(
    async (start: number) => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `/api/douban/comments?id=${doubanId}&start=${start}&limit=${COMMENTS_LIMIT}`
        );

        if (!response.ok) {
          const data = await response.json().catch(() => null);
          throw new Error(data?.error || '豆瓣短評載入失敗');
        }

        const data = (await response.json()) as DoubanCommentsResult;
        setComments((prev) =>
          start === 0 ? data.comments : [...prev, ...data.comments]
        );
        setTotal(data.total);
        setHasMore(data.hasMore);
      } catch (err) {
        setError(err instanceof Error ? err.message : '豆瓣短評載入失敗');
      } finally {
        setLoading(false);
      }
    },
    [doubanId]
  );

  useEffect(() => {
    setComments([]);
    setLoading(false);
    setError(null);
    setTotal(0);
    setHasMore(false);
    setStarted(false);
  }, [doubanId]);

  if (!doubanId) return null;

  if (!started) {
    return (
      <div className='flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 px-4 py-8 text-center dark:border-gray-700'>
        <MessageCircle className='mb-3 h-9 w-9 text-green-500' />
        <button
          type='button'
          onClick={() => {
            setStarted(true);
            fetchComments(0);
          }}
          className='rounded-lg bg-green-500 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-green-600'
        >
          查看豆瓣短評
        </button>
      </div>
    );
  }

  if (loading && comments.length === 0) {
    return (
      <div className='flex items-center justify-center py-8 text-sm text-gray-600 dark:text-gray-400'>
        <span className='mr-3 h-5 w-5 animate-spin rounded-full border-2 border-green-500 border-t-transparent' />
        載入豆瓣短評中...
      </div>
    );
  }

  if (error && comments.length === 0) {
    return (
      <div className='flex flex-col items-center justify-center rounded-lg border border-red-200 px-4 py-8 text-center text-sm text-red-600 dark:border-red-900/70 dark:text-red-300'>
        <p>{error}</p>
        <button
          type='button'
          onClick={() => fetchComments(0)}
          className='mt-4 inline-flex items-center gap-2 rounded-lg bg-red-500 px-4 py-2 text-white transition-colors hover:bg-red-600'
        >
          <RotateCcw className='h-4 w-4' />
          重試
        </button>
      </div>
    );
  }

  if (comments.length === 0) {
    return (
      <div className='rounded-lg border border-gray-200 px-4 py-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400'>
        目前沒有可顯示的豆瓣短評
      </div>
    );
  }

  return (
    <div className='space-y-4'>
      <div className='text-sm text-gray-500 dark:text-gray-400'>
        {total > comments.length
          ? `已載入 ${comments.length} / ${total} 條短評`
          : `已載入 ${comments.length} 條短評`}
      </div>

      <div className='space-y-3'>
        {comments.map((comment) => (
          <article
            key={comment.id}
            className='rounded-lg bg-gray-50 p-4 transition-colors hover:bg-gray-100 dark:bg-gray-800/50 dark:hover:bg-gray-800'
          >
            <div className='flex gap-3'>
              <a
                href={comment.userUrl || undefined}
                target='_blank'
                rel='noopener noreferrer'
                className='h-10 w-10 flex-shrink-0 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700'
              >
                {comment.userAvatar ? (
                  <img
                    src={comment.userAvatar}
                    alt={comment.userName || '豆瓣用戶'}
                    className='h-full w-full object-cover'
                  />
                ) : (
                  <span className='flex h-full w-full items-center justify-center text-sm font-medium text-gray-500'>
                    {(comment.userName || '?').slice(0, 1)}
                  </span>
                )}
              </a>

              <div className='min-w-0 flex-1'>
                <div className='flex flex-wrap items-center gap-2'>
                  <a
                    href={comment.userUrl || undefined}
                    target='_blank'
                    rel='noopener noreferrer'
                    className='truncate text-sm font-medium text-gray-900 hover:text-green-600 dark:text-gray-100 dark:hover:text-green-400'
                  >
                    {comment.userName || '豆瓣用戶'}
                  </a>
                  {renderStars(comment.rating)}
                  {comment.time && (
                    <span className='text-xs text-gray-500 dark:text-gray-400'>
                      {comment.time}
                    </span>
                  )}
                </div>

                <p className='mt-2 whitespace-pre-line text-sm leading-relaxed text-gray-700 dark:text-gray-300'>
                  {comment.content}
                </p>

                <div className='mt-3 flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400'>
                  <ThumbsUp className='h-3.5 w-3.5' />
                  <span>{comment.votes}</span>
                </div>
              </div>
            </div>
          </article>
        ))}
      </div>

      {hasMore && (
        <div className='flex justify-center pt-1'>
          <button
            type='button'
            onClick={() => fetchComments(comments.length)}
            disabled={loading}
            className='rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800'
          >
            {loading ? '載入中...' : '載入更多'}
          </button>
        </div>
      )}
    </div>
  );
}

function renderStars(rating: number | null) {
  if (!rating) return null;

  return (
    <span
      className='inline-flex items-center gap-0.5'
      aria-label={`${rating} 星`}
    >
      {[1, 2, 3, 4, 5].map((value) => (
        <Star
          key={value}
          className={`h-3.5 w-3.5 ${
            value <= rating
              ? 'fill-amber-400 text-amber-400'
              : 'fill-gray-200 text-gray-200 dark:fill-gray-600 dark:text-gray-600'
          }`}
        />
      ))}
    </span>
  );
}
