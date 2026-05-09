'use client';
import { ChevronDown, Save, Settings, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { getAvailableApiSitesClient } from '@/lib/config.client';
import { getSwal } from '@/lib/sweetalert';
import { getRequestTimeout } from '@/lib/utils';

interface SourceSelectorProps {
  selectedSources: string[];
  onChange: (sources: string[]) => void;
  openFilter: string | null;
  setOpenFilter: React.Dispatch<React.SetStateAction<string | null>>;
  size?: 'default' | 'compact'; // 可選的尺寸屬性
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
  const [enableSearchSuggestions, setEnableSearchSuggestions] =
    useState<boolean>(true);

  // 由父組件控制是否展開
  const open = openFilter === 'sources';

  const [popupStyles, setPopupStyles] = useState<React.CSSProperties>({});
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  // 加載可用的搜索源 - 只在客戶端執行
  useEffect(() => {
    // 確保在客戶端執行
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
      // 在服務端渲染時直接設置為完成狀態
      setIsLoading(false);
    }
  }, []);

  const toggleOpen = () => {
    if (open) {
      setOpenFilter(null); // 已展開 → 關閉
    } else {
      setOpenFilter('sources'); // 打開自己，關閉其他
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

  // 切換搜索建議開關時立即生效
  const handleToggleSearchSuggestions = () => {
    const newValue = !enableSearchSuggestions;
    setEnableSearchSuggestions(newValue);

    // 立即保存到 localStorage
    localStorage.setItem('enableSearchSuggestions', newValue.toString());

    // 觸發自定義事件通知其他組件設置已更改
    window.dispatchEvent(
      new CustomEvent('searchSettingsChanged', {
        detail: { enableSearchSuggestions: newValue },
      })
    );
  };

  // 加載保存的搜索源，並清理不存在的源
  useEffect(() => {
    if (typeof window !== 'undefined' && availableSources.length > 0) {
      const savedSources = localStorage.getItem('savedSources');
      if (savedSources) {
        try {
          const parsedSources = JSON.parse(savedSources);
          // 確保保存的源在可用源列表中
          const validSources = parsedSources.filter((source: string) =>
            availableSources.some((avail) => avail.key === source)
          );

          // 如果保存的源中有不存在的源，更新本地存儲
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

      // 加載保存的超時時間
      const timeout = getRequestTimeout();
      setTimeoutSeconds(timeout);

      // 加載搜索建議設置
      const savedEnableSearchSuggestions = localStorage.getItem(
        'enableSearchSuggestions'
      );
      if (savedEnableSearchSuggestions !== null) {
        setEnableSearchSuggestions(savedEnableSearchSuggestions === 'true');
      }
    }
  }, [availableSources, onChange]);

  // 計算彈窗位置，防止超出屏幕
  useEffect(() => {
    if (open && buttonRef.current && popupRef.current) {
      const btnRect = buttonRef.current.getBoundingClientRect();
      const screenWidth = window.innerWidth;

      let left = btnRect.left;
      const top = btnRect.bottom + 4; // 下方間距
      const width = Math.min(screenWidth - 16, 400); // 彈窗最大寬度400，留一點邊距

      // 如果右邊超出屏幕，向左移動
      if (left + width > screenWidth - 8) {
        left = Math.max(8, screenWidth - width - 8);
      }

      setPopupStyles({ left, top, width });
    }
  }, [open]);

  const heightClass = size === 'compact' ? 'h-10' : 'h-12';

  if (isLoading) {
    return (
      <div className='relative inline-block'>
        <div className='flex items-center bg-gray-200 dark:bg-gray-700 rounded-l-lg overflow-hidden'>
          <button
            className={`flex items-center gap-1 px-3 ${heightClass} text-sm font-medium opacity-50`}
            disabled
          >
            <Settings className='w-4 h-4' />
            <ChevronDown className='w-4 h-4' />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className='relative inline-block'>
      <div className='flex items-center bg-gray-200 dark:bg-gray-700 rounded-l-lg overflow-hidden'>
        <button
          ref={buttonRef}
          onClick={toggleOpen}
          className={`flex items-center gap-1 px-3 ${heightClass} text-sm font-medium hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors`}
        >
          <Settings className='w-4 h-4' />
          {selectedSources.length > 0 && (
            <span className='inline-flex items-center justify-center w-5 h-5 text-xs bg-green-500 text-white rounded-full ml-1'>
              {selectedSources.length}
            </span>
          )}
          <ChevronDown
            className={`w-4 h-4 transition-transform ${
              open ? 'rotate-180' : 'rotate-0'
            }`}
          />
        </button>
      </div>

      {open && (
        <div
          ref={popupRef}
          style={popupStyles}
          className='
            fixed z-50
            bg-white dark:bg-gray-800
            border border-gray-200 dark:border-gray-700
            rounded-lg shadow-lg p-4
            max-h-[50vh] overflow-auto
          '
        >
          <div
            className='mb-3 grid gap-2'
            style={{
              gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
            }}
          >
            {/* 保存按鈕 */}
            <button
              onClick={handleSaveSources}
              className='px-3 py-1 text-sm bg-green-100 text-green-700 rounded hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400 dark:hover:bg-green-800/50 flex items-center justify-center gap-1'
              title='保存當前選中的搜索源和超時設置'
            >
              <Save className='w-3 h-3' />
              保存
            </button>

            {/* 清空按鈕 */}
            <button
              onClick={handleClearAll}
              className='px-2 py-1 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-800/50 flex items-center justify-center gap-1'
              title='清空所有選中的搜索源'
            >
              <X className='w-4 h-4' />
              清空
            </button>

            {/* 超時時間設置 */}
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

            {/* 搜索建議開關 */}
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
      )}
    </div>
  );
}
