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
  const [authExpiresAt, setAuthExpiresAt] = useState<number | null | undefined>(
    undefined
  );
  const [refreshKey, setRefreshKey] = useState('');
  const [cardCode, setCardCode] = useState('');
  const [authError, setAuthError] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [showCardCode, setShowCardCode] = useState(false);
  const [authUnavailable, setAuthUnavailable] = useState(false);
  const authRequestRef = useRef(0);
  const controllersRef = useRef(new Set<AbortController>());
  const loadingRef = useRef<HTMLDivElement | null>(null);
  const requestIdRef = useRef(0);

  const invalidateRequests = useCallback(() => {
    authRequestRef.current += 1;
    requestIdRef.current += 1;
    controllersRef.current.forEach((controller) => controller.abort());
    controllersRef.current.clear();
  }, []);

  const clearProtectedState = useCallback(() => {
    setAdultAuthorized(false);
    setAuthExpiresAt(undefined);
    setItems([]);
    setSources([]);
    setRefreshKey('');
    setHasMore(false);
    setIsLoadingMore(false);
  }, []);

  const checkAuthorization = useCallback(async () => {
    invalidateRequests();
    const authRequestId = authRequestRef.current;
    const controller = new AbortController();
    controllersRef.current.add(controller);
    clearProtectedState();
    setAuthorizationChecked(false);
    setLoading(true);
    setAuthError('');
    setAuthUnavailable(false);
    setRedeeming(false);

    try {
      const response = await fetch('/api/adult/authorization', {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (authRequestId !== authRequestRef.current) return;
      if (response.status === 401 || response.status === 403) {
        setAuthError(
          response.status === 401
            ? '登入已失效，請重新登入'
            : '目前帳號尚未取得授權'
        );
        return;
      }
      if (!response.ok) throw new Error('授權服務暫時無法使用，請重新檢查');
      const data = (await response.json()) as AdultAuthorizationResponse;
      if (authRequestId !== authRequestRef.current) return;
      setAdultAuthorized(Boolean(data.authorized));
      setAuthExpiresAt(data.expiresAt);
      if (!data.authorized && data.reason === 'expired') {
        setAuthError('授權已到期，請輸入新的授權卡號');
      }
    } catch {
      if (authRequestId !== authRequestRef.current) return;
      setAuthUnavailable(true);
      setAuthError('授權服務暫時無法使用，請重新檢查');
    } finally {
      controllersRef.current.delete(controller);
      if (authRequestId === authRequestRef.current) {
        setAuthorizationChecked(true);
        setLoading(false);
      }
    }
  }, [clearProtectedState, invalidateRequests]);

  const loadPage = useCallback(
    async (targetPage: number, source: string, replace: boolean) => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      const controller = new AbortController();
      controllersRef.current.add(controller);

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
          signal: controller.signal,
        });
        if (requestId !== requestIdRef.current) return;

        if (response.status === 401 || response.status === 403) {
          invalidateRequests();
          clearProtectedState();
          setLoading(false);
          setAuthError(
            response.status === 401
              ? '登入已失效，請重新登入'
              : '授權已失效，請重新檢查或輸入授權卡號'
          );
          return;
        }

        if (!response.ok) {
          throw new Error('成人推薦載入失敗');
        }

        const data = (await response.json()) as AdultRecommendationsResponse;
        if (requestId !== requestIdRef.current) return;

        setSources(data.sources || []);
        setAuthExpiresAt(data.expiresAt);
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
        controllersRef.current.delete(controller);
        if (requestId === requestIdRef.current) {
          setLoading(false);
          setIsLoadingMore(false);
        }
      }
    },
    [clearProtectedState, invalidateRequests]
  );

  useEffect(() => {
    checkAuthorization();
    const handleLogout = () => {
      invalidateRequests();
      clearProtectedState();
      setCardCode('');
      setShowCardCode(false);
      setAuthUnavailable(false);
      setRedeeming(false);
      setLoading(false);
      setAuthorizationChecked(true);
      setAuthError('登入已失效，請重新登入');
    };
    window.addEventListener('moontv:logout', handleLogout);
    return () => {
      window.removeEventListener('moontv:logout', handleLogout);
      invalidateRequests();
    };
  }, [checkAuthorization, clearProtectedState, invalidateRequests]);

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

    if (redeeming) return;
    invalidateRequests();
    const authRequestId = authRequestRef.current;
    const controller = new AbortController();
    controllersRef.current.add(controller);
    setRedeeming(true);
    setAuthUnavailable(false);
    setAuthError('');
    try {
      const response = await fetch('/api/adult/authorization', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: normalizedCode }),
      });
      const data = await response.json().catch(() => ({}));
      if (authRequestId !== authRequestRef.current) return;

      if (!response.ok) {
        throw new Error(data.error || '授權失敗');
      }

      setCardCode('');
      setShowCardCode(false);
      setAdultAuthorized(true);
      setAuthExpiresAt(data.expiresAt);
      setItems([]);
      setPage(1);
      setHasMore(true);
    } catch (err) {
      if (authRequestId !== authRequestRef.current) return;
      setAuthError(err instanceof Error ? err.message : '授權失敗');
    } finally {
      controllersRef.current.delete(controller);
      if (authRequestId === authRequestRef.current) setRedeeming(false);
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
              <span role='status'>正在檢查授權狀態...</span>
            </div>
          ) : !adultAuthorized ? (
            <div className='mx-auto max-w-xl rounded-xl border border-gray-200 bg-white/70 p-6 shadow-sm dark:border-gray-700 dark:bg-gray-900/40'>
              <div className='mb-5 flex items-start gap-3'>
                <div className='mt-1 rounded-full bg-green-500/10 p-2 text-green-600 dark:text-green-300'>
                  <KeyRound className='h-5 w-5' />
                </div>
                <div>
                  <h2 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
                    {authUnavailable ? '暫時無法確認授權' : '需要成人內容授權'}
                  </h2>
                  <p className='mt-1 text-sm leading-6 text-gray-600 dark:text-gray-400'>
                    請輸入管理員提供的授權卡號。未授權帳號不會載入成人推薦內容。
                  </p>
                </div>
              </div>

              <form onSubmit={handleRedeemCard} className='space-y-3'>
                <label
                  htmlFor='authorization-code'
                  className='block text-sm font-medium text-gray-900 dark:text-gray-100'
                >
                  授權卡號
                </label>
                <input
                  id='authorization-code'
                  type={showCardCode ? 'text' : 'password'}
                  autoComplete='off'
                  spellCheck={false}
                  autoCapitalize='none'
                  aria-invalid={Boolean(authError)}
                  aria-describedby={
                    authError ? 'authorization-error' : undefined
                  }
                  value={cardCode}
                  onChange={(event) => setCardCode(event.target.value)}
                  placeholder='ADULT-XXXX-XXXX-XXXX-XXXXXX'
                  className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-sm text-gray-900 outline-none transition focus:border-green-500 focus:ring-2 focus:ring-green-500/30 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
                />
                <button
                  type='button'
                  aria-pressed={showCardCode}
                  onClick={() => setShowCardCode(!showCardCode)}
                  className='min-h-11 text-sm text-gray-600 underline dark:text-gray-300'
                >
                  {showCardCode ? '隱藏卡號' : '顯示卡號'}
                </button>
                {authError && (
                  <div
                    id='authorization-error'
                    role='alert'
                    className='rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300'
                  >
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
                    aria-busy={redeeming}
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
                {authExpiresAt !== undefined && (
                  <span>授權到期：{formatAdultAuthExpiry(authExpiresAt)}</span>
                )}
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
