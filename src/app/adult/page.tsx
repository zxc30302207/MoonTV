'use client';

import { ChevronRight, KeyRound } from 'lucide-react';
import Link from 'next/link';
import {
  type FormEvent,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import { SearchResult } from '@/lib/types';

import { useNavigationLoading } from '@/components/NavigationLoadingProvider';
import PageLayout from '@/components/PageLayout';
import VideoCard from '@/components/VideoCard';

type AdultSourceOption = {
  key: string;
  name: string;
};

type AdultRecommendationsResponse = {
  code: number;
  message: string;
  list: SearchResult[];
  page: number;
  limit: number;
  hasMore: boolean;
  sources: AdultSourceOption[];
  adultAuthorized?: boolean;
  expiresAt?: number | null;
  refreshKey?: string;
};

type AdultAuthorizationResponse = {
  authorized: boolean;
  reason?: string;
  expiresAt?: number | null;
};

const PAGE_LIMIT = 48;

function AdultPageClient() {
  const { startLoading } = useNavigationLoading();
  const [items, setItems] = useState<SearchResult[]>([]);
  const [sources, setSources] = useState<AdultSourceOption[]>([]);
  const [selectedSource, setSelectedSource] = useState('all');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [authorizationChecked, setAuthorizationChecked] = useState(false);
  const [adultAuthorized, setAdultAuthorized] = useState(false);
  const [authExpiresAt, setAuthExpiresAt] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState('');
  const [cardCode, setCardCode] = useState('');
  const [authError, setAuthError] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const loadingRef = useRef<HTMLDivElement | null>(null);
  const requestIdRef = useRef(0);

  const checkAuthorization = useCallback(async () => {
    setAuthorizationChecked(false);
    setLoading(true);
    setAuthError('');

    try {
      const response = await fetch('/api/adult/authorization', {
        cache: 'no-store',
      });

      if (!response.ok) {
        setAdultAuthorized(false);
        setAuthExpiresAt(null);
        return;
      }

      const data = (await response.json()) as AdultAuthorizationResponse;
      setAdultAuthorized(Boolean(data.authorized));
      setAuthExpiresAt(data.expiresAt ?? null);
    } catch {
      setAdultAuthorized(false);
      setAuthExpiresAt(null);
      setAuthError('授權狀態檢查失敗，請稍後重試');
    } finally {
      setAuthorizationChecked(true);
      setLoading(false);
    }
  }, []);

  const loadPage = useCallback(
    async (targetPage: number, source: string, replace: boolean) => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;

      if (replace) {
        setLoading(true);
      } else {
        setIsLoadingMore(true);
      }
      setError('');

      try {
        const params = new URLSearchParams({
          page: String(targetPage),
          limit: String(PAGE_LIMIT),
          source,
        });
        const response = await fetch(`/api/adult/recommends?${params}`, {
          cache: 'no-store',
        });

        if (response.status === 403) {
          setAdultAuthorized(false);
          setAuthExpiresAt(null);
          setItems([]);
          setHasMore(false);
          setAuthError('請先輸入管理員提供的成人授權卡號');
          return;
        }

        if (!response.ok) {
          throw new Error('成人推薦載入失敗');
        }

        const data = (await response.json()) as AdultRecommendationsResponse;
        if (requestId !== requestIdRef.current) return;

        setSources(data.sources || []);
        setAuthExpiresAt(data.expiresAt ?? null);
        setRefreshKey(data.refreshKey || '');
        setItems((prev) =>
          replace ? data.list || [] : appendUniqueItems(prev, data.list || [])
        );
        setPage(data.page || targetPage);
        setHasMore(Boolean(data.hasMore));
      } catch (err) {
        if (requestId === requestIdRef.current) {
          setError(err instanceof Error ? err.message : '成人推薦載入失敗');
          if (replace) {
            setItems([]);
            setHasMore(false);
          }
        }
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
          setIsLoadingMore(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    checkAuthorization();
  }, [checkAuthorization]);

  useEffect(() => {
    if (!authorizationChecked || !adultAuthorized) return;

    setItems([]);
    setPage(1);
    setHasMore(true);
    loadPage(1, selectedSource, true);
  }, [adultAuthorized, authorizationChecked, loadPage, selectedSource]);

  useEffect(() => {
    const target = loadingRef.current;
    if (!target || !adultAuthorized || loading || isLoadingMore || !hasMore)
      return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoadingMore) {
          loadPage(page + 1, selectedSource, false);
        }
      },
      {
        rootMargin: '400px',
        threshold: 0.1,
      }
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [
    adultAuthorized,
    hasMore,
    isLoadingMore,
    loadPage,
    loading,
    page,
    selectedSource,
  ]);

  const handleRedeemCard = async (event: FormEvent) => {
    event.preventDefault();
    const normalizedCode = cardCode.trim();
    if (!normalizedCode) {
      setAuthError('請輸入授權卡號');
      return;
    }

    setRedeeming(true);
    setAuthError('');
    try {
      const response = await fetch('/api/adult/authorization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: normalizedCode }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || '授權失敗');
      }

      setCardCode('');
      setAdultAuthorized(true);
      setAuthExpiresAt(data.expiresAt ?? null);
      setItems([]);
      setPage(1);
      setHasMore(true);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : '授權失敗');
    } finally {
      setRedeeming(false);
    }
  };

  const sourceOptions = [{ key: 'all', name: '全部' }, ...sources];

  return (
    <PageLayout activePath='/adult'>
      <div className='px-4 sm:px-10 py-4 sm:py-8 overflow-visible mb-12'>
        <div className='max-w-[95%] mx-auto'>
          <div className='mb-6 sm:mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between'>
            <div>
              <div className='mb-2 flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400'>
                <Link
                  href='/'
                  onClick={startLoading}
                  className='hover:text-green-500 transition-colors'
                >
                  首頁
                </Link>
                <ChevronRight className='h-4 w-4' />
                <span>成人推薦</span>
              </div>
              <h1 className='text-2xl sm:text-3xl font-bold text-gray-800 dark:text-gray-200'>
                成人推薦
              </h1>
            </div>
          </div>

          {!authorizationChecked ? (
            <div className='rounded-xl border border-gray-200 bg-white/70 px-5 py-8 text-center text-gray-500 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-400'>
              正在檢查成人內容授權...
            </div>
          ) : !adultAuthorized ? (
            <div className='mx-auto max-w-xl rounded-xl border border-gray-200 bg-white/70 p-6 shadow-sm dark:border-gray-700 dark:bg-gray-900/40'>
              <div className='mb-5 flex items-start gap-3'>
                <div className='mt-1 rounded-full bg-green-500/10 p-2 text-green-600 dark:text-green-300'>
                  <KeyRound className='h-5 w-5' />
                </div>
                <div>
                  <h2 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
                    需要成人內容授權
                  </h2>
                  <p className='mt-1 text-sm leading-6 text-gray-600 dark:text-gray-400'>
                    請輸入管理員提供的授權卡號。未授權帳號不會載入成人推薦內容。
                  </p>
                </div>
              </div>

              <form onSubmit={handleRedeemCard} className='space-y-3'>
                <input
                  type='text'
                  value={cardCode}
                  onChange={(event) => setCardCode(event.target.value)}
                  placeholder='ADULT-XXXX-XXXX-XXXX-XXXXXX'
                  className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-sm text-gray-900 outline-none transition focus:border-green-500 focus:ring-2 focus:ring-green-500/30 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
                />
                {authError && (
                  <div className='rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300'>
                    {authError}
                  </div>
                )}
                <div className='flex flex-col gap-2 sm:flex-row sm:justify-end'>
                  <button
                    type='button'
                    onClick={checkAuthorization}
                    className='rounded-lg bg-gray-500/10 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-500/20 dark:text-gray-300'
                  >
                    重新檢查
                  </button>
                  <button
                    type='submit'
                    disabled={redeeming}
                    className='rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-400'
                  >
                    {redeeming ? '授權中...' : '啟用授權'}
                  </button>
                </div>
              </form>
            </div>
          ) : (
            <>
              <div className='mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500 dark:text-gray-400'>
                <span>授權到期：{formatAdultAuthExpiry(authExpiresAt)}</span>
                {refreshKey && <span>每日更新：{refreshKey}</span>}
              </div>

              <div className='mb-7 flex gap-2 overflow-x-auto pb-1 scrollbar-hide'>
                {sourceOptions.map((source) => (
                  <button
                    key={source.key}
                    type='button'
                    onClick={() => setSelectedSource(source.key)}
                    className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                      selectedSource === source.key
                        ? 'bg-green-500 text-white shadow-sm'
                        : 'bg-gray-500/10 text-gray-700 hover:bg-gray-500/20 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                    }`}
                  >
                    {source.name}
                  </button>
                ))}
              </div>

              {error && (
                <div className='mb-6 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-300'>
                  {error}
                  <button
                    type='button'
                    onClick={() => loadPage(1, selectedSource, true)}
                    className='ml-3 font-medium text-red-700 underline underline-offset-4 hover:text-red-800 dark:text-red-200'
                  >
                    重試
                  </button>
                </div>
              )}

              <div className='justify-start grid grid-cols-3 gap-x-2 gap-y-14 sm:gap-y-20 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8'>
                {loading
                  ? Array.from({ length: 24 }).map((_, index) => (
                      <AdultCardSkeleton key={index} />
                    ))
                  : items.map((item) => (
                      <div key={`${item.source}-${item.id}`} className='w-full'>
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
              </div>

              {!loading && items.length === 0 && !error && (
                <div className='py-16 text-center text-gray-500 dark:text-gray-400'>
                  目前沒有可顯示的成人推薦
                </div>
              )}

              <div ref={loadingRef} className='flex justify-center py-10'>
                {isLoadingMore && (
                  <div className='flex items-center gap-2 text-gray-500 dark:text-gray-400'>
                    <div className='h-5 w-5 animate-spin rounded-full border-b-2 border-green-500'></div>
                    <span className='text-sm'>加載中...</span>
                  </div>
                )}
                {!hasMore && items.length > 0 && (
                  <span className='text-sm text-gray-500 dark:text-gray-400'>
                    已加載全部內容
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </PageLayout>
  );
}

function AdultCardSkeleton() {
  return (
    <div className='w-full'>
      <div className='relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-gray-200 animate-pulse dark:bg-gray-800'>
        <div className='absolute inset-0 bg-gray-300 dark:bg-gray-700'></div>
      </div>
      <div className='mx-auto mt-2 h-4 w-3/4 rounded bg-gray-200 animate-pulse dark:bg-gray-800'></div>
    </div>
  );
}

function formatAdultAuthExpiry(expiresAt?: number | null) {
  if (expiresAt === null) return '永久';
  if (!expiresAt) return '-';
  return new Date(expiresAt).toLocaleString('zh-TW', { hour12: false });
}

function appendUniqueItems(
  previousItems: SearchResult[],
  nextItems: SearchResult[]
): SearchResult[] {
  const seen = new Set(
    previousItems.map((item) => `${item.source}:${item.id}`)
  );
  const merged = [...previousItems];

  nextItems.forEach((item) => {
    const key = `${item.source}:${item.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(item);
    }
  });

  return merged;
}

export default function AdultPage() {
  return (
    <Suspense>
      <AdultPageClient />
    </Suspense>
  );
}
