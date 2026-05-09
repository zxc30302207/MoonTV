/* eslint-disable react-hooks/exhaustive-deps */

'use client';

import React, { useEffect, useRef, useState } from 'react';

import MultiLevelSelector from './MultiLevelSelector';
import WeekdaySelector from './WeekdaySelector';

interface SelectorOption {
  label: string;
  value: string;
}

interface DoubanSelectorProps {
  type: 'movie' | 'tv' | 'show' | 'anime';
  primarySelection?: string;
  secondarySelection?: string;
  onPrimaryChange: (value: string) => void;
  onSecondaryChange: (value: string) => void;
  onMultiLevelChange?: (values: Record<string, string>) => void;
  onWeekdayChange: (weekday: string) => void;
}

const DoubanSelector: React.FC<DoubanSelectorProps> = ({
  type,
  primarySelection,
  secondarySelection,
  onPrimaryChange,
  onSecondaryChange,
  onMultiLevelChange,
  onWeekdayChange,
}) => {
  // 為不同的選擇器創建獨立的refs和狀態
  const primaryContainerRef = useRef<HTMLDivElement>(null);
  const primaryButtonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [primaryIndicatorStyle, setPrimaryIndicatorStyle] = useState<{
    left: number;
    width: number;
  }>({ left: 0, width: 0 });

  const secondaryContainerRef = useRef<HTMLDivElement>(null);
  const secondaryButtonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [secondaryIndicatorStyle, setSecondaryIndicatorStyle] = useState<{
    left: number;
    width: number;
  }>({ left: 0, width: 0 });

  // 電影的一級選擇器選項
  const moviePrimaryOptions: SelectorOption[] = [
    { label: '全部', value: '全部' },
    { label: '熱門電影', value: '熱門' },
    { label: '最新電影', value: '最新' },
    { label: '豆瓣高分', value: '豆瓣高分' },
    { label: '冷門佳片', value: '冷門佳片' },
  ];

  // 電影的二級選擇器選項
  const movieSecondaryOptions: SelectorOption[] = [
    { label: '全部', value: '全部' },
    { label: '華語', value: '華語' },
    { label: '歐美', value: '歐美' },
    { label: '韓國', value: '韓國' },
    { label: '日本', value: '日本' },
  ];

  // 電視劇一級選擇器選項
  const tvPrimaryOptions: SelectorOption[] = [
    { label: '全部', value: '全部' },
    { label: '最近熱門', value: '最近熱門' },
  ];

  // 電視劇二級選擇器選項
  const tvSecondaryOptions: SelectorOption[] = [
    { label: '全部', value: 'tv' },
    { label: '國產', value: 'tv_domestic' },
    { label: '歐美', value: 'tv_american' },
    { label: '日本', value: 'tv_japanese' },
    { label: '韓國', value: 'tv_korean' },
    { label: '動漫', value: 'tv_animation' },
    { label: '紀錄片', value: 'tv_documentary' },
  ];

  // 綜藝一級選擇器選項
  const showPrimaryOptions: SelectorOption[] = [
    { label: '全部', value: '全部' },
    { label: '最近熱門', value: '最近熱門' },
  ];

  // 綜藝二級選擇器選項
  const showSecondaryOptions: SelectorOption[] = [
    { label: '全部', value: 'show' },
    { label: '國內', value: 'show_domestic' },
    { label: '國外', value: 'show_foreign' },
  ];

  // 動漫一級選擇器選項
  const animePrimaryOptions: SelectorOption[] = [
    { label: '每日放送', value: '每日放送' },
    { label: '番劇', value: '番劇' },
    { label: '劇場版', value: '劇場版' },
  ];

  // 處理多級選擇器變化
  const handleMultiLevelChange = (values: Record<string, string>) => {
    onMultiLevelChange?.(values);
  };

  // 更新指示器位置的通用函數
  const updateIndicatorPosition = (
    activeIndex: number,
    containerRef: React.RefObject<HTMLDivElement>,
    buttonRefs: React.MutableRefObject<(HTMLButtonElement | null)[]>,
    setIndicatorStyle: React.Dispatch<
      React.SetStateAction<{ left: number; width: number }>
    >
  ) => {
    if (
      activeIndex >= 0 &&
      buttonRefs.current[activeIndex] &&
      containerRef.current
    ) {
      const timeoutId = setTimeout(() => {
        const button = buttonRefs.current[activeIndex];
        const container = containerRef.current;
        if (button && container) {
          const buttonRect = button.getBoundingClientRect();
          const containerRect = container.getBoundingClientRect();

          if (buttonRect.width > 0) {
            setIndicatorStyle({
              left: buttonRect.left - containerRect.left,
              width: buttonRect.width,
            });
          }
        }
      }, 0);
      return () => clearTimeout(timeoutId);
    }
  };

  // 組件掛載時立即計算初始位置
  useEffect(() => {
    // 主選擇器初始位置
    if (type === 'movie') {
      const activeIndex = moviePrimaryOptions.findIndex(
        (opt) =>
          opt.value === (primarySelection || moviePrimaryOptions[0].value)
      );
      updateIndicatorPosition(
        activeIndex,
        primaryContainerRef,
        primaryButtonRefs,
        setPrimaryIndicatorStyle
      );
    } else if (type === 'tv') {
      const activeIndex = tvPrimaryOptions.findIndex(
        (opt) => opt.value === (primarySelection || tvPrimaryOptions[1].value)
      );
      updateIndicatorPosition(
        activeIndex,
        primaryContainerRef,
        primaryButtonRefs,
        setPrimaryIndicatorStyle
      );
    } else if (type === 'anime') {
      const activeIndex = animePrimaryOptions.findIndex(
        (opt) =>
          opt.value === (primarySelection || animePrimaryOptions[0].value)
      );
      updateIndicatorPosition(
        activeIndex,
        primaryContainerRef,
        primaryButtonRefs,
        setPrimaryIndicatorStyle
      );
    } else if (type === 'show') {
      const activeIndex = showPrimaryOptions.findIndex(
        (opt) => opt.value === (primarySelection || showPrimaryOptions[1].value)
      );
      updateIndicatorPosition(
        activeIndex,
        primaryContainerRef,
        primaryButtonRefs,
        setPrimaryIndicatorStyle
      );
    }

    // 副選擇器初始位置
    let secondaryActiveIndex = -1;
    if (type === 'movie') {
      secondaryActiveIndex = movieSecondaryOptions.findIndex(
        (opt) =>
          opt.value === (secondarySelection || movieSecondaryOptions[0].value)
      );
    } else if (type === 'tv') {
      secondaryActiveIndex = tvSecondaryOptions.findIndex(
        (opt) =>
          opt.value === (secondarySelection || tvSecondaryOptions[0].value)
      );
    } else if (type === 'show') {
      secondaryActiveIndex = showSecondaryOptions.findIndex(
        (opt) =>
          opt.value === (secondarySelection || showSecondaryOptions[0].value)
      );
    }

    if (secondaryActiveIndex >= 0) {
      updateIndicatorPosition(
        secondaryActiveIndex,
        secondaryContainerRef,
        secondaryButtonRefs,
        setSecondaryIndicatorStyle
      );
    }
  }, [type]); // 只在type變化時重新計算

  // 監聽主選擇器變化
  useEffect(() => {
    if (type === 'movie') {
      const activeIndex = moviePrimaryOptions.findIndex(
        (opt) => opt.value === primarySelection
      );
      const cleanup = updateIndicatorPosition(
        activeIndex,
        primaryContainerRef,
        primaryButtonRefs,
        setPrimaryIndicatorStyle
      );
      return cleanup;
    } else if (type === 'tv') {
      const activeIndex = tvPrimaryOptions.findIndex(
        (opt) => opt.value === primarySelection
      );
      const cleanup = updateIndicatorPosition(
        activeIndex,
        primaryContainerRef,
        primaryButtonRefs,
        setPrimaryIndicatorStyle
      );
      return cleanup;
    } else if (type === 'anime') {
      const activeIndex = animePrimaryOptions.findIndex(
        (opt) => opt.value === primarySelection
      );
      const cleanup = updateIndicatorPosition(
        activeIndex,
        primaryContainerRef,
        primaryButtonRefs,
        setPrimaryIndicatorStyle
      );
      return cleanup;
    } else if (type === 'show') {
      const activeIndex = showPrimaryOptions.findIndex(
        (opt) => opt.value === primarySelection
      );
      const cleanup = updateIndicatorPosition(
        activeIndex,
        primaryContainerRef,
        primaryButtonRefs,
        setPrimaryIndicatorStyle
      );
      return cleanup;
    }
  }, [primarySelection]);

  // 監聽副選擇器變化
  useEffect(() => {
    let activeIndex = -1;
    let options: SelectorOption[] = [];

    if (type === 'movie') {
      activeIndex = movieSecondaryOptions.findIndex(
        (opt) => opt.value === secondarySelection
      );
      options = movieSecondaryOptions;
    } else if (type === 'tv') {
      activeIndex = tvSecondaryOptions.findIndex(
        (opt) => opt.value === secondarySelection
      );
      options = tvSecondaryOptions;
    } else if (type === 'show') {
      activeIndex = showSecondaryOptions.findIndex(
        (opt) => opt.value === secondarySelection
      );
      options = showSecondaryOptions;
    }

    if (options.length > 0) {
      const cleanup = updateIndicatorPosition(
        activeIndex,
        secondaryContainerRef,
        secondaryButtonRefs,
        setSecondaryIndicatorStyle
      );
      return cleanup;
    }
  }, [secondarySelection]);

  // 渲染膠囊式選擇器
  const renderCapsuleSelector = (
    options: SelectorOption[],
    activeValue: string | undefined,
    onChange: (value: string) => void,
    isPrimary = false
  ) => {
    const containerRef = isPrimary
      ? primaryContainerRef
      : secondaryContainerRef;
    const buttonRefs = isPrimary ? primaryButtonRefs : secondaryButtonRefs;
    const indicatorStyle = isPrimary
      ? primaryIndicatorStyle
      : secondaryIndicatorStyle;

    return (
      <div
        ref={containerRef}
        className='relative inline-flex bg-gray-200/60 rounded-full p-0.5 sm:p-1 dark:bg-gray-700/60 backdrop-blur-sm'
      >
        {/* 滑動的白色背景指示器 */}
        {indicatorStyle.width > 0 && (
          <div
            className='absolute top-0.5 bottom-0.5 sm:top-1 sm:bottom-1 bg-white dark:bg-gray-500 rounded-full shadow-sm transition-all duration-300 ease-out'
            style={{
              left: `${indicatorStyle.left}px`,
              width: `${indicatorStyle.width}px`,
            }}
          />
        )}

        {options.map((option, index) => {
          const isActive = activeValue === option.value;
          return (
            <button
              key={option.value}
              ref={(el) => {
                buttonRefs.current[index] = el;
              }}
              onClick={() => onChange(option.value)}
              className={`relative z-10 px-2 py-1 sm:px-4 sm:py-2 text-xs sm:text-sm font-medium rounded-full transition-all duration-200 whitespace-nowrap ${
                isActive
                  ? 'text-gray-900 dark:text-gray-100 cursor-default'
                  : 'text-gray-700 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 cursor-pointer'
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <div className='space-y-4 sm:space-y-6'>
      {/* 電影類型 - 顯示兩級選擇器 */}
      {type === 'movie' && (
        <div className='space-y-3 sm:space-y-4'>
          {/* 一級選擇器 */}
          <div className='flex flex-col sm:flex-row sm:items-center gap-2'>
            <span className='text-xs sm:text-sm font-medium text-gray-600 dark:text-gray-400 min-w-[48px]'>
              分類
            </span>
            <div className='overflow-x-auto'>
              {renderCapsuleSelector(
                moviePrimaryOptions,
                primarySelection || moviePrimaryOptions[0].value,
                onPrimaryChange,
                true
              )}
            </div>
          </div>

          {/* 二級選擇器 - 只在非"全部"時顯示 */}
          {primarySelection !== '全部' ? (
            <div className='flex flex-col sm:flex-row sm:items-center gap-2'>
              <span className='text-xs sm:text-sm font-medium text-gray-600 dark:text-gray-400 min-w-[48px]'>
                地區
              </span>
              <div className='overflow-x-auto'>
                {renderCapsuleSelector(
                  movieSecondaryOptions,
                  secondarySelection || movieSecondaryOptions[0].value,
                  onSecondaryChange,
                  false
                )}
              </div>
            </div>
          ) : (
            /* 多級選擇器 - 只在選中"全部"時顯示 */
            <div className='flex flex-col sm:flex-row sm:items-center gap-2'>
              <span className='text-xs sm:text-sm font-medium text-gray-600 dark:text-gray-400 min-w-[48px]'>
                篩選
              </span>
              <div className='overflow-x-auto'>
                <MultiLevelSelector
                  key={`${type}-${primarySelection}`}
                  onChange={handleMultiLevelChange}
                  contentType={type}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* 電視劇類型 - 顯示兩級選擇器 */}
      {type === 'tv' && (
        <div className='space-y-3 sm:space-y-4'>
          {/* 一級選擇器 */}
          <div className='flex flex-col sm:flex-row sm:items-center gap-2'>
            <span className='text-xs sm:text-sm font-medium text-gray-600 dark:text-gray-400 min-w-[48px]'>
              分類
            </span>
            <div className='overflow-x-auto'>
              {renderCapsuleSelector(
                tvPrimaryOptions,
                primarySelection || tvPrimaryOptions[1].value,
                onPrimaryChange,
                true
              )}
            </div>
          </div>

          {/* 二級選擇器 - 只在選中"最近熱門"時顯示，選中"全部"時顯示多級選擇器 */}
          {(primarySelection || tvPrimaryOptions[1].value) === '最近熱門' ? (
            <div className='flex flex-col sm:flex-row sm:items-center gap-2'>
              <span className='text-xs sm:text-sm font-medium text-gray-600 dark:text-gray-400 min-w-[48px]'>
                類型
              </span>
              <div className='overflow-x-auto'>
                {renderCapsuleSelector(
                  tvSecondaryOptions,
                  secondarySelection || tvSecondaryOptions[0].value,
                  onSecondaryChange,
                  false
                )}
              </div>
            </div>
          ) : (primarySelection || tvPrimaryOptions[1].value) === '全部' ? (
            /* 多級選擇器 - 只在選中"全部"時顯示 */
            <div className='flex flex-col sm:flex-row sm:items-center gap-2'>
              <span className='text-xs sm:text-sm font-medium text-gray-600 dark:text-gray-400 min-w-[48px]'>
                篩選
              </span>
              <div className='overflow-x-auto'>
                <MultiLevelSelector
                  key={`${type}-${primarySelection}`}
                  onChange={handleMultiLevelChange}
                  contentType={type}
                />
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* 動漫類型 - 顯示一級選擇器和多級選擇器 */}
      {type === 'anime' && (
        <div className='space-y-3 sm:space-y-4'>
          <div className='flex flex-col sm:flex-row sm:items-center gap-2'>
            <span className='text-xs sm:text-sm font-medium text-gray-600 dark:text-gray-400 min-w-[48px]'>
              分類
            </span>
            <div className='overflow-x-auto'>
              {renderCapsuleSelector(
                animePrimaryOptions,
                primarySelection || animePrimaryOptions[0].value,
                onPrimaryChange,
                true
              )}
            </div>
          </div>

          {/* 篩選部分 - 根據一級選擇器顯示不同內容 */}
          {(primarySelection || animePrimaryOptions[0].value) === '每日放送' ? (
            // 每日放送分類下顯示星期選擇器
            <div className='flex flex-col sm:flex-row sm:items-center gap-2'>
              <span className='text-xs sm:text-sm font-medium text-gray-600 dark:text-gray-400 min-w-[48px]'>
                星期
              </span>
              <div className='overflow-x-auto'>
                <WeekdaySelector onWeekdayChange={onWeekdayChange} />
              </div>
            </div>
          ) : (
            // 其他分類下顯示原有的篩選功能
            <div className='flex flex-col sm:flex-row sm:items-center gap-2'>
              <span className='text-xs sm:text-sm font-medium text-gray-600 dark:text-gray-400 min-w-[48px]'>
                篩選
              </span>
              <div className='overflow-x-auto'>
                {(primarySelection || animePrimaryOptions[0].value) ===
                '番劇' ? (
                  <MultiLevelSelector
                    key={`anime-tv-${primarySelection}`}
                    onChange={handleMultiLevelChange}
                    contentType='anime-tv'
                  />
                ) : (
                  <MultiLevelSelector
                    key={`anime-movie-${primarySelection}`}
                    onChange={handleMultiLevelChange}
                    contentType='anime-movie'
                  />
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 綜藝類型 - 顯示兩級選擇器 */}
      {type === 'show' && (
        <div className='space-y-3 sm:space-y-4'>
          {/* 一級選擇器 */}
          <div className='flex flex-col sm:flex-row sm:items-center gap-2'>
            <span className='text-xs sm:text-sm font-medium text-gray-600 dark:text-gray-400 min-w-[48px]'>
              分類
            </span>
            <div className='overflow-x-auto'>
              {renderCapsuleSelector(
                showPrimaryOptions,
                primarySelection || showPrimaryOptions[1].value,
                onPrimaryChange,
                true
              )}
            </div>
          </div>

          {/* 二級選擇器 - 只在選中"最近熱門"時顯示，選中"全部"時顯示多級選擇器 */}
          {(primarySelection || showPrimaryOptions[1].value) === '最近熱門' ? (
            <div className='flex flex-col sm:flex-row sm:items-center gap-2'>
              <span className='text-xs sm:text-sm font-medium text-gray-600 dark:text-gray-400 min-w-[48px]'>
                類型
              </span>
              <div className='overflow-x-auto'>
                {renderCapsuleSelector(
                  showSecondaryOptions,
                  secondarySelection || showSecondaryOptions[0].value,
                  onSecondaryChange,
                  false
                )}
              </div>
            </div>
          ) : (primarySelection || showPrimaryOptions[1].value) === '全部' ? (
            /* 多級選擇器 - 只在選中"全部"時顯示 */
            <div className='flex flex-col sm:flex-row sm:items-center gap-2'>
              <span className='text-xs sm:text-sm font-medium text-gray-600 dark:text-gray-400 min-w-[48px]'>
                篩選
              </span>
              <div className='overflow-x-auto'>
                <MultiLevelSelector
                  key={`${type}-${primarySelection}`}
                  onChange={handleMultiLevelChange}
                  contentType={type}
                />
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
};

export default DoubanSelector;
