/* eslint-disable react-hooks/exhaustive-deps, @typescript-eslint/no-explicit-any */
'use client';

import { ChevronUp, Search, X } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';

import {
  addSearchHistory,
  clearSearchHistory,
  deleteSearchHistory,
  getSearchHistory,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { SearchResult } from '@/lib/types';
import { getRequestTimeout } from '@/lib/utils';

import FailedSourcesDisplay from '@/components/FailedSourcesDisplay';
import FilterOptions from '@/components/FilterOptions';
import PageLayout from '@/components/PageLayout';
import SearchSuggestions from '@/components/SearchSuggestions';
import SourceSelector from '@/components/SourceSelector';
import VideoCard from '@/components/VideoCard';


function SearchPageClient() {
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [showBackToTop, setShowBackToTop] = useState(false);

  const searchParams = useSearchParams();
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [failedSources, setFailedSources] = useState<{ name: string; key: string; error: string }[]>([]);
  const [selectedHistoryItem, setSelectedHistoryItem] = useState<string | null>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const [hasResetOnEmptyParams, setHasResetOnEmptyParams] = useState(true);

  // 分頁加載相關狀態
  const [displayedExactCount, setDisplayedExactCount] = useState(20); // 初始顯示20個精確匹配結果
  const [displayedOthersCount, setDisplayedOthersCount] = useState(20); // 初始顯示20個其他結果
  const loadingMoreExactRef = useRef<HTMLDivElement>(null);
  const loadingMoreOthersRef = useRef<HTMLDivElement>(null);
  const observerExactRef = useRef<IntersectionObserver | null>(null);
  const observerOthersRef = useRef<IntersectionObserver | null>(null);

  // 篩選狀態 - 從 URL 參數初始化，如果沒有URL參數則從保存的源讀取
  const [searchSources, setSearchSources] = useState<string[]>(() => {
    const sources = searchParams.get('sources');
    if (sources) {
      return sources.split(',');
    }

    // 如果沒有URL參數，檢查是否有保存的源
    if (typeof window !== 'undefined') {
      const savedSources = localStorage.getItem('savedSources');
      if (savedSources) {
        try {
          return JSON.parse(savedSources);
        } catch (error) {
          /* ignore parse error */
        }
      }
    }

    return [];
  });
  const [selectedTitles, setSelectedTitles] = useState<string[]>(() => {
    const titles = searchParams.get('titles');
    return titles ? titles.split(',') : [];
  });
  const [selectedYears, setSelectedYears] = useState<string[]>(() => {
    const years = searchParams.get('years');
    return years ? years.split(',') : [];
  });

  // 搜索結果來源篩選狀態 - 從 URL 參數初始化
  const [filterSources, setFilterSources] = useState<string[]>(() => {
    const sources = searchParams.get('filter_sources');
    return sources ? sources.split(',') : [];
  });
  // 新增狀態：記錄當前展開的篩選框
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  // 排序狀態：字段與順序（默認：按源數量，倒序）
  const [sortField, setSortField] = useState<'sources' | 'year' | 'episodes'>(() => {
    const sf = searchParams.get('sort');
    return sf === 'sources' || sf === 'episodes' || sf === 'year' ? sf : 'sources';
  });
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(() => {
    const so = searchParams.get('order');
    return so === 'asc' ? 'asc' : 'desc';
  });


  const [viewMode, setViewMode] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const userSetting = localStorage.getItem('defaultAggregateSearch');
      return userSetting !== null ? userSetting === 'true' : true;
    }
    return true;
  });

  const [streamEnabled, setStreamEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const defaultSaved = localStorage.getItem('defaultStreamSearch');
      return defaultSaved !== null ? defaultSaved === 'true' : true;
    }
    return true;
  });

  // 聚合後的結果
  const aggregatedResults = useMemo(() => {
    const map = new Map<string, SearchResult[]>();
    searchResults.forEach((item) => {
      // 使用標準化的標題（移除多餘空格但保留單詞間的單個空格）作為聚合鍵的一部分
      const normalizedTitle = item.title.trim().replace(/\s+/g, ' ');
      const key = `${normalizedTitle}-${item.year || 'unknown'}-${item.episodes.length === 1 ? 'movie' : 'tv'}`;
      const arr = map.get(key) || [];
      arr.push(item);
      map.set(key, arr);
    });
    return Array.from(map.entries()).sort((a, b) => {
      const aExactMatch = a[1][0].title.toLowerCase().includes(searchQuery.trim().toLowerCase());
      const bExactMatch = b[1][0].title.toLowerCase().includes(searchQuery.trim().toLowerCase());
      if (aExactMatch && !bExactMatch) return -1;
      if (!aExactMatch && bExactMatch) return 1;

      const aYear = a[1][0].year;
      const bYear = b[1][0].year;
      if (aYear === bYear) return a[1][0].title.localeCompare(b[1][0].title);
      if (aYear === 'unknown') return 1;
      if (bYear === 'unknown') return 1;
      return aYear > bYear ? -1 : 1;
    });
  }, [searchResults]);

  // 用於篩選後的聚合結果，保證類型安全
  const filteredAggregatedResults: [string, SearchResult[]][] = useMemo(() => {
    return aggregatedResults
      .filter(([_key, group]) => {
        // 來源篩選：如果沒有選擇任何來源（filterSources.length === 0），默認顯示全部；如果選擇了來源，只保留包含至少一個選中來源的影片組
        const sourceMatch = filterSources.length === 0 ||
          group.some(item => filterSources.includes(item.source_name));
        // 標題篩選：如果選擇了標題，只保留標題匹配的影片組
        const titleMatch = selectedTitles.length === 0 ||
          selectedTitles.includes(group[0].title);
        // 年份篩選：如果選擇了年份，只保留年份匹配的影片組
        const yearMatch = selectedYears.length === 0 ||
          selectedYears.includes(group[0].year);
        return sourceMatch && titleMatch && yearMatch;
      })
      .map(([_key, group]) => {
        // 在組內也進行篩選，確保組內每個項目都符合篩選條件
        const filteredGroup = group.filter((item) => {
          const titleMatch = selectedTitles.length === 0 || selectedTitles.includes(item.title);
          const yearMatch = selectedYears.length === 0 || selectedYears.includes(item.year);
          return titleMatch && yearMatch;
        });
        return [_key, filteredGroup] as [string, SearchResult[]];
      })
      .filter(([_, group]) => group.length > 0);
  }, [aggregatedResults, filterSources, selectedTitles, selectedYears]);

// 返回兩個數組：exact 和 others
const sortedAggregatedResults: { exact: [string, SearchResult[]][], others: [string, SearchResult[]][] } = useMemo(() => {
  const aggregateMode = viewMode;
  const groups: [string, SearchResult[]][] = aggregateMode
    ? filteredAggregatedResults
    : searchResults.map(item => [
        `${item.title}-${item.year}-${item.source_name}`,
        [item],
      ]);

  const query = (searchParams.get('q') ?? '').trim().toLowerCase();
  const isExact = (group: SearchResult[]) => group[0].title.toLowerCase().includes(query);

  const getYearValue = (group: SearchResult[]) => {
    const y = group[0].year;
    if (!y || y === 'unknown') return null;
    const n = Number(y);
    return Number.isNaN(n) ? null : n;
  };

  const getSourcesCount = (group: SearchResult[]) => group.length;
  const getEpisodesCount = (group: SearchResult[]) => {
    let maxEpisodes = 0;
    for (const item of group) {
      const count = Array.isArray(item.episodes) ? item.episodes.length : 0;
      if (count > maxEpisodes) maxEpisodes = count;
    }
    return maxEpisodes;
  };

  const valueOf = (group: SearchResult[]) => {
    switch (sortField) {
      case 'sources': return getSourcesCount(group);
      case 'episodes': return getEpisodesCount(group);
      case 'year':
      default: return getYearValue(group);
    }
  };

  const compare = (a: [string, SearchResult[]], b: [string, SearchResult[]]) => {
    const aVal = valueOf(a[1]);
    const bVal = valueOf(b[1]);
    const aIsNull = aVal === null || aVal === undefined;
    const bIsNull = bVal === null || bVal === undefined;
    if (aIsNull && !bIsNull) return 1;
    if (!aIsNull && bIsNull) return -1;
    if (aIsNull && bIsNull) return 0;

    if ((aVal as number) < (bVal as number)) return sortOrder === 'asc' ? -1 : 1;
    if ((aVal as number) > (bVal as number)) return sortOrder === 'asc' ? 1 : -1;

    return a[1][0].title.localeCompare(b[1][0].title);
  };

  const exact: [string, SearchResult[]][] = [];
  const others: [string, SearchResult[]][] = [];
  for (const item of groups) {
    (isExact(item[1]) ? exact : others).push(item);
  }
  exact.sort(compare);
  others.sort(compare);

  return { exact, others };
}, [filteredAggregatedResults, searchResults, sortField, sortOrder, searchQuery, viewMode]);

  // 分頁顯示的結果
  const displayedExactResults = useMemo(() => {
    return sortedAggregatedResults.exact.slice(0, displayedExactCount);
  }, [sortedAggregatedResults.exact, displayedExactCount]);

  const displayedOthersResults = useMemo(() => {
    return sortedAggregatedResults.others.slice(0, displayedOthersCount);
  }, [sortedAggregatedResults.others, displayedOthersCount]);

  const hasMoreExact = sortedAggregatedResults.exact.length > displayedExactCount;
  const hasMoreOthers = sortedAggregatedResults.others.length > displayedOthersCount;



  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchSearchResults = async (query: string) => {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      setIsLoading(true);
      setSearchResults([]);
      setFailedSources([]);
      setShowResults(true);

      const params = new URLSearchParams({ q: query.trim() });
      params.set('stream', streamEnabled ? '1' : '0');

      // 添加選中的搜索源到請求參數
      if (searchSources.length > 0) {
        params.set('sources', searchSources.join(','));
      }

      // 添加超時時間參數
      const timeoutSeconds = getRequestTimeout();
      params.set('timeout', timeoutSeconds.toString());

      const response = await fetch(`/api/search?${params.toString()}`, {
        signal: controller.signal,
      });

      if (!streamEnabled) {
        const json = await response.json();
        setSearchResults(json.results || []);
        setFailedSources(json.failedSources || []);
        setIsLoading(false);
      } else {
        if (!response.body) return;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let done = false;
        let buffer = '';
        let firstResult = true;

        while (!done) {
          const { value, done: readerDone } = await reader.read();
          done = readerDone;

          if (value) {
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const json = JSON.parse(line);
                if (json.pageResults?.length) {
                  setSearchResults((prev) => [...prev, ...json.pageResults]);
                  if (firstResult) {
                    setIsLoading(false);
                    firstResult = false;
                  }
                }
                if (json.failedSources) setFailedSources(json.failedSources);
              } catch {
                //
              }
            }
          }
        }

        if (buffer.trim()) {
          try {
            const json = JSON.parse(buffer);
            if (json.pageResults) setSearchResults((prev) => [...prev, ...json.pageResults]);
            if (json.failedSources) setFailedSources(json.failedSources);
          } catch {
            //
          }
        }

        setIsLoading(false);
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      setSearchResults([]);
    }
  };

  // 初始化：搜索歷史、滾動監聽
  useEffect(() => {
    getSearchHistory().then(setSearchHistory);
    const unsubscribe = subscribeToDataUpdates('searchHistoryUpdated', setSearchHistory);
    const handleScroll = () => {
      setShowBackToTop((document.body.scrollTop || 0) > 300);
    };
    document.body.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      unsubscribe();
      document.body.removeEventListener('scroll', handleScroll);
    };
  }, []);

  // 設置滾動監聽，實現分頁加載 - 精確匹配結果
  useEffect(() => {
    if (!loadingMoreExactRef.current || isLoading || !hasMoreExact) {
      return;
    }

    // 清理舊的觀察者
    if (observerExactRef.current) {
      observerExactRef.current.disconnect();
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMoreExact) {
          setDisplayedExactCount((prev) => prev + 20);
        }
      },
      {
        threshold: 0.1,
        rootMargin: '200px' // 提前200px開始加載，提供更流暢的體驗
      }
    );

    observer.observe(loadingMoreExactRef.current);
    observerExactRef.current = observer;

    return () => {
      if (observerExactRef.current) {
        observerExactRef.current.disconnect();
      }
    };
  }, [hasMoreExact, isLoading]);

  // 設置滾動監聽，實現分頁加載 - 其他結果
  useEffect(() => {
    if (!loadingMoreOthersRef.current || isLoading || !hasMoreOthers || hasMoreExact) {
      // 如果還有精確匹配結果未加載完，不監聽其他結果
      return;
    }

    // 清理舊的觀察者
    if (observerOthersRef.current) {
      observerOthersRef.current.disconnect();
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMoreOthers && !hasMoreExact) {
          setDisplayedOthersCount((prev) => prev + 20);
        }
      },
      {
        threshold: 0.1,
        rootMargin: '200px' // 提前200px開始加載，提供更流暢的體驗
      }
    );

    observer.observe(loadingMoreOthersRef.current);
    observerOthersRef.current = observer;

    return () => {
      if (observerOthersRef.current) {
        observerOthersRef.current.disconnect();
      }
    };
  }, [hasMoreExact, hasMoreOthers, isLoading]);

  // 提取當前的查詢參數 q 和 sources
  const currentQuery = useMemo(() => searchParams.get('q'), [searchParams]);
  const currentSources = useMemo(() => searchParams.get('sources'), [searchParams]);

  // 監聽查詢變化時重置分頁
  useEffect(() => {
    if (currentQuery) {
      setDisplayedExactCount(20);
      setDisplayedOthersCount(20);
    }
  }, [currentQuery]);

  // 同步搜索源配置（當 sources 參數變化時）
  useEffect(() => {
    if (currentSources) {
      setSearchSources(currentSources.split(','));
    }
  }, [currentSources]);

  // 監聽查詢參數 q 的變化並觸發搜索（只在 q 變化時觸發）
  useEffect(() => {
    if (currentQuery) {
      // 觸發搜索
      setSearchQuery(currentQuery);
      setIsLoading(true);
      setShowResults(true);
      fetchSearchResults(currentQuery);
      addSearchHistory(currentQuery);
    } else {
      // 沒有搜索參數時，聚焦輸入框
      document.getElementById('searchInput')?.focus();
    }
  }, [currentQuery]); // 只依賴查詢參數 q，僅在 q 變化時觸發

  // 監聽URL參數變化，當URL變為無參數時重新掛載組件（只執行一次）
  useEffect(() => {
    const urlQuery = searchParams.get('q');
    // 如果之前有搜索參數但現在沒有了，說明URL變成了無參數狀態，且尚未執行過重置
    if (!urlQuery && !hasResetOnEmptyParams) {
      // 重置狀態，模擬組件重新掛載
      setShowResults(false);
      setHasResetOnEmptyParams(true);
    } else if (urlQuery) {
      // 當有搜索參數時，重置標志位，以便下次可以再次觸發
      setHasResetOnEmptyParams(false);
    }
  }, [searchParams, hasResetOnEmptyParams]);

  // 點擊空白處取消高亮
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (historyRef.current && !historyRef.current.contains(e.target as Node)) {
        setSelectedHistoryItem(null);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  // 更新篩選狀態到 URL
  useEffect(() => {
    const params = new URLSearchParams(searchParams);

    if (searchSources.length > 0) {
      params.set('sources', searchSources.join(','));
    } else {
      params.delete('sources');
    }

    if (filterSources.length > 0) {
      params.set('filter_sources', filterSources.join(','));
    } else {
      params.delete('filter_sources');
    }

    if (selectedTitles.length > 0) {
      params.set('titles', selectedTitles.join(','));
    } else {
      params.delete('titles');
    }

    if (selectedYears.length > 0) {
      params.set('years', selectedYears.join(','));
    } else {
      params.delete('years');
    }

    // 排序字段與順序
    if (sortField) {
      params.set('sort', sortField);
    } else {
      params.delete('sort');
    }
    if (sortOrder) {
      params.set('order', sortOrder);
    } else {
      params.delete('order');
    }

    // 只在有搜索查詢時才更新 URL
    if (searchParams.get('q')) {
      window.history.replaceState({}, '', `/search?${params.toString()}`);
    }
  }, [filterSources, selectedTitles, selectedYears, sortField, sortOrder, searchParams]); // 移除 selectedSources 依賴，避免選擇搜索源時觸發重新搜索

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchQuery(value);
    setShowSuggestions(!!value.trim());
  };

  const handleInputFocus = () => {
    if (searchQuery.trim()) setShowSuggestions(true);
  };

  const handleSearch = (e?: React.FormEvent, query?: string) => {
    if (e) e.preventDefault(); // 如果是表單觸發，阻止默認行為
    const trimmed = (query ?? searchQuery).trim().replace(/\s+/g, ' ');
    if (!trimmed) return;

    setShowSuggestions(false);
    // 更新URL，由useEffect監聽觸發搜索
    const urlParams = new URLSearchParams();
    urlParams.set('q', trimmed);
    if (searchSources.length > 0) {
      urlParams.set('sources', searchSources.join(','));
    }
    // 添加超時時間參數
    const timeoutSeconds = getRequestTimeout();
    urlParams.set('timeout', timeoutSeconds.toString());
    window.history.pushState({}, '', `/search?${urlParams.toString()}`);
  };

  const handleSuggestionSelect = (suggestion: string) => {
    setShowSuggestions(false);
    // 更新URL，由useEffect監聽觸發搜索
    const urlParams = new URLSearchParams();
    urlParams.set('q', suggestion);
    if (searchSources.length > 0) {
      urlParams.set('sources', searchSources.join(','));
    }
    // 添加超時時間參數
    const timeoutSeconds = getRequestTimeout();
    urlParams.set('timeout', timeoutSeconds.toString());
    window.history.pushState({}, '', `/search?${urlParams.toString()}`);
  };

  const scrollToTop = () => {
    try {
      document.body.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      document.body.scrollTop = 0;
    }
  };

  // 生成篩選選項
  const sourceOptions = Array.from(new Set(searchResults.map((r) => r.source_name))).sort();
  const titleOptions = Array.from(new Set(searchResults.map((r) => r.title))).sort();
  const yearOptions = Array.from(new Set(searchResults.map((r) => r.year))).sort();

  // 處理排序字段變化的包裝函數
  const handleSortFieldChange = (field: string) => {
    setSortField(field as 'sources' | 'year' | 'episodes');
  };

  return (
    <PageLayout activePath="/search">
      <div className="px-4 sm:px-10 py-4 sm:py-8 overflow-visible mb-10">
        {/* 移動端搜索框和搜索源選擇器 */}
        <div className="mb-7 max-w-2xl mx-auto md:hidden">
          <div className="flex items-center">
            {/* 搜索源選擇器 - 在搜索框左側，作為一個整體 */}
            <div className="flex-shrink-0">
              <SourceSelector
                selectedSources={searchSources}
                onChange={setSearchSources}
                openFilter={openFilter}
                setOpenFilter={setOpenFilter}
              />
            </div>

            {/* 搜索框 */}
            <form onSubmit={handleSearch} className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
              <input
                id="searchInput"
                type="text"
                value={searchQuery}
                onChange={handleInputChange}
                onFocus={handleInputFocus}
                placeholder="搜索電影、電視劇..."
                className="w-full h-12 rounded-r-lg rounded-l-none bg-gray-50/80 py-3 pl-10 pr-4 text-base text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-400 focus:bg-white border border-gray-200/50 border-l-0 shadow-sm dark:bg-gray-800 dark:text-gray-300 dark:placeholder-gray-500 dark:focus:bg-gray-700 dark:border-gray-700 dark:border-l-0"
              />

              <SearchSuggestions query={searchQuery} isVisible={showSuggestions} onSelect={handleSuggestionSelect} onClose={() => setShowSuggestions(false)} />
            </form>
          </div>
        </div>




        {/* 搜索結果 */}
        <div className="max-w-[95%] mx-auto overflow-visible">
          {isLoading ? (
            <div className="flex justify-center items-center h-40">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-500"></div>
            </div>
          ) : showResults ? (
            <section className="mb-12">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <h2 className="text-xl font-bold text-gray-800 dark:text-gray-200">搜索結果</h2>
                <FailedSourcesDisplay failedSources={failedSources} />
              </div>
              <div className="flex items-center gap-4">
                {/* 流式/聚合切換 */}
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <span className="text-sm text-gray-700 dark:text-gray-300">流式</span>
                  <div className="relative">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={streamEnabled}
                      onChange={() => setStreamEnabled(!streamEnabled)}
                    />
                    <div className="w-9 h-5 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors dark:bg-gray-600"></div>
                    <div className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-4"></div>
                  </div>
                </label>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <span className="text-sm text-gray-700 dark:text-gray-300">聚合</span>
                  <div className="relative">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={viewMode} // true 表示聚合
                      onChange={() => setViewMode(!viewMode)}
                    />
                    <div className="w-9 h-5 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors dark:bg-gray-600"></div>
                    <div className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-4"></div>
                  </div>
                </label>
              </div>
            </div>

            {/* 篩選組件彈窗 */}
            {showResults && searchResults.length > 0 && (
              <div className="flex gap-3 flex-wrap mb-7 max-w-[100%] mx-auto">
                <FilterOptions
                  openFilter={openFilter}
                  setOpenFilter={setOpenFilter}
                  sourceOptions={sourceOptions}
                  filterSources={filterSources}
                  setFilterSources={setFilterSources}
                  titleOptions={titleOptions}
                  selectedTitles={selectedTitles}
                  setSelectedTitles={setSelectedTitles}
                  yearOptions={yearOptions}
                  selectedYears={selectedYears}
                  setSelectedYears={setSelectedYears}
                  sortField={sortField}
                  onSortFieldChange={handleSortFieldChange}
                  sortOrder={sortOrder}
                  onSortOrderChange={setSortOrder}
                  sortOptions={[
                    { value: "sources", label: "按源數量" },
                    { value: "year", label: "按年份" },
                    { value: "episodes", label: "按集數" },
                  ]}
                />
              </div>
            )}

            {/* 精確匹配結果 */}
            <div
              key={`search-results-${viewMode}`}
              className="justify-start grid grid-cols-3 gap-x-2 gap-y-14 sm:gap-y-20 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8"
            >
              {displayedExactResults.map(([mapKey, group], index) => {
                if (viewMode) {
                  return (
                    <div key={`agg-${mapKey}-${index}`} className="w-full">
                      <VideoCard
                        from="search"
                        items={group}
                        query={searchQuery.trim() !== group[0].title ? searchQuery.trim() : ''}
                      />
                    </div>
                  );
                } else {
                  const item = group[0];
                  return (
                    <div key={`all-${mapKey}-${index}`} className="w-full">
                      <VideoCard
                        id={item.id}
                        title={item.title || ''}
                        poster={item.poster}
                        episodes={item.episodes ? item.episodes.length : 0} // 轉為 number
                        source={item.source}
                        source_name={item.source_name}
                        douban_id={item.douban_id}
                        query={searchQuery.trim() !== item.title ? searchQuery.trim() : ''}
                        year={item.year}
                        from="search"
                        type={item.episodes && item.episodes.length > 1 ? 'tv' : 'movie'}
                      />
                    </div>
                  );
                }
              })}

              {sortedAggregatedResults.exact.length === 0 && sortedAggregatedResults.others.length === 0 && (
                <div className="col-span-full text-center text-gray-500 py-8 dark:text-gray-400">
                  未找到相關結果
                </div>
              )}

              {/* 加載更多指示器 - 精確匹配結果 */}
              {hasMoreExact && (
                <div
                  ref={loadingMoreExactRef}
                  className="col-span-full flex justify-center py-8"
                >
                  <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-green-500"></div>
                    <span className="text-sm">加載中...</span>
                  </div>
                </div>
              )}
            </div>

            {/* 更多結果 */}
            {sortedAggregatedResults.others.length > 0 && (
              <div className="mt-8">
                <h2 className="text-xl font-bold text-gray-800 dark:text-gray-200 mb-7">更多結果</h2>
                <div className="justify-start grid grid-cols-3 gap-x-2 gap-y-14 sm:gap-y-20 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8">
                  {displayedOthersResults.map(([mapKey, group], index) => {
                    if (viewMode) {
                      return (
                        <div key={`agg-others-${mapKey}-${index}`} className="w-full">
                          <VideoCard
                            from="search"
                            items={group}
                            query={searchQuery.trim() !== group[0].title ? searchQuery.trim() : ''}
                          />
                        </div>
                      );
                    } else {
                      const item = group[0];
                      return (
                        <div key={`all-others-${mapKey}-${index}`} className="w-full">
                          <VideoCard
                            id={item.id}
                            title={item.title || ''}
                            poster={item.poster}
                            episodes={item.episodes ? item.episodes.length : 0} // 轉為 number
                            source={item.source}
                            source_name={item.source_name}
                            douban_id={item.douban_id}
                            query={searchQuery.trim() !== item.title ? searchQuery.trim() : ''}
                            year={item.year}
                            from="search"
                            type={item.episodes && item.episodes.length > 1 ? 'tv' : 'movie'}
                          />
                        </div>
                      );
                    }
                  })}

                  {/* 加載更多指示器 - 其他結果 */}
                  {hasMoreOthers && !hasMoreExact && (
                    <div
                      ref={loadingMoreOthersRef}
                      className="col-span-full flex justify-center py-8"
                    >
                      <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-green-500"></div>
                        <span className="text-sm">加載中...</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>


          ) : searchHistory.length > 0 ? (
            <section className="mb-12">
            <h2 className="mb-4 text-xl font-bold text-gray-800 text-left dark:text-gray-200">
              搜索歷史
              {searchHistory.length > 0 && (
                <button
                  onClick={() => clearSearchHistory()}
                  className="ml-3 text-sm text-gray-500 hover:text-red-500 transition-colors dark:text-gray-400 dark:hover:text-red-500"
                >
                  清空
                </button>
              )}
            </h2>
            <div ref={historyRef} className="flex flex-wrap gap-2">
            {searchHistory.map((item, index) => (
              <div key={`history-${item}-${index}`} className="relative group">
                <button
                  onClick={() => {
                    if (selectedHistoryItem === item) {
                      // 第二次點擊觸發搜索
                      handleSearch(undefined, item);
                    } else {
                      // 第一次點擊，選中歷史項
                      setSearchQuery(item);
                      setSelectedHistoryItem(item);
                    }
                  }}
                  className={`px-4 py-2 rounded-full text-sm transition-colors duration-200 ${
                    selectedHistoryItem === item
                      ? 'bg-green-500/20 text-green-600 dark:bg-green-600/30 dark:text-green-300'
                      : 'bg-gray-500/10 hover:bg-gray-300 text-gray-700 dark:bg-gray-700/50 dark:hover:bg-gray-600 dark:text-gray-300'
                  }`}
                >
                  {item}
                </button>

                {/* 刪除按鈕 */}
                {(selectedHistoryItem === item) ? (
                  <button
                    aria-label="刪除搜索歷史"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      deleteSearchHistory(item);
                      if (selectedHistoryItem === item) setSelectedHistoryItem(null);
                    }}
                    className="absolute -top-1 -right-1 w-4 h-4 bg-gray-400 hover:bg-red-500 text-white rounded-full flex items-center justify-center text-[10px] transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                ) : (
                  <button
                    aria-label="刪除搜索歷史"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      deleteSearchHistory(item);
                    }}
                    className="absolute -top-1 -right-1 w-4 h-4 opacity-0 group-hover:opacity-100 bg-gray-400 hover:bg-red-500 text-white rounded-full flex items-center justify-center text-[10px] transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
          </section>
          ) : null}
        </div>
      </div>

      <button
        onClick={scrollToTop}
        className={`fixed bottom-20 md:bottom-6 right-6 z-[500] w-12 h-12 bg-green-500/90 hover:bg-green-500 text-white rounded-full shadow-lg backdrop-blur-sm transition-all duration-300 ease-in-out flex items-center justify-center group ${
          showBackToTop ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-4 pointer-events-none'
        }`}
        aria-label="返回頂部"
      >
        <ChevronUp className="w-6 h-6 transition-transform group-hover:scale-110" />
      </button>
    </PageLayout>
  );
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchPageClient />
    </Suspense>
  );
}
