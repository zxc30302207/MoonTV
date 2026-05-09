/* eslint-disable react-hooks/exhaustive-deps */

'use client';

import React, { useEffect, useRef, useState } from 'react';

interface CustomCategory {
  name: string;
  type: 'movie' | 'tv';
  query: string;
}

interface DoubanCustomSelectorProps {
  customCategories: CustomCategory[];
  primarySelection?: string;
  secondarySelection?: string;
  onPrimaryChange: (value: string) => void;
  onSecondaryChange: (value: string) => void;
}

const DoubanCustomSelector: React.FC<DoubanCustomSelectorProps> = ({
  customCategories,
  primarySelection,
  secondarySelection,
  onPrimaryChange,
  onSecondaryChange,
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

  // 二級選擇器滾動容器的ref
  const secondaryScrollContainerRef = useRef<HTMLDivElement>(null);

  // 根據 customCategories 生成一級選擇器選項（按 type 分組，電影優先）
  const primaryOptions = React.useMemo(() => {
    const types = Array.from(new Set(customCategories.map((cat) => cat.type)));
    // 確保電影類型排在前面
    const sortedTypes = types.sort((a, b) => {
      if (a === 'movie' && b !== 'movie') return -1;
      if (a !== 'movie' && b === 'movie') return 1;
      return 0;
    });
    return sortedTypes.map((type) => ({
      label: type === 'movie' ? '電影' : '劇集',
      value: type,
    }));
  }, [customCategories]);

  // 根據選中的一級選項生成二級選擇器選項
  const secondaryOptions = React.useMemo(() => {
    if (!primarySelection) return [];
    return customCategories
      .filter((cat) => cat.type === primarySelection)
      .map((cat) => ({
        label: cat.name || cat.query,
        value: cat.query,
      }));
  }, [customCategories, primarySelection]);

  // 處理二級選擇器的鼠標滾輪事件（原生 DOM 事件）
  const handleSecondaryWheel = React.useCallback((e: WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const container = secondaryScrollContainerRef.current;
    if (container) {
      const scrollAmount = e.deltaY * 2;
      container.scrollLeft += scrollAmount;
    }
  }, []);

  // 添加二級選擇器的鼠標滾輪事件監聽器
  useEffect(() => {
    const scrollContainer = secondaryScrollContainerRef.current;
    const capsuleContainer = secondaryContainerRef.current;

    if (scrollContainer && capsuleContainer) {
      // 同時監聽滾動容器和膠囊容器的滾輪事件
      scrollContainer.addEventListener('wheel', handleSecondaryWheel, {
        passive: false,
      });
      capsuleContainer.addEventListener('wheel', handleSecondaryWheel, {
        passive: false,
      });

      return () => {
        scrollContainer.removeEventListener('wheel', handleSecondaryWheel);
        capsuleContainer.removeEventListener('wheel', handleSecondaryWheel);
      };
    }
  }, [handleSecondaryWheel]);

  // 當二級選項變化時重新添加事件監聽器
  useEffect(() => {
    const scrollContainer = secondaryScrollContainerRef.current;
    const capsuleContainer = secondaryContainerRef.current;

    if (scrollContainer && capsuleContainer && secondaryOptions.length > 0) {
      // 重新添加事件監聽器
      scrollContainer.addEventListener('wheel', handleSecondaryWheel, {
        passive: false,
      });
      capsuleContainer.addEventListener('wheel', handleSecondaryWheel, {
        passive: false,
      });

      return () => {
        scrollContainer.removeEventListener('wheel', handleSecondaryWheel);
        capsuleContainer.removeEventListener('wheel', handleSecondaryWheel);
      };
    }
  }, [handleSecondaryWheel, secondaryOptions]);

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
    if (primaryOptions.length > 0) {
      const activeIndex = primaryOptions.findIndex(
        (opt) => opt.value === (primarySelection || primaryOptions[0].value)
      );
      updateIndicatorPosition(
        activeIndex,
        primaryContainerRef,
        primaryButtonRefs,
        setPrimaryIndicatorStyle
      );
    }

    // 副選擇器初始位置
    if (secondaryOptions.length > 0) {
      const activeIndex = secondaryOptions.findIndex(
        (opt) => opt.value === (secondarySelection || secondaryOptions[0].value)
      );
      updateIndicatorPosition(
        activeIndex,
        secondaryContainerRef,
        secondaryButtonRefs,
        setSecondaryIndicatorStyle
      );
    }
  }, [primaryOptions, secondaryOptions]); // 當選項變化時重新計算

  // 監聽主選擇器變化
  useEffect(() => {
    if (primaryOptions.length > 0) {
      const activeIndex = primaryOptions.findIndex(
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
  }, [primarySelection, primaryOptions]);

  // 監聽副選擇器變化
  useEffect(() => {
    if (secondaryOptions.length > 0) {
      const activeIndex = secondaryOptions.findIndex(
        (opt) => opt.value === secondarySelection
      );
      const cleanup = updateIndicatorPosition(
        activeIndex,
        secondaryContainerRef,
        secondaryButtonRefs,
        setSecondaryIndicatorStyle
      );
      return cleanup;
    }
  }, [secondarySelection, secondaryOptions]);

  // 渲染膠囊式選擇器
  const renderCapsuleSelector = (
    options: { label: string; value: string }[],
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

  // 如果沒有自定義分類，則不渲染任何內容
  if (!customCategories || customCategories.length === 0) {
    return null;
  }

  return (
    <div className='space-y-4 sm:space-y-6'>
      {/* 兩級選擇器包裝 */}
      <div className='space-y-3 sm:space-y-4'>
        {/* 一級選擇器 */}
        <div className='flex flex-col sm:flex-row sm:items-center gap-2'>
          <span className='text-xs sm:text-sm font-medium text-gray-600 dark:text-gray-400 min-w-[48px]'>
            類型
          </span>
          <div className='overflow-x-auto'>
            {renderCapsuleSelector(
              primaryOptions,
              primarySelection || primaryOptions[0]?.value,
              onPrimaryChange,
              true
            )}
          </div>
        </div>

        {/* 二級選擇器 */}
        {secondaryOptions.length > 0 && (
          <div className='flex flex-col sm:flex-row sm:items-center gap-2'>
            <span className='text-xs sm:text-sm font-medium text-gray-600 dark:text-gray-400 min-w-[48px]'>
              片單
            </span>
            <div ref={secondaryScrollContainerRef} className='overflow-x-auto'>
              {renderCapsuleSelector(
                secondaryOptions,
                secondarySelection || secondaryOptions[0]?.value,
                onSecondaryChange,
                false
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DoubanCustomSelector;
