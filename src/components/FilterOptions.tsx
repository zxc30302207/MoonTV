import { ArrowUpDown, ChevronDown, ChevronUp } from 'lucide-react';
import React, { useId, useState } from 'react';

interface FilterOptionsProps {
  openFilter: string | null;
  setOpenFilter: React.Dispatch<React.SetStateAction<string | null>>;
  /** 清空所有筛选条件，由搜索页统一实现，避免重复维护 */
  onClearFilters: () => void;

  // 来源
  sourceOptions: string[];
  filterSources: string[];
  setFilterSources: (opts: string[]) => void;

  // 標題
  titleOptions: string[];
  selectedTitles: string[];
  setSelectedTitles: (opts: string[]) => void;

  // 年份
  yearOptions: string[];
  selectedYears: string[];
  setSelectedYears: (opts: string[]) => void;

  // 排序
  sortField: 'year' | 'sources' | 'episodes';
  onSortFieldChange: (field: 'year' | 'title' | 'source' | 'episodes') => void;
  sortOrder: 'asc' | 'desc';
  onSortOrderChange: (order: 'asc' | 'desc') => void;
  sortOptions: { value: string; label: string }[];
}

const FilterOptions: React.FC<FilterOptionsProps> = ({
  openFilter,
  setOpenFilter,
  onClearFilters,
  sourceOptions,
  filterSources,
  setFilterSources,
  titleOptions,
  selectedTitles,
  setSelectedTitles,
  yearOptions,
  selectedYears,
  setSelectedYears,
  sortField,
  onSortFieldChange,
  sortOrder,
  onSortOrderChange,
  sortOptions,
}) => {
  const panelId = useId();
  const selectedCount =
    filterSources.length + selectedTitles.length + selectedYears.length;
  const [collapsed, setCollapsed] = useState(true);
  const [activeTab, setActiveTab] = useState<'篩選' | '排序'>('篩選');

  const filterButtons = [
    { key: '來源', label: '來源' },
    { key: '標題', label: '標題' },
    { key: '年份', label: '年份' },
  ];

  const handleButtonClick = (key: string) => {
    setOpenFilter(openFilter === key ? null : key);
  };

  const handleOptionClick = (category: string, option: string) => {
    if (category === '來源') {
      setFilterSources(
        filterSources.includes(option)
          ? filterSources.filter((o) => o !== option)
          : [...filterSources, option]
      );
    } else if (category === '標題') {
      setSelectedTitles(
        selectedTitles.includes(option)
          ? selectedTitles.filter((o) => o !== option)
          : [...selectedTitles, option]
      );
    } else if (category === '年份') {
      setSelectedYears(
        selectedYears.includes(option)
          ? selectedYears.filter((o) => o !== option)
          : [...selectedYears, option]
      );
    }
  };

  const renderFilterOptions = () => {
    if (collapsed) {
      if (
        !filterSources.length &&
        !selectedTitles.length &&
        !selectedYears.length
      ) {
        return <div className='text-gray-400'>請展開選擇篩選條件</div>;
      }
      return (
        <div className='flex flex-wrap gap-2 text-sm'>
          {[
            { category: '來源', values: filterSources },
            { category: '標題', values: selectedTitles },
            { category: '年份', values: selectedYears },
          ].flatMap(({ category, values }) =>
            values.map((value) => (
              <button
                type='button'
                key={`${category}:${value}`}
                aria-label={`移除${category}篩選：${value}`}
                onClick={() => handleOptionClick(category, value)}
                className='min-h-11 max-w-full rounded-lg bg-green-50 px-3 py-2 text-left text-green-800 break-words dark:bg-green-900/30 dark:text-green-200'
              >
                {category}：{value} <span aria-hidden='true'>×</span>
              </button>
            ))
          )}
        </div>
      );
    }

    if (!openFilter) {
      return <div className='text-gray-400'>請選擇一個篩選分類</div>;
    }

    switch (openFilter) {
      case '來源':
        return (
          <div className='grid gap-2 grid-cols-2 sm:grid-cols-3 md:grid-cols-4'>
            {sourceOptions.map((opt) => (
              <button
                type='button'
                key={opt}
                aria-pressed={filterSources.includes(opt)}
                onClick={() => handleOptionClick('來源', opt)}
                className={`min-h-11 break-words px-3 py-2 text-sm rounded-lg border transition-all duration-200 ${
                  filterSources.includes(opt)
                    ? 'bg-green-100 text-green-700 border-green-300 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100/80 dark:hover:bg-gray-700/80 border-transparent'
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
        );
      case '標題':
        return (
          <div className='grid gap-2 grid-cols-2 sm:grid-cols-3 md:grid-cols-4'>
            {titleOptions.map((opt) => (
              <button
                type='button'
                key={opt}
                aria-pressed={selectedTitles.includes(opt)}
                onClick={() => handleOptionClick('標題', opt)}
                className={`min-h-11 break-words px-3 py-2 text-sm rounded-lg border transition-all duration-200 ${
                  selectedTitles.includes(opt)
                    ? 'bg-green-100 text-green-700 border-green-300 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100/80 dark:hover:bg-gray-700/80 border-transparent'
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
        );
      case '年份':
        return (
          <div className='grid gap-2 grid-cols-3 sm:grid-cols-4 md:grid-cols-6'>
            {yearOptions.map((opt) => (
              <button
                type='button'
                key={opt}
                aria-pressed={selectedYears.includes(opt)}
                onClick={() => handleOptionClick('年份', opt)}
                className={`min-h-11 break-words px-3 py-2 text-sm rounded-lg border transition-all duration-200 ${
                  selectedYears.includes(opt)
                    ? 'bg-green-100 text-green-700 border-green-300 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100/80 dark:hover:bg-gray-700/80 border-transparent'
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
        );
      default:
        return null;
    }
  };

  const renderSortOptions = () => (
    <div className='flex flex-wrap gap-2 items-center'>
      {sortOptions.map((opt) => (
        <button
          type='button'
          key={opt.value}
          aria-pressed={sortField === opt.value}
          onClick={() =>
            onSortFieldChange(
              opt.value as 'year' | 'title' | 'source' | 'episodes'
            )
          }
          className={`min-h-11 break-words px-3 py-2 text-sm rounded-lg border transition-all duration-200 ${
            sortField === opt.value
              ? 'bg-green-100 text-green-700 border-green-300 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700'
              : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100/80 dark:hover:bg-gray-700/80 border-gray-300 dark:border-gray-600'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className='flex w-full border rounded-lg overflow-hidden shadow-sm dark:border-gray-700 flex-col'>
      {/* Tab 欄 + 排序按鈕 */}
      <div className='flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800'>
        <div className='flex gap-2' role='group' aria-label='結果顯示選項'>
          <button
            type='button'
            className={`min-h-11 px-3 py-1 font-semibold rounded ${
              activeTab === '篩選'
                ? 'bg-green-500 text-white'
                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
            aria-pressed={activeTab === '篩選'}
            onClick={() => setActiveTab('篩選')}
          >
            篩選{selectedCount > 0 ? ` (${selectedCount})` : ''}
          </button>
          <button
            type='button'
            className={`min-h-11 px-3 py-1 font-semibold rounded ${
              activeTab === '排序'
                ? 'bg-green-500 text-white'
                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
            aria-pressed={activeTab === '排序'}
            onClick={() => setActiveTab('排序')}
          >
            排序
          </button>
        </div>
        <div className='flex items-center gap-2'>
          {activeTab === '篩選' && (
            <>
              <button
                type='button'
                onClick={onClearFilters}
                disabled={selectedCount === 0}
                className='min-h-11 disabled:opacity-50 text-sm text-blue-600 hover:underline dark:text-blue-400'
              >
                清空篩選
              </button>
              <button
                type='button'
                aria-label={collapsed ? '展開篩選條件' : '收合篩選條件'}
                aria-expanded={!collapsed}
                aria-controls={panelId}
                onClick={() => setCollapsed(!collapsed)}
                className='flex min-h-11 min-w-11 items-center justify-center p-2 border rounded hover:bg-gray-200 dark:hover:bg-gray-700'
              >
                {collapsed ? (
                  <ChevronDown className='w-4 h-4' />
                ) : (
                  <ChevronUp className='w-4 h-4' />
                )}
              </button>
            </>
          )}

          {activeTab === '排序' && (
            <button
              type='button'
              onClick={() =>
                onSortOrderChange(sortOrder === 'asc' ? 'desc' : 'asc')
              }
              className='px-3 py-2 text-sm flex items-center gap-1 border rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700'
            >
              <ArrowUpDown className='w-4 h-4' />
              {sortOrder === 'asc' ? '升序' : '降序'}
            </button>
          )}
        </div>
      </div>

      <div id={panelId} className='flex w-full flex-col sm:flex-row'>
        {/* 左側篩選分類按鈕 */}
        {activeTab === '篩選' && !collapsed && (
          <div className='shrink-0 bg-gray-100 dark:bg-gray-800 flex sm:w-28 sm:flex-col'>
            {filterButtons.map((btn) => (
              <button
                type='button'
                key={btn.key}
                aria-pressed={openFilter === btn.key}
                onClick={() => handleButtonClick(btn.key)}
                className={`min-h-11 flex-1 sm:flex-none px-4 py-3 text-left border-b border-gray-200 dark:border-gray-700 transition-colors ${
                  openFilter === btn.key
                    ? 'bg-green-500 text-white font-semibold'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                {btn.label}
              </button>
            ))}
          </div>
        )}

        {/* 右側內容 */}
        <div className='min-w-0 flex-1 max-h-[60vh] overflow-y-auto bg-white dark:bg-gray-900 p-4'>
          {activeTab === '篩選' ? renderFilterOptions() : renderSortOptions()}
        </div>
      </div>
    </div>
  );
};

export default FilterOptions;
