/* eslint-disable no-console, @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-function */
'use client';

/**
 * 僅在瀏覽器端使用的數據庫工具，目前基於 localStorage 實現。
 * 之所以單獨拆分文件，是為了避免在客戶端 bundle 中引入 `fs`, `path` 等 Node.js 內置模塊，
 * 從而解決諸如 "Module not found: Can't resolve 'fs'" 的問題。
 *
 * 功能：
 * 1. 獲取全部播放記錄（getAllPlayRecords）。
 * 2. 保存播放記錄（savePlayRecord）。
 * 3. 數據庫存儲模式下的混合緩存策略，提升用戶體驗。
 *
 * 如後續需要在客戶端讀取收藏等其它數據，可按同樣方式在此文件中補充實現。
 */

import { getCachedAuthInfo, refreshAuthInfo } from './auth-client';
import {
  discardNamespaceConflict,
  hasNamespaceSnapshot,
  namespacePath,
  namespaceProblems,
  namespaceReadTicket,
  namespaceSessionGuard,
  NamespaceSyncError,
  observeNamespaceRead,
  responseVersion,
  retryNamespaceWrites,
  sendNamespaceWrite,
} from './namespace-client';
import {
  acknowledgeWriteRevision,
  beginWrite,
  currentWriteRevision,
  discardPendingClear,
  mergePendingWrites,
  pendingClearPaths,
  pendingWriteCount,
  pendingWriteRequests,
} from './pending-writes';
import { Following, SkipConfig, TodayUpdatedRecord } from './types';

/**
 * 后台静默同步失败的上报。
 *
 * 这类失败发生在"缓存优先"的读取路径上：调用方已经拿到本地缓存数据，页面功能
 * 完全正常，用户也没有可做的动作。此前这里会弹全局红字，而红字提示不会自动消失
 * ——进入播放页时追更/收藏的后台刷新一旦失败，就会一直挂着一条红色错误条。
 * 改为只写控制台，避免非致命的后台同步失败干扰观看。
 */
function reportBackgroundSyncFailure(label: string, err: unknown) {
  console.warn(`后台同步${label}失败:`, err);
}

// ---- 類型 ----
export interface PlayRecord {
  title: string;
  source_name: string;
  year: string;
  cover: string;
  index: number; // 第幾集
  total_episodes: number; // 總集數
  play_time: number; // 播放進度（秒）
  total_time: number; // 總進度（秒）
  save_time: number; // 記錄保存時間（時間戳）
  search_title?: string; // 搜索時使用的標題
}

// ---- 收藏類型 ----
export interface Favorite {
  title: string;
  source_name: string;
  year: string;
  cover: string;
  total_episodes: number;
  save_time: number;
  search_title?: string;
}

// ---- 緩存數據結構 ----
interface CacheData<T> {
  data: T;
  timestamp: number;
  version: string;
}

interface UserCacheStore {
  playRecords?: CacheData<Record<string, PlayRecord>>;
  favorites?: CacheData<Record<string, Favorite>>;
  followings?: CacheData<Record<string, Following>>;
  searchHistory?: CacheData<string[]>;
  skipConfigs?: CacheData<Record<string, SkipConfig>>;
  todayUpdated?: CacheData<TodayUpdatedRecord | null>;
}

// ---- 常量 ----
const PLAY_RECORDS_KEY = 'moontv_play_records';
const FAVORITES_KEY = 'moontv_favorites';
const FOLLOWINGS_KEY = 'moontv_followings';

let followingMutationRevision = 0;
const followingMutations = new Map<
  string,
  Map<
    string,
    {
      revision: number;
      pending: boolean;
      value: Following | null;
    }
  >
>();

function recordFollowingMutation(
  username: string,
  key: string,
  value: Following | null
) {
  let mutations = followingMutations.get(username);
  if (!mutations) {
    mutations = new Map();
    followingMutations.set(username, mutations);
  }
  const mutation = {
    revision: ++followingMutationRevision,
    pending: true,
    value,
  };
  mutations.set(key, mutation);
  return mutation;
}

function mergeFollowingMutations(
  data: Record<string, Following>,
  username: string,
  sinceRevision: number
): Record<string, Following> {
  const merged = { ...data };
  followingMutations.get(username)?.forEach((mutation, key) => {
    if (!mutation.pending && mutation.revision <= sinceRevision) return;
    if (mutation.value) merged[key] = mutation.value;
    else delete merged[key];
  });
  return merged;
}

const SEARCH_HISTORY_KEY = 'moontv_search_history';

// 緩存相關常量
const CACHE_PREFIX = 'moontv_cache_';
const CACHE_VERSION = '1.0.0';
const CACHE_EXPIRE_TIME = 60 * 60 * 1000; // 一小時緩存過期

// ---- 環境變量 ----
const STORAGE_TYPE = (() => {
  const raw =
    (typeof window !== 'undefined' &&
      (window as any).RUNTIME_CONFIG?.STORAGE_TYPE) ||
    (process.env.STORAGE_TYPE as 'localstorage' | 'supabase' | undefined) ||
    'localstorage';
  return raw;
})();

// ---------------- 搜索歷史相關常量 ----------------
// 搜索歷史最大保存條數
const SEARCH_HISTORY_LIMIT = 20;

// ---- 緩存管理器 ----
class HybridCacheManager {
  private static instance: HybridCacheManager;

  static getInstance(): HybridCacheManager {
    if (!HybridCacheManager.instance) {
      HybridCacheManager.instance = new HybridCacheManager();
    }
    return HybridCacheManager.instance;
  }

  /**
   * 獲取當前用戶名
   */
  private getCurrentUsername(): string | null {
    const authInfo = getCachedAuthInfo();
    return authInfo?.username || null;
  }

  /**
   * 生成用戶專屬的緩存key
   */
  private getUserCacheKey(username: string): string {
    return `${CACHE_PREFIX}${username}`;
  }

  /**
   * 獲取用戶緩存數據
   */
  private getUserCache(username: string): UserCacheStore {
    if (typeof window === 'undefined') return {};

    try {
      const cacheKey = this.getUserCacheKey(username);
      const cached = localStorage.getItem(cacheKey);
      return cached ? JSON.parse(cached) : {};
    } catch (error) {
      console.warn('獲取用戶緩存失敗:', error);
      return {};
    }
  }

  /**
   * 保存用戶緩存數據
   */
  private saveUserCache(username: string, cache: UserCacheStore): void {
    if (typeof window === 'undefined') return;

    try {
      // 檢查緩存大小，超過15MB時清理舊數據
      const cacheSize = JSON.stringify(cache).length;
      if (cacheSize > 15 * 1024 * 1024) {
        console.warn('緩存過大，清理舊數據');
        this.cleanOldCache(cache);
      }

      const cacheKey = this.getUserCacheKey(username);
      localStorage.setItem(cacheKey, JSON.stringify(cache));
    } catch (error) {
      console.warn('保存用戶緩存失敗:', error);
      // 存儲空間不足時清理緩存後重試
      if (
        error instanceof DOMException &&
        error.name === 'QuotaExceededError'
      ) {
        this.clearAllCache();
        try {
          const cacheKey = this.getUserCacheKey(username);
          localStorage.setItem(cacheKey, JSON.stringify(cache));
        } catch (retryError) {
          console.error('重試保存緩存仍然失敗:', retryError);
        }
      }
    }
  }

  /**
   * 清理過期緩存數據
   */
  private cleanOldCache(cache: UserCacheStore): void {
    const now = Date.now();
    const maxAge = 60 * 24 * 60 * 60 * 1000; // 兩個月

    // 清理過期的播放記錄緩存
    if (cache.playRecords && now - cache.playRecords.timestamp > maxAge) {
      delete cache.playRecords;
    }

    // 清理過期的收藏緩存
    if (cache.favorites && now - cache.favorites.timestamp > maxAge) {
      delete cache.favorites;
    }
  }

  /**
   * 清理所有緩存
   */
  private clearAllCache(): void {
    const keys = Object.keys(localStorage);
    keys.forEach((key) => {
      if (key.startsWith('moontv_cache_')) {
        localStorage.removeItem(key);
      }
    });
  }

  /**
   * 檢查緩存是否有效
   */
  private isCacheValid<T>(cache: CacheData<T>): boolean {
    const now = Date.now();
    return (
      cache.version === CACHE_VERSION &&
      now - cache.timestamp < CACHE_EXPIRE_TIME
    );
  }

  /**
   * 創建緩存數據
   */
  private createCacheData<T>(data: T): CacheData<T> {
    return {
      data,
      timestamp: Date.now(),
      version: CACHE_VERSION,
    };
  }

  /**
   * 獲取緩存的播放記錄
   */
  getCachedPlayRecords(): Record<string, PlayRecord> | null {
    const username = this.getCurrentUsername();
    if (!username) return null;

    const userCache = this.getUserCache(username);
    const cached = userCache.playRecords;

    if (cached && this.isCacheValid(cached)) {
      return cached.data;
    }

    return null;
  }

  /**
   * 緩存播放記錄
   */
  cachePlayRecords(data: Record<string, PlayRecord>): void {
    const username = this.getCurrentUsername();
    if (!username) return;

    const userCache = this.getUserCache(username);
    userCache.playRecords = this.createCacheData(data);
    this.saveUserCache(username, userCache);
  }

  /**
   * 獲取緩存的收藏
   */
  getCachedFavorites(): Record<string, Favorite> | null {
    const username = this.getCurrentUsername();
    if (!username) return null;

    const userCache = this.getUserCache(username);
    const cached = userCache.favorites;

    if (cached && this.isCacheValid(cached)) {
      return cached.data;
    }

    return null;
  }

  /**
   * 緩存收藏
   */
  cacheFavorites(data: Record<string, Favorite>): void {
    const username = this.getCurrentUsername();
    if (!username) return;

    const userCache = this.getUserCache(username);
    userCache.favorites = this.createCacheData(data);
    this.saveUserCache(username, userCache);
  }

  /**
   * 获取缓存的追更
   */
  getCachedFollowings(): Record<string, Following> | null {
    const username = this.getCurrentUsername();
    if (!username) return null;

    const userCache = this.getUserCache(username);
    const cached = userCache.followings;

    if (cached && this.isCacheValid(cached)) {
      return cached.data;
    }

    return null;
  }

  /**
   * 缓存追更
   */
  cacheFollowings(data: Record<string, Following>): void {
    const username = this.getCurrentUsername();
    if (!username) return;

    const userCache = this.getUserCache(username);
    userCache.followings = this.createCacheData(data);
    this.saveUserCache(username, userCache);
  }

  /**
   * 获取缓存的搜索历史
   */
  getCachedSearchHistory(): string[] | null {
    const username = this.getCurrentUsername();
    if (!username) return null;

    const userCache = this.getUserCache(username);
    const cached = userCache.searchHistory;

    if (cached && this.isCacheValid(cached)) {
      return cached.data;
    }

    return null;
  }

  /**
   * 緩存搜索歷史
   */
  cacheSearchHistory(data: string[]): void {
    const username = this.getCurrentUsername();
    if (!username) return;

    const userCache = this.getUserCache(username);
    userCache.searchHistory = this.createCacheData(data);
    this.saveUserCache(username, userCache);
  }

  /**
   * 獲取緩存的跳過片頭片尾配置
   */
  getCachedSkipConfigs(): Record<string, SkipConfig> | null {
    const username = this.getCurrentUsername();
    if (!username) return null;

    const userCache = this.getUserCache(username);
    const cached = userCache.skipConfigs;

    if (cached && this.isCacheValid(cached)) {
      return cached.data;
    }

    return null;
  }

  /**
   * 緩存跳過片頭片尾配置
   */
  cacheSkipConfigs(data: Record<string, SkipConfig>): void {
    const username = this.getCurrentUsername();
    if (!username) return;

    const userCache = this.getUserCache(username);
    userCache.skipConfigs = this.createCacheData(data);
    this.saveUserCache(username, userCache);
  }

  /**
   * 获取缓存的“今日新更”记录
   */
  getCachedTodayUpdated(): TodayUpdatedRecord | null {
    const username = this.getCurrentUsername();
    if (!username) return null;

    const userCache = this.getUserCache(username);
    const cached = userCache.todayUpdated;

    if (cached && this.isCacheValid(cached)) {
      return cached.data;
    }

    return null;
  }

  /**
   * 缓存“今日新更”记录
   */
  cacheTodayUpdated(data: TodayUpdatedRecord | null): void {
    const username = this.getCurrentUsername();
    if (!username) return;

    const userCache = this.getUserCache(username);
    userCache.todayUpdated = this.createCacheData(data);
    this.saveUserCache(username, userCache);
  }

  /**
   * 清除指定用户的所有缓存
   */
  clearUserCache(username?: string): void {
    const targetUsername = username || this.getCurrentUsername();
    if (!targetUsername) return;

    try {
      const cacheKey = this.getUserCacheKey(targetUsername);
      localStorage.removeItem(cacheKey);
    } catch (error) {
      console.warn('清除用戶緩存失敗:', error);
    }
  }

  /**
   * 清除所有過期緩存
   */
  clearExpiredCaches(): void {
    if (typeof window === 'undefined') return;

    try {
      const keysToRemove: string[] = [];

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(CACHE_PREFIX)) {
          try {
            const cache = JSON.parse(localStorage.getItem(key) || '{}');
            // 檢查是否有任何緩存數據過期
            let hasValidData = false;
            for (const [, cacheData] of Object.entries(cache)) {
              if (cacheData && this.isCacheValid(cacheData as CacheData<any>)) {
                hasValidData = true;
                break;
              }
            }
            if (!hasValidData) {
              keysToRemove.push(key);
            }
          } catch {
            // 解析失敗的緩存也刪除
            keysToRemove.push(key);
          }
        }
      }

      keysToRemove.forEach((key) => localStorage.removeItem(key));
    } catch (error) {
      console.warn('清除過期緩存失敗:', error);
    }
  }
}

// 獲取緩存管理器實例
const cacheManager = HybridCacheManager.getInstance();

// ---- 錯誤處理輔助函數 ----
/**
 * 乐观更新型写操作（先写本地缓存、后同步远端）失败时的降级处理。
 *
 * 此时本地缓存已经生效（UI 已经"成功"），远端同步失败不该弹全局红字——
 * 那会制造"操作失败"的假象（用户看到"能正常添加却提示失败"）。
 * 也不该再拉取远端数据覆盖本地：远端还是旧数据，拉回来会把刚做的乐观
 * 更新冲掉。因此这里只记录日志，保留本地乐观结果。
 */
async function handleDatabaseOperationFailure(
  dataType: 'playRecords' | 'favorites' | 'followings' | 'searchHistory',
  error: any
): Promise<void> {
  console.warn(`数据库同步失败 (${dataType})，已保留本地结果:`, error);
  window.dispatchEvent(
    new CustomEvent('globalError', {
      detail: {
        message:
          error instanceof NamespaceSyncError
            ? error.message
            : '變更尚未確認同步，已保留在此裝置。請在帳號選單重試原操作。',
      },
    })
  );
}

// 頁面加載時清理過期緩存
if (typeof window !== 'undefined') {
  setTimeout(() => cacheManager.clearExpiredCaches(), 1000);
}

// ---- 工具函數 ----
/**
 * 通用的 fetch 函數，處理 401 狀態碼自動跳轉登錄
 */
const namespaceObservers = new WeakMap<Response, () => boolean>();

async function fetchWithAuth(
  url: string,
  options?: RequestInit,
  trackWrite = true,
  intentRevision = 0
): Promise<Response> {
  const username =
    STORAGE_TYPE !== 'localstorage'
      ? (getCachedAuthInfo() || (await refreshAuthInfo()))?.username
      : undefined;
  const acknowledge =
    username && trackWrite ? beginWrite(username, url, options) : undefined;
  const method = options?.method || 'GET';
  const path = namespacePath(url);
  const guardSession = namespaceSessionGuard();
  const checkSession = () => {
    guardSession();
    if (getCachedAuthInfo()?.username !== username)
      throw new Error('登入狀態已變更');
  };
  checkSession();
  const ticket =
    username && path && method === 'GET'
      ? namespaceReadTicket(username, path)
      : undefined;
  const res =
    username && path && ['POST', 'DELETE'].includes(method)
      ? await sendNamespaceWrite(
          username,
          url,
          options || {},
          acknowledge?.revision || intentRevision,
          checkSession
        )
      : await fetch(url, { ...options, cache: 'no-store' });
  checkSession();
  if (!res.ok) {
    if (res.status === 401) {
      try {
        await fetch('/api/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        console.error('注銷請求失敗:', error);
      }
      const currentUrl = window.location.pathname + window.location.search;
      const loginUrl = new URL('/login', window.location.origin);
      loginUrl.searchParams.set('redirect', currentUrl);
      window.location.href = loginUrl.toString();
      throw new Error('用戶未授權，已跳轉到登錄頁面');
    }
    throw new Error(`請求 ${url} 失敗: ${res.status}`);
  }
  if (username && path && ticket)
    namespaceObservers.set(res, () =>
      observeNamespaceRead(username, path, res, ticket)
    );
  acknowledge?.();
  return res;
}

/** Retry only the exact operation whose acknowledgement was lost. */
export async function retryPendingDatabaseWrites(): Promise<number> {
  const username = getCachedAuthInfo()?.username;
  if (!username) throw new Error('未登入');
  await retryNamespaceWrites(
    username,
    () => {
      if (getCachedAuthInfo()?.username !== username)
        throw new Error('登入狀態已變更');
    },
    (revision, url, options) =>
      acknowledgeWriteRevision(username, revision, url, options)
  );
  return Math.max(
    pendingWriteCount(username),
    namespaceProblems(username).length
  );
}

/** Explicit conflict review, separate from retrying an unknown network outcome. */
export async function reconfirmPendingDatabaseWrites(
  confirm: (message: string) => boolean
): Promise<number> {
  const username = getCachedAuthInfo()?.username;
  if (!username) throw new Error('未登入');
  const guardSession = namespaceSessionGuard();
  await retryPendingDatabaseWrites();
  guardSession();
  const problems = namespaceProblems(username);
  if (problems.some((problem) => problem.status === 'unknown')) {
    throw new NamespaceSyncError(
      'unknown',
      '仍有請求結果未明，不能重新提交變更。請稍後重試原請求。'
    );
  }
  const requests = pendingWriteRequests(username);
  const clears = pendingClearPaths(username);
  if (!requests.length && !clears.length && !problems.length)
    return Math.max(
      pendingWriteCount(username),
      namespaceProblems(username).length
    );
  const paths = [
    ...new Set([
      ...requests.map((request) => namespacePath(request.url)),
      ...clears,
      ...problems.map((problem) => problem.path),
    ]),
  ].filter((path): path is string => Boolean(path));
  // Read current snapshots, without altering blocked state or silently rebasing intent.
  const snapshots: { path: string; response: Response; data: unknown }[] = [];
  for (const path of paths) {
    if (getCachedAuthInfo()?.username !== username)
      throw new Error('登入狀態已變更');
    const response = await fetch(path, { cache: 'no-store' });
    guardSession();
    if (!response.ok) throw new Error('無法重新載入資料');
    if (!responseVersion(response))
      throw new NamespaceSyncError(
        'upgrade',
        '伺服器版本尚未就緒，請稍後重新整理。'
      );
    const data: unknown = await response.json();
    snapshots.push({ path, response, data });
  }
  guardSession();
  const uncertain = problems.some((problem) => problem.uncertain);
  if (
    !confirm(
      `${
        uncertain ? '先前請求可能曾成功，之後又被其他操作更新。' : ''
      }已重新讀取伺服器資料。要重新提交此裝置保留的 ${
        requests.length
      } 筆變更嗎？這可能覆蓋其他裝置較新的收藏、追更或播放進度。清空全部不會自動重做，將取消其未同步標記，請回原頁重新確認。取消會保留本地變更。`
    )
  )
    return Math.max(
      pendingWriteCount(username),
      namespaceProblems(username).length
    );
  guardSession();
  if (getCachedAuthInfo()?.username !== username)
    throw new Error('登入狀態已變更');
  for (const { path, response, data } of snapshots) {
    discardNamespaceConflict(username, path);
    discardPendingClear(username, path);
    observeNamespaceRead(
      username,
      path,
      response,
      namespaceReadTicket(username, path)
    );
    const visible = mergePendingWrites(
      username,
      path,
      data,
      currentWriteRevision()
    );
    const event =
      path === '/api/playrecords'
        ? 'playRecordsUpdated'
        : path === '/api/favorites'
        ? 'favoritesUpdated'
        : path === '/api/followings'
        ? 'followingsUpdated'
        : 'searchHistoryUpdated';
    if (path === '/api/playrecords')
      cacheManager.cachePlayRecords(visible as Record<string, PlayRecord>);
    else if (path === '/api/favorites')
      cacheManager.cacheFavorites(visible as Record<string, Favorite>);
    else if (path === '/api/followings')
      cacheManager.cacheFollowings(visible as Record<string, Following>);
    else cacheManager.cacheSearchHistory(visible as string[]);
    window.dispatchEvent(new CustomEvent(event, { detail: visible }));
  }
  for (const request of requests) {
    if (!request.isCurrent()) continue;
    try {
      await fetchWithAuth(
        request.url,
        request.options,
        false,
        request.revision
      );
      request.acknowledge();
    } catch {
      // Stop this explicit batch after any conflict/unknown outcome.
      break;
    }
  }
  return Math.max(
    pendingWriteCount(username),
    namespaceProblems(username).length
  );
}

/**
 * 并发去重的 GET 请求。
 *
 * 首页每张卡片都会调 isFollowing/isFavorited → 各自触发一次
 * /api/followings、/api/favorites：20 张卡片就是 40 个相同请求，
 * 接口一旦失败还会连环弹错。这里按 path 合并并发中的相同请求，
 * 共享同一个 Promise（连同解析后的 JSON 一起共享，避免 Response 只能读一次）。
 */
const inflightGets = new Map<string, Promise<unknown>>();

async function fetchFromApi<T>(path: string): Promise<T> {
  const username = (getCachedAuthInfo() || (await refreshAuthInfo()))?.username;
  const mutationRevision = followingMutationRevision;
  const writeRevision = currentWriteRevision();
  const requestKey = JSON.stringify([
    username || '',
    path,
    path === '/api/followings' ? mutationRevision : writeRevision,
  ]);
  const existing = inflightGets.get(requestKey) as Promise<T> | undefined;
  if (existing) return existing;

  const request = fetchWithAuth(path).then(async (res) => {
    const result = (await res.json()) as T;
    if (namespaceObservers.get(res)?.() === false)
      throw new NamespaceSyncError('snapshot', '資料已更新，請重新載入。');
    if (getCachedAuthInfo()?.username !== username)
      throw new Error('登入狀態已變更');
    const merged =
      path === '/api/followings' && username
        ? (mergeFollowingMutations(
            result as Record<string, Following>,
            username,
            mutationRevision
          ) as T)
        : result;
    return username
      ? mergePendingWrites(username, path, merged, writeRevision)
      : merged;
  });
  inflightGets.set(requestKey, request);
  const clear = () => {
    inflightGets.delete(requestKey);
  };
  request.then(clear, clear);
  return request;
}

/**
 * 生成存儲key
 */
export function generateStorageKey(source: string, id: string): string {
  return `${source}+${id}`;
}

// ---- API ----
/**
 * 讀取全部播放記錄。
 * 非本地存儲模式下使用混合緩存策略：優先返回緩存數據，後臺異步同步最新數據。
 * 在服務端渲染階段 (window === undefined) 時返回空對象，避免報錯。
 */
export async function getAllPlayRecords(): Promise<Record<string, PlayRecord>> {
  // 服務器端渲染階段直接返回空，交由客戶端 useEffect 再行請求
  if (typeof window === 'undefined') {
    return {};
  }

  // 數據庫存儲模式：使用混合緩存策略
  if (STORAGE_TYPE !== 'localstorage') {
    // 優先從緩存獲取數據
    const cachedData = cacheManager.getCachedPlayRecords();

    if (
      cachedData &&
      hasNamespaceSnapshot(
        getCachedAuthInfo()?.username || '',
        '/api/playrecords'
      )
    ) {
      // 返回緩存數據，同時後臺異步更新
      fetchFromApi<Record<string, PlayRecord>>(`/api/playrecords`)
        .then((freshData) => {
          // 只有數據真正不同時才更新緩存
          if (JSON.stringify(cachedData) !== JSON.stringify(freshData)) {
            cacheManager.cachePlayRecords(freshData);
            // 觸發數據更新事件，供組件監聽
            window.dispatchEvent(
              new CustomEvent('playRecordsUpdated', {
                detail: freshData,
              })
            );
          }
        })
        .catch((err) => {
          reportBackgroundSyncFailure('播放记录', err);
        });

      return cachedData;
    } else {
      // 緩存為空，直接從 API 獲取並緩存
      try {
        const freshData = await fetchFromApi<Record<string, PlayRecord>>(
          `/api/playrecords`
        );
        cacheManager.cachePlayRecords(freshData);
        return freshData;
      } catch (err) {
        console.warn(
          '获取播放记录失败(使用缓存/空数据继续, 不弹全局提示):',
          err
        );
        return {};
      }
    }
  }

  // localstorage 模式
  try {
    const raw = localStorage.getItem(PLAY_RECORDS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, PlayRecord>;
  } catch (err) {
    console.warn('读取播放记录失败(使用缓存/空数据继续, 不弹全局提示):', err);
    return {};
  }
}

/**
 * 保存播放記錄。
 * 數據庫存儲模式下使用樂觀更新：先更新緩存（立即生效），再異步同步到數據庫。
 */
export async function savePlayRecord(
  source: string,
  id: string,
  record: PlayRecord
): Promise<void> {
  const key = generateStorageKey(source, id);

  // 數據庫存儲模式：樂觀更新策略
  if (STORAGE_TYPE !== 'localstorage') {
    // 立即更新緩存
    const cachedRecords = cacheManager.getCachedPlayRecords() || {};

    // Different source/id pairs are distinct unless an explicit identity proves otherwise.

    cachedRecords[key] = record;
    cacheManager.cachePlayRecords(cachedRecords);

    // 觸發立即更新事件
    window.dispatchEvent(
      new CustomEvent('playRecordsUpdated', {
        detail: cachedRecords,
      })
    );

    // 異步同步到數據庫
    try {
      await fetchWithAuth('/api/playrecords', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ key, record }),
      });
    } catch (err) {
      await handleDatabaseOperationFailure('playRecords', err);
      console.warn('保存播放记录失败(已本地处理, 不弹全局提示)');
      throw err;
    }
    return;
  }

  // localstorage 模式
  if (typeof window === 'undefined') {
    console.warn('無法在服務端保存播放記錄到 localStorage');
    return;
  }

  try {
    const allRecords = await getAllPlayRecords();

    // Different source/id pairs are distinct unless an explicit identity proves otherwise.

    allRecords[key] = record;
    localStorage.setItem(PLAY_RECORDS_KEY, JSON.stringify(allRecords));
    window.dispatchEvent(
      new CustomEvent('playRecordsUpdated', {
        detail: allRecords,
      })
    );
  } catch (err) {
    console.error('保存播放记录失败:', err);
    console.warn('保存播放记录失败(已本地处理, 不弹全局提示)');
    throw err;
  }
}

/**
 * 刪除播放記錄。
 * 數據庫存儲模式下使用樂觀更新：先更新緩存，再異步同步到數據庫。
 */
export async function deletePlayRecord(
  source: string,
  id: string
): Promise<void> {
  const key = generateStorageKey(source, id);

  // 數據庫存儲模式：樂觀更新策略
  if (STORAGE_TYPE !== 'localstorage') {
    // 立即更新緩存
    const cachedRecords = cacheManager.getCachedPlayRecords() || {};
    delete cachedRecords[key];
    cacheManager.cachePlayRecords(cachedRecords);

    // 觸發立即更新事件
    window.dispatchEvent(
      new CustomEvent('playRecordsUpdated', {
        detail: cachedRecords,
      })
    );

    // 異步同步到數據庫
    try {
      await fetchWithAuth(`/api/playrecords?key=${encodeURIComponent(key)}`, {
        method: 'DELETE',
      });
    } catch (err) {
      await handleDatabaseOperationFailure('playRecords', err);
      console.warn('删除播放记录失败(已本地处理, 不弹全局提示)');
      throw err;
    }
    return;
  }

  // localstorage 模式
  if (typeof window === 'undefined') {
    console.warn('無法在服務端刪除播放記錄到 localStorage');
    return;
  }

  try {
    const allRecords = await getAllPlayRecords();
    delete allRecords[key];
    localStorage.setItem(PLAY_RECORDS_KEY, JSON.stringify(allRecords));
    window.dispatchEvent(
      new CustomEvent('playRecordsUpdated', {
        detail: allRecords,
      })
    );
  } catch (err) {
    console.error('删除播放记录失败:', err);
    console.warn('删除播放记录失败(已本地处理, 不弹全局提示)');
    throw err;
  }
}

/* ---------------- 搜索歷史相關 API ---------------- */

/**
 * 獲取搜索歷史。
 * 數據庫存儲模式下使用混合緩存策略：優先返回緩存數據，後臺異步同步最新數據。
 */
export async function getSearchHistory(): Promise<string[]> {
  // 服務器端渲染階段直接返回空
  if (typeof window === 'undefined') {
    return [];
  }

  // 數據庫存儲模式：使用混合緩存策略
  if (STORAGE_TYPE !== 'localstorage') {
    // 優先從緩存獲取數據
    const cachedData = cacheManager.getCachedSearchHistory();

    if (
      cachedData &&
      hasNamespaceSnapshot(
        getCachedAuthInfo()?.username || '',
        '/api/searchhistory'
      )
    ) {
      // 返回緩存數據，同時後臺異步更新
      fetchFromApi<string[]>(`/api/searchhistory`)
        .then((freshData) => {
          // 只有數據真正不同時才更新緩存
          if (JSON.stringify(cachedData) !== JSON.stringify(freshData)) {
            cacheManager.cacheSearchHistory(freshData);
            // 觸發數據更新事件
            window.dispatchEvent(
              new CustomEvent('searchHistoryUpdated', {
                detail: freshData,
              })
            );
          }
        })
        .catch((err) => {
          reportBackgroundSyncFailure('搜索历史', err);
        });

      return cachedData;
    } else {
      // 緩存為空，直接從 API 獲取並緩存
      try {
        const freshData = await fetchFromApi<string[]>(`/api/searchhistory`);
        cacheManager.cacheSearchHistory(freshData);
        return freshData;
      } catch (err) {
        console.warn(
          '获取搜索历史失败(使用缓存/空数据继续, 不弹全局提示):',
          err
        );
        return [];
      }
    }
  }

  // localStorage 模式
  try {
    const raw = localStorage.getItem(SEARCH_HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as string[];
    // 僅返回字符串數組
    return Array.isArray(arr) ? arr : [];
  } catch (err) {
    console.warn('读取搜索历史失败(使用缓存/空数据继续, 不弹全局提示):', err);
    return [];
  }
}

/**
 * 將關鍵字添加到搜索歷史。
 * 數據庫存儲模式下使用樂觀更新：先更新緩存，再異步同步到數據庫。
 */
export async function addSearchHistory(keyword: string): Promise<void> {
  const trimmed = keyword.trim();
  if (!trimmed) return;

  // 數據庫存儲模式：樂觀更新策略
  if (STORAGE_TYPE !== 'localstorage') {
    // 立即更新緩存
    const cachedHistory = cacheManager.getCachedSearchHistory() || [];
    const newHistory = [trimmed, ...cachedHistory.filter((k) => k !== trimmed)];
    // 限制長度
    if (newHistory.length > SEARCH_HISTORY_LIMIT) {
      newHistory.length = SEARCH_HISTORY_LIMIT;
    }
    cacheManager.cacheSearchHistory(newHistory);

    // 觸發立即更新事件
    window.dispatchEvent(
      new CustomEvent('searchHistoryUpdated', {
        detail: newHistory,
      })
    );

    // 異步同步到數據庫
    try {
      await fetchWithAuth('/api/searchhistory', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ keyword: trimmed }),
      });
    } catch (err) {
      await handleDatabaseOperationFailure('searchHistory', err);
    }
    return;
  }

  // localStorage 模式
  if (typeof window === 'undefined') return;

  try {
    const history = await getSearchHistory();
    const newHistory = [trimmed, ...history.filter((k) => k !== trimmed)];
    // 限制長度
    if (newHistory.length > SEARCH_HISTORY_LIMIT) {
      newHistory.length = SEARCH_HISTORY_LIMIT;
    }
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(newHistory));
    window.dispatchEvent(
      new CustomEvent('searchHistoryUpdated', {
        detail: newHistory,
      })
    );
  } catch (err) {
    console.error('保存搜索历史失败:', err);
    console.warn('保存搜索历史失败(已本地处理, 不弹全局提示)');
  }
}

/**
 * 清空搜索歷史。
 * 數據庫存儲模式下使用樂觀更新：先更新緩存，再異步同步到數據庫。
 */
export async function clearSearchHistory(): Promise<void> {
  // 數據庫存儲模式：樂觀更新策略
  if (STORAGE_TYPE !== 'localstorage') {
    // 立即更新緩存
    cacheManager.cacheSearchHistory([]);

    // 觸發立即更新事件
    window.dispatchEvent(
      new CustomEvent('searchHistoryUpdated', {
        detail: [],
      })
    );

    // 異步同步到數據庫
    try {
      await fetchWithAuth(`/api/searchhistory`, {
        method: 'DELETE',
      });
    } catch (err) {
      await handleDatabaseOperationFailure('searchHistory', err);
    }
    return;
  }

  // localStorage 模式
  if (typeof window === 'undefined') return;
  localStorage.removeItem(SEARCH_HISTORY_KEY);
  window.dispatchEvent(
    new CustomEvent('searchHistoryUpdated', {
      detail: [],
    })
  );
}

/**
 * 刪除單條搜索歷史。
 * 數據庫存儲模式下使用樂觀更新：先更新緩存，再異步同步到數據庫。
 */
export async function deleteSearchHistory(keyword: string): Promise<void> {
  const trimmed = keyword.trim();
  if (!trimmed) return;

  // 數據庫存儲模式：樂觀更新策略
  if (STORAGE_TYPE !== 'localstorage') {
    // 立即更新緩存
    const cachedHistory = cacheManager.getCachedSearchHistory() || [];
    const newHistory = cachedHistory.filter((k) => k !== trimmed);
    cacheManager.cacheSearchHistory(newHistory);

    // 觸發立即更新事件
    window.dispatchEvent(
      new CustomEvent('searchHistoryUpdated', {
        detail: newHistory,
      })
    );

    // 異步同步到數據庫
    try {
      await fetchWithAuth(
        `/api/searchhistory?keyword=${encodeURIComponent(trimmed)}`,
        {
          method: 'DELETE',
        }
      );
    } catch (err) {
      await handleDatabaseOperationFailure('searchHistory', err);
    }
    return;
  }

  // localStorage 模式
  if (typeof window === 'undefined') return;

  try {
    const history = await getSearchHistory();
    const newHistory = history.filter((k) => k !== trimmed);
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(newHistory));
    window.dispatchEvent(
      new CustomEvent('searchHistoryUpdated', {
        detail: newHistory,
      })
    );
  } catch (err) {
    console.error('删除搜索历史失败:', err);
    console.warn('删除搜索历史失败(已本地处理, 不弹全局提示)');
  }
}

// ---------------- 收藏相關 API ----------------

/**
 * 獲取全部收藏。
 * 數據庫存儲模式下使用混合緩存策略：優先返回緩存數據，後臺異步同步最新數據。
 */
export async function getAllFavorites(): Promise<Record<string, Favorite>> {
  // 服務器端渲染階段直接返回空
  if (typeof window === 'undefined') {
    return {};
  }

  // 數據庫存儲模式：使用混合緩存策略
  if (STORAGE_TYPE !== 'localstorage') {
    // 優先從緩存獲取數據
    const cachedData = cacheManager.getCachedFavorites();

    if (
      cachedData &&
      hasNamespaceSnapshot(
        getCachedAuthInfo()?.username || '',
        '/api/favorites'
      )
    ) {
      // 返回緩存數據，同時後臺異步更新
      fetchFromApi<Record<string, Favorite>>(`/api/favorites`)
        .then((freshData) => {
          // 只有數據真正不同時才更新緩存
          if (JSON.stringify(cachedData) !== JSON.stringify(freshData)) {
            cacheManager.cacheFavorites(freshData);
            // 觸發數據更新事件
            window.dispatchEvent(
              new CustomEvent('favoritesUpdated', {
                detail: freshData,
              })
            );
          }
        })
        .catch((err) => {
          reportBackgroundSyncFailure('收藏', err);
        });

      return cachedData;
    } else {
      // 緩存為空，直接從 API 獲取並緩存
      try {
        const freshData = await fetchFromApi<Record<string, Favorite>>(
          `/api/favorites`
        );
        cacheManager.cacheFavorites(freshData);
        return freshData;
      } catch (err) {
        console.warn('获取收藏失败(使用缓存/空数据继续, 不弹全局提示):', err);
        return {};
      }
    }
  }

  // localStorage 模式
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, Favorite>;
  } catch (err) {
    console.warn('读取收藏失败(使用缓存/空数据继续, 不弹全局提示):', err);
    return {};
  }
}

/**
 * 获取全部追更列表。
 */
export async function getAllFollowings(
  forceRemote = false
): Promise<Record<string, Following>> {
  if (typeof window === 'undefined') {
    return {};
  }

  if (STORAGE_TYPE !== 'localstorage') {
    const username = (getCachedAuthInfo() || (await refreshAuthInfo()))
      ?.username;
    if (!username) return {};
    const isSameUser = () => getCachedAuthInfo()?.username === username;
    const cachedData = cacheManager.getCachedFollowings();

    // 强制以远端为准：若有本地缓存则先返回缓存用于立即展示（避免显示加载中），
    // 同时后台拉取远端数据，若与本地缓存不一致则用远端覆盖本地缓存并触发刷新；
    // 若无本地缓存则阻塞拉取远端。
    if (forceRemote) {
      if (
        cachedData &&
        hasNamespaceSnapshot(
          getCachedAuthInfo()?.username || '',
          '/api/followings'
        )
      ) {
        fetchFromApi<Record<string, Following>>(`/api/followings`)
          .then((freshData) => {
            if (!isSameUser()) return;
            if (JSON.stringify(cachedData) !== JSON.stringify(freshData)) {
              cacheManager.cacheFollowings(freshData);
              window.dispatchEvent(
                new CustomEvent('followingsUpdated', {
                  detail: freshData,
                })
              );
            }
          })
          .catch((err) => {
            reportBackgroundSyncFailure('追更', err);
          });
        return cachedData;
      }
      try {
        const freshData = await fetchFromApi<Record<string, Following>>(
          `/api/followings`
        );
        if (!isSameUser()) return {};
        cacheManager.cacheFollowings(freshData);
        return freshData;
      } catch (err) {
        console.warn('获取追更失败(使用缓存/空数据继续, 不弹全局提示):', err);
        return {};
      }
    }

    if (
      cachedData &&
      hasNamespaceSnapshot(
        getCachedAuthInfo()?.username || '',
        '/api/followings'
      )
    ) {
      fetchFromApi<Record<string, Following>>(`/api/followings`)
        .then((freshData) => {
          if (!isSameUser()) return;
          if (JSON.stringify(cachedData) !== JSON.stringify(freshData)) {
            cacheManager.cacheFollowings(freshData);
            window.dispatchEvent(
              new CustomEvent('followingsUpdated', {
                detail: freshData,
              })
            );
          }
        })
        .catch((err) => {
          reportBackgroundSyncFailure('追更', err);
        });

      return cachedData;
    }

    try {
      const freshData = await fetchFromApi<Record<string, Following>>(
        `/api/followings`
      );
      if (!isSameUser()) return {};
      cacheManager.cacheFollowings(freshData);
      return freshData;
    } catch (err) {
      console.warn('获取追更失败(使用缓存/空数据继续, 不弹全局提示):', err);
      return {};
    }
  }

  try {
    const raw = localStorage.getItem(FOLLOWINGS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, Following>;
  } catch (err) {
    console.warn('读取追更列表失败(使用缓存/空数据继续, 不弹全局提示):', err);
    return {};
  }
}

/**
 * 保存追更。
 */
export async function saveFollowing(
  source: string,
  id: string,
  following: Following
): Promise<void> {
  const key = generateStorageKey(source, id);

  if (STORAGE_TYPE !== 'localstorage') {
    const username = (getCachedAuthInfo() || (await refreshAuthInfo()))
      ?.username;
    if (!username) throw new Error('未登入');
    const mutation = recordFollowingMutation(username, key, following);
    const cached = cacheManager.getCachedFollowings() || {};
    cached[key] = following;
    cacheManager.cacheFollowings(cached);
    window.dispatchEvent(
      new CustomEvent('followingsUpdated', {
        detail: cached,
      })
    );

    try {
      await fetchWithAuth('/api/followings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ key, following }),
      });
    } catch (err) {
      await handleDatabaseOperationFailure('followings', err);
      console.warn('保存追更失败(已本地处理, 不弹全局提示)');
      throw err;
    } finally {
      mutation.pending = false;
    }
    return;
  }

  if (typeof window === 'undefined') return;

  try {
    const allFollowings = await getAllFollowings();
    allFollowings[key] = following;
    localStorage.setItem(FOLLOWINGS_KEY, JSON.stringify(allFollowings));
    window.dispatchEvent(
      new CustomEvent('followingsUpdated', {
        detail: allFollowings,
      })
    );
  } catch (err) {
    console.error('保存追更失败:', err);
    console.warn('保存追更失败(已本地处理, 不弹全局提示)');
    throw err;
  }
}

/**
 * 删除追更。
 */
export async function deleteFollowing(
  source: string,
  id: string
): Promise<void> {
  const key = generateStorageKey(source, id);

  if (STORAGE_TYPE !== 'localstorage') {
    const username = (getCachedAuthInfo() || (await refreshAuthInfo()))
      ?.username;
    if (!username) throw new Error('未登入');
    const mutation = recordFollowingMutation(username, key, null);
    const cached = cacheManager.getCachedFollowings() || {};
    delete cached[key];
    cacheManager.cacheFollowings(cached);
    window.dispatchEvent(
      new CustomEvent('followingsUpdated', {
        detail: cached,
      })
    );

    try {
      await fetchWithAuth(`/api/followings?key=${encodeURIComponent(key)}`, {
        method: 'DELETE',
      });
    } catch (err) {
      await handleDatabaseOperationFailure('followings', err);
      console.warn('删除追更失败(已本地处理, 不弹全局提示)');
      throw err;
    } finally {
      mutation.pending = false;
    }
    return;
  }

  if (typeof window === 'undefined') return;

  try {
    const allFollowings = await getAllFollowings();
    delete allFollowings[key];
    localStorage.setItem(FOLLOWINGS_KEY, JSON.stringify(allFollowings));
    window.dispatchEvent(
      new CustomEvent('followingsUpdated', {
        detail: allFollowings,
      })
    );
  } catch (err) {
    console.error('删除追更失败:', err);
    console.warn('删除追更失败(已本地处理, 不弹全局提示)');
    throw err;
  }
}

/**
 * 判断是否已追更。
 */
export async function isFollowing(
  source: string,
  id: string
): Promise<boolean> {
  const key = generateStorageKey(source, id);
  const allFollowings = await getAllFollowings();
  return !!allFollowings[key];
}

/**
 * 批量刷新追更条目的最新集数。
 *
 * 通过一次 POST 调用服务端批量刷新接口，服务端会用搜索方式获取每个追更条目的
 * 最新集数并一次性写回数据库，避免逐个 POST。
 *
 * @param followings 当前用户的追更列表（key 为 source+id）。不传则由服务端从数据库读取。
 * @returns 刷新后的完整追更列表
 */
export interface FollowingRefreshItem {
  key: string;
  source: string;
  id: string;
  title: string;
  total_episodes?: number;
  updated?: boolean;
  reason?: string;
}

export interface FollowingRefreshResult {
  updatedCount: number;
  failedCount: number;
  successCount: number;
  processedCount: number;
  removedCount: number;
  total: number;
}

export interface FollowingRefreshCallbacks {
  onStart?: (total: number) => void;
  onItemResult?: (item: FollowingRefreshItem) => void;
  onItemFailed?: (item: FollowingRefreshItem) => void;
  onItemRemoved?: (key: string) => void;
  onComplete?: (result: FollowingRefreshResult) => void;
}

/**
 * 流式批量刷新追更集数。
 *
 * 服务端通过 SSE 逐条推送成功获取的集数结果，本函数实时解析并：
 *  - 通过 onItemResult / onItemFailed 回调逐条通知调用方（用于实时更新 UI）；
 *  - 维护本地 refreshed 副本，最终返回刷新后的完整追更列表。
 *
 * @param followings 本次要刷新（发送给服务端）的追更子集。首次刷新时为完整列表，
 *                   重试失败项时仅含失败项。
 * @param callbacks 流式回调。
 * @param fullFollowings 完整追更列表（可选）。当 followings 仅为子集（如重试失败项）时，
 *                       传入完整列表作为本地副本/缓存/广播的基础，避免仅含子集的
 *                       refreshed 覆盖掉完整追更缓存与 UI。
 */
export async function refreshFollowingsStream(
  followings: Record<string, Following>,
  callbacks?: FollowingRefreshCallbacks,
  fullFollowings?: Record<string, Following>
): Promise<Record<string, Following>> {
  if (STORAGE_TYPE === 'localstorage') {
    // localstorage 模式无服务端，直接返回当前数据
    return followings || {};
  }

  const username = (getCachedAuthInfo() || (await refreshAuthInfo()))?.username;
  if (!username) return {};
  const isSameUser = () => getCachedAuthInfo()?.username === username;
  const mutationRevision = followingMutationRevision;
  const changedLocally = (key: string) =>
    (followingMutations.get(username)?.get(key)?.revision || 0) >
    mutationRevision;

  // 本地副本：逐条应用服务端返回的最新集数。
  // 以完整列表为基础（若提供），确保广播/缓存时不会丢失未参与本次刷新的条目。
  const refreshed: Record<string, Following> = {
    ...(fullFollowings && Object.keys(fullFollowings).length > 0
      ? fullFollowings
      : followings),
  };

  try {
    const res = await fetchWithAuth('/api/followings/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ followings }),
    });

    if (!res.body) {
      throw new Error('响应无 body，无法流式读取');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let completionSeen = false;
    let expectedTotal = Object.keys(followings).length;
    const processedKeys = new Set<string>();
    const removedKeys = new Set<string>();

    const handleEvent = (raw: string) => {
      if (!isSameUser()) return;
      const line = raw.trim();
      if (!line.startsWith('data:')) return;
      const jsonStr = line.slice(5).trim();
      if (!jsonStr) return;
      let payload: Record<string, any>;
      try {
        payload = JSON.parse(jsonStr);
      } catch {
        return;
      }

      if (
        ['item_result', 'item_failed', 'item_removed'].includes(payload.type) &&
        typeof payload.key === 'string'
      )
        processedKeys.add(payload.key);
      switch (payload.type) {
        case 'start': {
          expectedTotal = payload.total || 0;
          callbacks?.onStart?.(payload.total || 0);
          break;
        }
        case 'item_result': {
          if (changedLocally(payload.key)) break;
          const item: FollowingRefreshItem = {
            key: payload.key,
            source: payload.source,
            id: payload.id,
            title: payload.title || '',
            total_episodes: payload.total_episodes,
            updated: payload.updated,
          };
          // 更新本地副本
          const existing = refreshed[item.key];
          if (existing && item.total_episodes) {
            refreshed[item.key] = {
              ...existing,
              total_episodes: item.total_episodes,
              title: item.title || existing.title,
            };
          }
          callbacks?.onItemResult?.(item);
          break;
        }
        case 'item_removed': {
          removedKeys.add(payload.key);
          if (!changedLocally(payload.key)) {
            delete refreshed[payload.key];
            callbacks?.onItemRemoved?.(payload.key);
          }
          break;
        }
        case 'item_failed': {
          if (changedLocally(payload.key)) break;
          callbacks?.onItemFailed?.({
            key: payload.key,
            source: payload.source,
            id: payload.id,
            title: payload.title || '',
            reason: payload.reason || '',
          });
          break;
        }
        case 'complete': {
          expectedTotal = payload.total ?? expectedTotal;
          completionSeen = processedKeys.size >= expectedTotal;
          callbacks?.onComplete?.({
            updatedCount: payload.updatedCount || 0,
            failedCount: payload.failedCount || 0,
            successCount: payload.successCount || 0,
            processedCount: processedKeys.size,
            removedCount: removedKeys.size,
            total: payload.total || 0,
          });
          break;
        }
        default:
          break;
      }
    };

    // 读取流并解析 SSE 事件
    for (;;) {
      const { done, value } = await reader.read();
      if (!isSameUser()) {
        await reader.cancel();
        return {};
      }
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE 事件以空行分隔
      let sepIndex: number;
      while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
        const eventBlock = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex + 2);
        handleEvent(eventBlock);
      }
    }
    // 处理剩余缓冲
    if (buffer.trim()) {
      handleEvent(buffer);
    }

    if (!isSameUser()) return {};
    if (!completionSeen) throw new Error('追更刷新連線中斷，部分項目尚未完成');

    // Use a new read, not a GET that was already in flight before refresh.
    // Overlay mutations made while refreshing, including a pending unfollow,
    // so a stale server snapshot cannot resurrect a card or reset progress.
    const latestResponse = await fetchWithAuth('/api/followings');
    const latest = (await latestResponse.json()) as Record<string, Following>;
    if (namespaceObservers.get(latestResponse)?.() === false)
      throw new NamespaceSyncError('snapshot', '資料已更新，請重新載入。');
    if (!isSameUser()) return {};
    const reconciled = mergeFollowingMutations(
      mergePendingWrites(
        username,
        '/api/followings',
        latest,
        currentWriteRevision()
      ),
      username,
      mutationRevision
    );
    cacheManager.cacheFollowings(reconciled);
    window.dispatchEvent(
      new CustomEvent('followingsUpdated', { detail: reconciled })
    );
    return reconciled;
  } catch (err) {
    if (!isSameUser()) return {};
    // Preserve the partial cache, but propagate failure so the UI cannot report success.
    cacheManager.cacheFollowings(
      mergeFollowingMutations(
        mergePendingWrites(
          username,
          '/api/followings',
          refreshed,
          currentWriteRevision()
        ),
        username,
        mutationRevision
      )
    );
    throw err;
  }
}

/**
 * 保存收藏。
 * 數據庫存儲模式下使用樂觀更新：先更新緩存，再異步同步到數據庫。
 */
export async function saveFavorite(
  source: string,
  id: string,
  favorite: Favorite
): Promise<void> {
  const key = generateStorageKey(source, id);

  // 數據庫存儲模式：樂觀更新策略
  if (STORAGE_TYPE !== 'localstorage') {
    // 立即更新緩存
    const cachedFavorites = cacheManager.getCachedFavorites() || {};
    cachedFavorites[key] = favorite;
    cacheManager.cacheFavorites(cachedFavorites);

    // 觸發立即更新事件
    window.dispatchEvent(
      new CustomEvent('favoritesUpdated', {
        detail: cachedFavorites,
      })
    );

    // 異步同步到數據庫
    try {
      await fetchWithAuth('/api/favorites', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ key, favorite }),
      });
    } catch (err) {
      await handleDatabaseOperationFailure('favorites', err);
      console.warn('保存收藏失败(已本地处理, 不弹全局提示)');
      throw err;
    }
    return;
  }

  // localStorage 模式
  if (typeof window === 'undefined') {
    console.warn('無法在服務端保存收藏到 localStorage');
    return;
  }

  try {
    const allFavorites = await getAllFavorites();
    allFavorites[key] = favorite;
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(allFavorites));
    window.dispatchEvent(
      new CustomEvent('favoritesUpdated', {
        detail: allFavorites,
      })
    );
  } catch (err) {
    console.error('保存收藏失败:', err);
    console.warn('保存收藏失败(已本地处理, 不弹全局提示)');
    throw err;
  }
}

/**
 * 刪除收藏。
 * 數據庫存儲模式下使用樂觀更新：先更新緩存，再異步同步到數據庫。
 */
export async function deleteFavorite(
  source: string,
  id: string
): Promise<void> {
  const key = generateStorageKey(source, id);

  // 數據庫存儲模式：樂觀更新策略
  if (STORAGE_TYPE !== 'localstorage') {
    // 立即更新緩存
    const cachedFavorites = cacheManager.getCachedFavorites() || {};
    delete cachedFavorites[key];
    cacheManager.cacheFavorites(cachedFavorites);

    // 觸發立即更新事件
    window.dispatchEvent(
      new CustomEvent('favoritesUpdated', {
        detail: cachedFavorites,
      })
    );

    // 異步同步到數據庫
    try {
      await fetchWithAuth(`/api/favorites?key=${encodeURIComponent(key)}`, {
        method: 'DELETE',
      });
    } catch (err) {
      await handleDatabaseOperationFailure('favorites', err);
      console.warn('删除收藏失败(已本地处理, 不弹全局提示)');
      throw err;
    }
    return;
  }

  // localStorage 模式
  if (typeof window === 'undefined') {
    console.warn('無法在服務端刪除收藏到 localStorage');
    return;
  }

  try {
    const allFavorites = await getAllFavorites();
    delete allFavorites[key];
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(allFavorites));
    window.dispatchEvent(
      new CustomEvent('favoritesUpdated', {
        detail: allFavorites,
      })
    );
  } catch (err) {
    console.error('删除收藏失败:', err);
    console.warn('删除收藏失败(已本地处理, 不弹全局提示)');
    throw err;
  }
}

/**
 * 判斷是否已收藏。
 * 數據庫存儲模式下使用混合緩存策略：優先返回緩存數據，後臺異步同步最新數據。
 */
export async function isFavorited(
  source: string,
  id: string
): Promise<boolean> {
  const key = generateStorageKey(source, id);

  // 數據庫存儲模式：使用混合緩存策略
  if (STORAGE_TYPE !== 'localstorage') {
    const cachedFavorites = cacheManager.getCachedFavorites();

    if (
      cachedFavorites &&
      hasNamespaceSnapshot(
        getCachedAuthInfo()?.username || '',
        '/api/favorites'
      )
    ) {
      // 返回緩存數據，同時後臺異步更新
      fetchFromApi<Record<string, Favorite>>(`/api/favorites`)
        .then((freshData) => {
          // 只有數據真正不同時才更新緩存
          if (JSON.stringify(cachedFavorites) !== JSON.stringify(freshData)) {
            cacheManager.cacheFavorites(freshData);
            // 觸發數據更新事件
            window.dispatchEvent(
              new CustomEvent('favoritesUpdated', {
                detail: freshData,
              })
            );
          }
        })
        .catch((err) => {
          reportBackgroundSyncFailure('收藏', err);
        });

      return !!cachedFavorites[key];
    } else {
      // 緩存為空，直接從 API 獲取並緩存
      try {
        const freshData = await fetchFromApi<Record<string, Favorite>>(
          `/api/favorites`
        );
        cacheManager.cacheFavorites(freshData);
        return !!freshData[key];
      } catch (err) {
        console.warn('检查收藏状态失败:', err);
        return false;
      }
    }
  }

  // localStorage 模式
  const allFavorites = await getAllFavorites();
  return !!allFavorites[key];
}

/**
 * 清空全部播放記錄
 * 數據庫存儲模式下使用樂觀更新：先更新緩存，再異步同步到數據庫。
 */
export async function clearAllPlayRecords(): Promise<void> {
  // 數據庫存儲模式：樂觀更新策略
  if (STORAGE_TYPE !== 'localstorage') {
    // 立即更新緩存
    cacheManager.cachePlayRecords({});

    // 觸發立即更新事件
    window.dispatchEvent(
      new CustomEvent('playRecordsUpdated', {
        detail: {},
      })
    );

    // 異步同步到數據庫
    try {
      await fetchWithAuth(`/api/playrecords`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      await handleDatabaseOperationFailure('playRecords', err);
      console.warn('清空播放记录失败(已本地处理, 不弹全局提示)');
      throw err;
    }
    return;
  }

  // localStorage 模式
  if (typeof window === 'undefined') return;
  localStorage.removeItem(PLAY_RECORDS_KEY);
  window.dispatchEvent(
    new CustomEvent('playRecordsUpdated', {
      detail: {},
    })
  );
}

/**
 * 清空全部收藏
 * 數據庫存儲模式下使用樂觀更新：先更新緩存，再異步同步到數據庫。
 */
export async function clearAllFavorites(): Promise<void> {
  // 數據庫存儲模式：樂觀更新策略
  if (STORAGE_TYPE !== 'localstorage') {
    // 立即更新緩存
    cacheManager.cacheFavorites({});

    // 觸發立即更新事件
    window.dispatchEvent(
      new CustomEvent('favoritesUpdated', {
        detail: {},
      })
    );

    // 異步同步到數據庫
    try {
      await fetchWithAuth(`/api/favorites`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      await handleDatabaseOperationFailure('favorites', err);
      console.warn('清空收藏失败(已本地处理, 不弹全局提示)');
      throw err;
    }
    return;
  }

  // localStorage 模式
  if (typeof window === 'undefined') return;
  localStorage.removeItem(FAVORITES_KEY);
  window.dispatchEvent(
    new CustomEvent('favoritesUpdated', {
      detail: {},
    })
  );
}

// ---------------- 混合緩存輔助函數 ----------------

/**
 * 清除當前用戶的所有緩存數據
 * 用於用戶登出時清理緩存
 */
export function clearUserCache(): void {
  if (STORAGE_TYPE !== 'localstorage') {
    cacheManager.clearUserCache();
  }
}

/**
 * 手動刷新所有緩存數據
 * 強制從服務器重新獲取數據並更新緩存
 */
export async function refreshAllCache(): Promise<void> {
  if (STORAGE_TYPE === 'localstorage') return;
  const username = (getCachedAuthInfo() || (await refreshAuthInfo()))?.username;
  if (!username) return;
  const mutationRevision = followingMutationRevision;

  try {
    // 并行刷新所有数据
    const [playRecords, favorites, followings, searchHistory, skipConfigs] =
      await Promise.allSettled([
        fetchFromApi<Record<string, PlayRecord>>(`/api/playrecords`),
        fetchFromApi<Record<string, Favorite>>(`/api/favorites`),
        fetchFromApi<Record<string, Following>>(`/api/followings`),
        fetchFromApi<string[]>(`/api/searchhistory`),
        fetchFromApi<Record<string, SkipConfig>>(`/api/skipconfigs`),
      ]);

    if (getCachedAuthInfo()?.username !== username) return;

    if (playRecords.status === 'fulfilled') {
      cacheManager.cachePlayRecords(playRecords.value);
      window.dispatchEvent(
        new CustomEvent('playRecordsUpdated', {
          detail: playRecords.value,
        })
      );
    }

    if (favorites.status === 'fulfilled') {
      cacheManager.cacheFavorites(favorites.value);
      window.dispatchEvent(
        new CustomEvent('favoritesUpdated', {
          detail: favorites.value,
        })
      );
    }

    if (followings.status === 'fulfilled') {
      const latest = mergeFollowingMutations(
        followings.value,
        username,
        mutationRevision
      );
      cacheManager.cacheFollowings(latest);
      window.dispatchEvent(
        new CustomEvent('followingsUpdated', {
          detail: latest,
        })
      );
    }

    if (searchHistory.status === 'fulfilled') {
      cacheManager.cacheSearchHistory(searchHistory.value);
      window.dispatchEvent(
        new CustomEvent('searchHistoryUpdated', {
          detail: searchHistory.value,
        })
      );
    }

    if (skipConfigs.status === 'fulfilled') {
      cacheManager.cacheSkipConfigs(skipConfigs.value);
      window.dispatchEvent(
        new CustomEvent('skipConfigsUpdated', {
          detail: skipConfigs.value,
        })
      );
    }
  } catch (err) {
    console.warn('刷新缓存失败(不影响使用):', err);
  }
}

/**
 * 獲取緩存狀態信息
 * 用於調試和監控緩存健康狀態
 */
export function getCacheStatus(): {
  hasPlayRecords: boolean;
  hasFavorites: boolean;
  hasFollowings: boolean;
  hasSearchHistory: boolean;
  hasSkipConfigs: boolean;
  username: string | null;
} {
  if (STORAGE_TYPE === 'localstorage') {
    return {
      hasPlayRecords: false,
      hasFavorites: false,
      hasFollowings: false,
      hasSearchHistory: false,
      hasSkipConfigs: false,
      username: null,
    };
  }

  const authInfo = getCachedAuthInfo();
  return {
    hasPlayRecords: !!cacheManager.getCachedPlayRecords(),
    hasFavorites: !!cacheManager.getCachedFavorites(),
    hasFollowings: !!cacheManager.getCachedFollowings(),
    hasSearchHistory: !!cacheManager.getCachedSearchHistory(),
    hasSkipConfigs: !!cacheManager.getCachedSkipConfigs(),
    username: authInfo?.username || null,
  };
}

// ---------------- React Hook 輔助類型 ----------------

export type CacheUpdateEvent =
  | 'playRecordsUpdated'
  | 'favoritesUpdated'
  | 'followingsUpdated'
  | 'searchHistoryUpdated'
  | 'skipConfigsUpdated'
  | 'todayUpdatedUpdated';

/**
 * 用於 React 組件監聽數據更新的事件監聽器
 * 使用方法：
 *
 * useEffect(() => {
 *   const unsubscribe = subscribeToDataUpdates('playRecordsUpdated', (data) => {
 *     setPlayRecords(data);
 *   });
 *   return unsubscribe;
 * }, []);
 */
export function subscribeToDataUpdates<T>(
  eventType: CacheUpdateEvent,
  callback: (data: T) => void
): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleUpdate = (event: CustomEvent) => {
    callback(event.detail);
  };

  window.addEventListener(eventType, handleUpdate as EventListener);

  return () => {
    window.removeEventListener(eventType, handleUpdate as EventListener);
  };
}

/**
 * 預加載所有用戶數據到緩存
 * 適合在應用啟動時調用，提升後續訪問速度
 */
export async function preloadUserData(): Promise<void> {
  if (STORAGE_TYPE === 'localstorage') return;

  // 檢查是否已有有效緩存，避免重復請求
  const status = getCacheStatus();
  if (
    status.hasPlayRecords &&
    status.hasFavorites &&
    status.hasFollowings &&
    status.hasSearchHistory &&
    status.hasSkipConfigs
  ) {
    return;
  }

  // 後臺靜默預加載，不阻塞界面
  refreshAllCache().catch((err) => {
    console.warn('预加载用户数据失败:', err);
  });
}

// ---------------- 跳過片頭片尾配置相關 API ----------------

/**
 * 獲取跳過片頭片尾配置。
 * 數據庫存儲模式下使用混合緩存策略：優先返回緩存數據，後臺異步同步最新數據。
 */
export async function getSkipConfig(
  source: string,
  id: string
): Promise<SkipConfig | null> {
  // 服務器端渲染階段直接返回空
  if (typeof window === 'undefined') {
    return null;
  }

  const key = generateStorageKey(source, id);

  // 數據庫存儲模式：使用混合緩存策略
  if (STORAGE_TYPE !== 'localstorage') {
    // 優先從緩存獲取數據
    const cachedData = cacheManager.getCachedSkipConfigs();

    if (cachedData) {
      // 返回緩存數據，同時後臺異步更新
      fetchFromApi<Record<string, SkipConfig>>(`/api/skipconfigs`)
        .then((freshData) => {
          // 只有數據真正不同時才更新緩存
          if (JSON.stringify(cachedData) !== JSON.stringify(freshData)) {
            cacheManager.cacheSkipConfigs(freshData);
            // 觸發數據更新事件
            window.dispatchEvent(
              new CustomEvent('skipConfigsUpdated', {
                detail: freshData,
              })
            );
          }
        })
        .catch((err) => {
          console.warn('後臺同步跳過片頭片尾配置失敗:', err);
        });

      return cachedData[key] || null;
    } else {
      // 緩存為空，直接從 API 獲取並緩存
      try {
        const freshData = await fetchFromApi<Record<string, SkipConfig>>(
          `/api/skipconfigs`
        );
        cacheManager.cacheSkipConfigs(freshData);
        return freshData[key] || null;
      } catch (err) {
        console.warn(
          '获取跳过片头片尾配置失败(使用缓存/空数据继续, 不弹全局提示):',
          err
        );
        return null;
      }
    }
  }

  // localStorage 模式
  try {
    const raw = localStorage.getItem('moontv_skip_configs');
    if (!raw) return null;
    const configs = JSON.parse(raw) as Record<string, SkipConfig>;
    return configs[key] || null;
  } catch (err) {
    console.warn(
      '读取跳过片头片尾配置失败(使用缓存/空数据继续, 不弹全局提示):',
      err
    );
    return null;
  }
}

/**
 * 保存跳過片頭片尾配置。
 * 數據庫存儲模式下使用樂觀更新：先更新緩存，再異步同步到數據庫。
 */
export async function saveSkipConfig(
  source: string,
  id: string,
  config: SkipConfig
): Promise<void> {
  const key = generateStorageKey(source, id);

  // 數據庫存儲模式：樂觀更新策略
  if (STORAGE_TYPE !== 'localstorage') {
    // 立即更新緩存
    const cachedConfigs = cacheManager.getCachedSkipConfigs() || {};
    cachedConfigs[key] = config;
    cacheManager.cacheSkipConfigs(cachedConfigs);

    // 觸發立即更新事件
    window.dispatchEvent(
      new CustomEvent('skipConfigsUpdated', {
        detail: cachedConfigs,
      })
    );

    // 異步同步到數據庫
    try {
      await fetchWithAuth('/api/skipconfigs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ key, config }),
      });
    } catch (err) {
      console.error('保存跳过片头片尾配置失败:', err);
      console.warn('保存跳过片头片尾配置失败(已本地处理, 不弹全局提示)');
    }
    return;
  }

  // localStorage 模式
  if (typeof window === 'undefined') {
    console.warn('無法在服務端保存跳過片頭片尾配置到 localStorage');
    return;
  }

  try {
    const raw = localStorage.getItem('moontv_skip_configs');
    const configs = raw ? (JSON.parse(raw) as Record<string, SkipConfig>) : {};
    configs[key] = config;
    localStorage.setItem('moontv_skip_configs', JSON.stringify(configs));
    window.dispatchEvent(
      new CustomEvent('skipConfigsUpdated', {
        detail: configs,
      })
    );
  } catch (err) {
    console.error('保存跳过片头片尾配置失败:', err);
    console.warn('保存跳过片头片尾配置失败(已本地处理, 不弹全局提示)');
    throw err;
  }
}

/**
 * 獲取所有跳過片頭片尾配置。
 * 數據庫存儲模式下使用混合緩存策略：優先返回緩存數據，後臺異步同步最新數據。
 */
export async function getAllSkipConfigs(): Promise<Record<string, SkipConfig>> {
  // 服務器端渲染階段直接返回空
  if (typeof window === 'undefined') {
    return {};
  }

  // 數據庫存儲模式：使用混合緩存策略
  if (STORAGE_TYPE !== 'localstorage') {
    // 優先從緩存獲取數據
    const cachedData = cacheManager.getCachedSkipConfigs();

    if (cachedData) {
      // 返回緩存數據，同時後臺異步更新
      fetchFromApi<Record<string, SkipConfig>>(`/api/skipconfigs`)
        .then((freshData) => {
          // 只有數據真正不同時才更新緩存
          if (JSON.stringify(cachedData) !== JSON.stringify(freshData)) {
            cacheManager.cacheSkipConfigs(freshData);
            // 觸發數據更新事件
            window.dispatchEvent(
              new CustomEvent('skipConfigsUpdated', {
                detail: freshData,
              })
            );
          }
        })
        .catch((err) => {
          reportBackgroundSyncFailure('跳过片头片尾配置', err);
        });

      return cachedData;
    } else {
      // 緩存為空，直接從 API 獲取並緩存
      try {
        const freshData = await fetchFromApi<Record<string, SkipConfig>>(
          `/api/skipconfigs`
        );
        cacheManager.cacheSkipConfigs(freshData);
        return freshData;
      } catch (err) {
        console.warn(
          '获取跳过片头片尾配置失败(使用缓存/空数据继续, 不弹全局提示):',
          err
        );
        return {};
      }
    }
  }

  // localStorage 模式
  try {
    const raw = localStorage.getItem('moontv_skip_configs');
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, SkipConfig>;
  } catch (err) {
    console.warn(
      '读取跳过片头片尾配置失败(使用缓存/空数据继续, 不弹全局提示):',
      err
    );
    return {};
  }
}

/**
 * 刪除跳過片頭片尾配置。
 * 數據庫存儲模式下使用樂觀更新：先更新緩存，再異步同步到數據庫。
 */
export async function deleteSkipConfig(
  source: string,
  id: string
): Promise<void> {
  const key = generateStorageKey(source, id);

  // 數據庫存儲模式：樂觀更新策略
  if (STORAGE_TYPE !== 'localstorage') {
    // 立即更新緩存
    const cachedConfigs = cacheManager.getCachedSkipConfigs() || {};
    delete cachedConfigs[key];
    cacheManager.cacheSkipConfigs(cachedConfigs);

    // 觸發立即更新事件
    window.dispatchEvent(
      new CustomEvent('skipConfigsUpdated', {
        detail: cachedConfigs,
      })
    );

    // 異步同步到數據庫
    try {
      await fetchWithAuth(`/api/skipconfigs?key=${encodeURIComponent(key)}`, {
        method: 'DELETE',
      });
    } catch (err) {
      console.error('删除跳过片头片尾配置失败:', err);
      console.warn('删除跳过片头片尾配置失败(已本地处理, 不弹全局提示)');
    }
    return;
  }

  // localStorage 模式
  if (typeof window === 'undefined') {
    console.warn('無法在服務端刪除跳過片頭片尾配置到 localStorage');
    return;
  }

  try {
    const raw = localStorage.getItem('moontv_skip_configs');
    if (raw) {
      const configs = JSON.parse(raw) as Record<string, SkipConfig>;
      delete configs[key];
      localStorage.setItem('moontv_skip_configs', JSON.stringify(configs));
      window.dispatchEvent(
        new CustomEvent('skipConfigsUpdated', {
          detail: configs,
        })
      );
    }
  } catch (err) {
    console.error('删除跳过片头片尾配置失败:', err);
    console.warn('删除跳过片头片尾配置失败(已本地处理, 不弹全局提示)');
    throw err;
  }
}

// ---------------- “今日新更”相关 API ----------------

// localStorage 模式下“今日新更”记录的存储 key
const TODAY_UPDATED_KEY = 'moontv_today_updated';

/**
 * 获取“今日新更”记录。
 * 数据库存储模式下使用混合缓存策略：优先返回缓存数据，后台异步同步最新数据。
 * 服务器端渲染阶段返回 null。
 */
export async function getTodayUpdated(): Promise<TodayUpdatedRecord | null> {
  // 服务器端渲染阶段直接返回空
  if (typeof window === 'undefined') {
    return null;
  }

  // 数据库存储模式：使用混合缓存策略（包括 redis 和 upstash）
  if (STORAGE_TYPE !== 'localstorage') {
    const username = (getCachedAuthInfo() || (await refreshAuthInfo()))
      ?.username;
    if (!username) return null;
    const isSameUser = () => getCachedAuthInfo()?.username === username;
    // 优先从缓存获取数据
    const cachedData = cacheManager.getCachedTodayUpdated();

    if (cachedData !== null) {
      // 返回缓存数据，同时后台异步更新
      fetchFromApi<TodayUpdatedRecord | null>(`/api/today-updated`)
        .then((freshData) => {
          if (!isSameUser()) return;
          // 只有数据真正不同时才更新缓存
          if (JSON.stringify(cachedData) !== JSON.stringify(freshData)) {
            cacheManager.cacheTodayUpdated(freshData);
            // 触发数据更新事件
            window.dispatchEvent(
              new CustomEvent('todayUpdatedUpdated', {
                detail: freshData,
              })
            );
          }
        })
        .catch((err) => {
          console.warn('后台同步“今日新更”记录失败:', err);
        });

      return cachedData;
    } else {
      // 缓存为空，直接从 API 获取并缓存
      try {
        const freshData = await fetchFromApi<TodayUpdatedRecord | null>(
          `/api/today-updated`
        );
        if (!isSameUser()) return null;
        cacheManager.cacheTodayUpdated(freshData);
        return freshData;
      } catch (err) {
        console.warn(
          '获取“今日新更”记录失败(使用缓存/空数据继续, 不弹全局提示):',
          err
        );
        return null;
      }
    }
  }

  // localStorage 模式
  try {
    const raw = localStorage.getItem(TODAY_UPDATED_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as TodayUpdatedRecord;
  } catch (err) {
    console.warn(
      '读取“今日新更”记录失败(使用缓存/空数据继续, 不弹全局提示):',
      err
    );
    return null;
  }
}

/**
 * 保存“今日新更”记录。
 * 数据库存储模式下使用乐观更新：先更新缓存，再异步同步到数据库。
 */
export async function saveTodayUpdated(
  record: TodayUpdatedRecord
): Promise<void> {
  // 数据库存储模式：乐观更新策略（包括 redis 和 upstash）
  if (STORAGE_TYPE !== 'localstorage') {
    // 立即更新缓存
    cacheManager.cacheTodayUpdated(record);

    // 触发立即更新事件
    window.dispatchEvent(
      new CustomEvent('todayUpdatedUpdated', {
        detail: record,
      })
    );

    // 异步同步到数据库
    try {
      await fetchWithAuth('/api/today-updated', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(record),
      });
    } catch (err) {
      console.error('保存“今日新更”记录失败:', err);
      console.warn('保存“今日新更”记录失败(已本地处理, 不弹全局提示)');
    }
    return;
  }

  // localStorage 模式
  if (typeof window === 'undefined') {
    console.warn('无法在服务端保存“今日新更”记录到 localStorage');
    return;
  }

  try {
    localStorage.setItem(TODAY_UPDATED_KEY, JSON.stringify(record));
    window.dispatchEvent(
      new CustomEvent('todayUpdatedUpdated', {
        detail: record,
      })
    );
  } catch (err) {
    console.error('保存“今日新更”记录失败:', err);
    console.warn('保存“今日新更”记录失败(已本地处理, 不弹全局提示)');
    throw err;
  }
}
