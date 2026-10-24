'use client';
import { Save, Settings, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  clampSearchConcurrency,
  DEFAULT_SEARCH_CONCURRENCY,
  getSearchConcurrency,
  MAX_SEARCH_CONCURRENCY,
} from '@/lib/concurrency';
import { getAvailableApiSitesClient } from '@/lib/config.client';
import { getSwal } from '@/lib/sweetalert';
import { getRequestTimeout } from '@/lib/utils';

interface SourceSelectorProps {
  selectedSources: string[];
  onChange: (sources: string[]) => void;
  openFilter: string | null;
  setOpenFilter: React.Dispatch<React.SetStateAction<string | null>>;
  size?: 'default' | 'compact';
}

export default function SourceSelector({
  selectedSources,
  onChange,
  openFilter,
  setOpenFilter,
  size = 'default',
}: SourceSelectorProps) {
  const [availableSources, setAvailableSources] = useState<
    { key: string; name: string }[]
  >([]);
  const [isLoading, setIsLoading] = useState(true);
  const [timeoutSeconds, setTimeoutSeconds] = useState<number>(30);
  const [searchConcurrency, setSearchConcurrency] = useState<number>(
    DEFAULT_SEARCH_CONCURRENCY
  );
  const [enableSearchSuggestions, setEnableSearchSuggestions] =
    useState<boolean>(true);

  const open = openFilter === 'sources';

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenFilter(null);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, setOpenFilter]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const loadSources = async () => {
        try {
          const sites = await getAvailableApiSitesClient();
          setAvailableSources(
            sites.map((site) => ({ key: site.key, name: site.name }))
          );
        } catch (error) {
          setAvailableSources([]); // 確保不會因為錯誤導致狀態未更新
        } finally {
          setIsLoading(false);
        }
      };
      loadSources();
    } else {
      setIsLoading(false);
    }
  }, []);

  const toggleOpen = () => {
    if (open) {
      setOpenFilter(null);
    } else {
      setOpenFilter('sources');
    }
  };

  const handleSourceClick = (sourceKey: string) => {
    if (selectedSources.includes(sourceKey)) {
      onChange(selectedSources.filter((key) => key !== sourceKey));
    } else {
      onChange([...selectedSources, sourceKey]);
    }
  };

  const handleClearAll = () => {
    onChange([]);
  };

  const handleSaveSources = async () => {
    localStorage.setItem('savedSources', JSON.stringify(selectedSources));
    localStorage.setItem('requestTimeout', timeoutSeconds.toString());
    localStorage.setItem('searchConcurrency', searchConcurrency.toString());

    // 顯示保存成功提示
    const Swal = await getSwal();
    await Swal.fire({
      icon: 'success',
      title: '保存成功',
      text: '只保存在本地',
      toast: true,
      position: 'top-end',
      showConfirmButton: false,
      timer: 2000,
      timerProgressBar: true,
    });
  };

  const handleConcurrencyChange = (value: string) => {
    const next = clampSearchConcurrency(value);
    setSearchConcurrency(next);
    // 即时生效：下一次搜索会直接读取 localStorage
    localStorage.setItem('searchConcurrency', next.toString());
  };

  const handleToggleSearchSuggestions = () => {
    const newValue = !enableSearchSuggestions;
    setEnableSearchSuggestions(newValue);
    localStorage.setItem('enableSearchSuggestions', newValue.toString());
    window.dispatchEvent(
      new CustomEvent('searchSettingsChanged', {
        detail: { enableSearchSuggestions: newValue },
      })
    );
  };

  useEffect(() => {
    if (typeof window !== 'undefined' && availableSources.length > 0) {
      const savedSources = localStorage.getItem('savedSources');
      if (savedSources) {
        try {
          const parsedSources = JSON.parse(savedSources);
          const validSources = parsedSources.filter((source: string) =>
            availableSources.some((avail) => avail.key === source)
          );
          if (validSources.length !== parsedSources.length) {
            localStorage.setItem('savedSources', JSON.stringify(validSources));
          }
          if (validSources.length > 0) {
            onChange(validSources);
          }
        } catch (error) {
          /* ignore parse error */ void 0;
        }
      }

      const timeout = getRequestTimeout();
      setTimeoutSeconds(timeout);

      setSearchConcurrency(getSearchConcurrency());

      const savedEnableSearchSuggestions = localStorage.getItem(
        'enableSearchSuggestions'
      );
      if (savedEnableSearchSuggestions !== null) {
        setEnableSearchSuggestions(savedEnableSearchSuggestions === 'true');
      }
    }
  }, [availableSources, onChange]);

  // 緊湊版用於導航欄，尺寸由 CSS 設計令牌控制，隨導航欄等比縮放
  const isCompact = size === 'compact';
  const baseButtonClass = isCompact
    ? 'top-nav__source-btn flex items-center font-medium'
    : 'flex items-center px-3 h-12 font-medium';
  const iconClass = isCompact ? undefined : 'w-4 h-4';

  if (isLoading) {
    return (
      <div className='relative inline-flex items-center'>
        <div className='flex items-center bg-gray-200 dark:bg-gray-700 rounded-l-lg overflow-hidden'>
          <button className={`${baseButtonClass} opacity-50`} disabled>
            <Settings className={iconClass} />
          </button>
        </div>
      </div>
    );
  }

  // 設置彈窗：Portal 到 body，避免導航欄的 backdrop-filter 影響 fixed 定位
  const settingsModal = (
    <div
      data-source-settings-modal
      className='fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm'
      onClick={() => setOpenFilter(null)}
    >
      <div
        role='dialog'
        aria-modal='true'
        aria-label='搜索源設置'
        onClick={(e) => e.stopPropagation()}
        className='flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-xl dark:bg-gray-800'
      >
        {/* 標題欄 */}
        <div className='flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700'>
          <h3 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
            搜索源設置
          </h3>
          <button
            onClick={() => setOpenFilter(null)}
            className='rounded p-1 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700'
            aria-label='關閉'
          >
            <X className='h-5 w-5 text-gray-500 dark:text-gray-400' />
          </button>
        </div>

        {/* 內容區 */}
        <div className='overflow-y-auto p-4'>
          <div
            className='mb-3 grid gap-2'
            style={{
              gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
            }}
          >
            <button
              onClick={handleSaveSources}
              className='px-3 py-1 text-sm bg-green-100 text-green-700 rounded hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400 dark:hover:bg-green-800/50 flex items-center justify-center gap-1'
              title='保存當前選中的搜索源、超時和並行設定'
            >
              <Save className='w-3 h-3' />
              保存
            </button>

            <button
              onClick={handleClearAll}
              className='px-2 py-1 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-800/50 flex items-center justify-center gap-1'
              title='清空所有選中的搜索源'
            >
              <X className='w-4 h-4' />
              清空
            </button>

            <div className='flex items-center justify-center gap-2 bg-gray-100 dark:bg-gray-700 rounded px-2 py-1'>
              <label className='text-xs text-gray-700 dark:text-gray-300 whitespace-nowrap'>
                超時:
              </label>
              <input
                type='number'
                min='1'
                max='60'
                value={timeoutSeconds}
                onChange={(e) =>
                  setTimeoutSeconds(
                    Math.max(1, Math.min(60, Number(e.target.value) || 30))
                  )
                }
                className='w-12 px-1 py-0.5 text-sm bg-white dark:bg-gray-600 border border-gray-300 dark:border-gray-500 rounded text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-green-400'
                title='請求超時時間（秒）'
              />
              <span className='text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap'>
                秒
              </span>
            </div>

            <div className='flex items-center justify-center gap-2 bg-gray-100 dark:bg-gray-700 rounded px-2 py-1'>
              <label className='text-xs text-gray-700 dark:text-gray-300 whitespace-nowrap'>
                並行:
              </label>
              <input
                type='number'
                min={1}
                max={MAX_SEARCH_CONCURRENCY}
                aria-label='搜索源並行數'
                value={searchConcurrency}
                onChange={(e) => handleConcurrencyChange(e.target.value)}
                className='w-12 px-1 py-0.5 text-sm bg-white dark:bg-gray-600 border border-gray-300 dark:border-gray-500 rounded text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-green-400'
                title={`同時查詢的搜索源數量（1-${MAX_SEARCH_CONCURRENCY}），立即生效`}
              />
              <span className='text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap'>
                個源
              </span>
            </div>

            <div className='flex items-center justify-center gap-2 bg-gray-100 dark:bg-gray-700 rounded px-2 py-1'>
              <label className='text-xs text-gray-700 dark:text-gray-300 whitespace-nowrap'>
                搜索建議
              </label>
              <button
                onClick={handleToggleSearchSuggestions}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                  enableSearchSuggestions
                    ? 'bg-green-500'
                    : 'bg-gray-300 dark:bg-gray-600'
                }`}
                title={
                  enableSearchSuggestions
                    ? '點擊關閉搜索建議（立即生效）'
                    : '點擊開啟搜索建議（立即生效）'
                }
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    enableSearchSuggestions
                      ? 'translate-x-5'
                      : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
          </div>

          {availableSources.length > 0 ? (
            <div
              className='grid gap-2'
              style={{
                gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))',
              }}
            >
              {availableSources.map((source) => (
                <button
                  key={source.key}
                  onClick={() => handleSourceClick(source.key)}
                  className={`px-3 py-2 text-sm rounded-lg transition-all duration-200 text-center ${
                    selectedSources.includes(source.key)
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border border-green-200 dark:border-green-700'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100/80 dark:hover:bg-gray-700/80'
                  }`}
                  title={source.name}
                >
                  {source.name}
                </button>
              ))}
            </div>
          ) : (
            <div className='py-4 text-center text-gray-500 dark:text-gray-400'>
              請配置搜索源或清除緩存
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className='relative inline-flex items-center'>
      {/* ★ 按鈕內部只保留齒輪，寬度完全固定 */}
      <div className='flex items-center bg-gray-200 dark:bg-gray-700 rounded-l-lg overflow-hidden'>
        <button
          onClick={toggleOpen}
          className={`${baseButtonClass} hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors`}
          title='搜索源設置'
        >
          <Settings className={iconClass} />
        </button>
      </div>

      {/* ★ 數量以角標形式呈現：絕對定位在齒輪右上角，不佔按鈕寬度 */}
      {selectedSources.length > 0 && (
        <span className='top-nav__source-count'>
          {selectedSources.length > 99 ? '99+' : selectedSources.length}
        </span>
      )}

      {open && createPortal(settingsModal, document.body)}
    </div>
  );
}
