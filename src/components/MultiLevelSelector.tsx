'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface MultiLevelOption {
  label: string;
  value: string;
}

interface MultiLevelCategory {
  key: string;
  label: string;
  options: MultiLevelOption[];
  multiSelect?: boolean;
}

interface MultiLevelSelectorProps {
  onChange: (values: Record<string, string>) => void;
  contentType?: 'movie' | 'tv' | 'show' | 'anime-tv' | 'anime-movie';
}

const MultiLevelSelector: React.FC<MultiLevelSelectorProps> = ({
  onChange,
  contentType = 'movie',
}) => {
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [dropdownPosition, setDropdownPosition] = useState<{
    x: number;
    y: number;
    width: number;
  }>({ x: 0, y: 0, width: 0 });
  const [values, setValues] = useState<Record<string, string>>({});
  const categoryRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const dropdownRef = useRef<HTMLDivElement>(null);

  // 根據內容類型獲取對應的類型選項
  const getTypeOptions = (
    contentType: 'movie' | 'tv' | 'show' | 'anime-tv' | 'anime-movie'
  ) => {
    const baseOptions = [{ label: '全部', value: 'all' }];

    switch (contentType) {
      case 'movie':
        return [
          ...baseOptions,
          { label: '喜劇', value: 'comedy' },
          { label: '愛情', value: 'romance' },
          { label: '動作', value: 'action' },
          { label: '科幻', value: 'sci-fi' },
          { label: '懸疑', value: 'suspense' },
          { label: '犯罪', value: 'crime' },
          { label: '驚悚', value: 'thriller' },
          { label: '冒險', value: 'adventure' },
          { label: '音樂', value: 'music' },
          { label: '歷史', value: 'history' },
          { label: '奇幻', value: 'fantasy' },
          { label: '恐怖', value: 'horror' },
          { label: '戰爭', value: 'war' },
          { label: '傳記', value: 'biography' },
          { label: '歌舞', value: 'musical' },
          { label: '武俠', value: 'wuxia' },
          { label: '情色', value: 'erotic' },
          { label: '災難', value: 'disaster' },
          { label: '西部', value: 'western' },
          { label: '紀錄片', value: 'documentary' },
          { label: '短片', value: 'short' },
        ];
      case 'tv':
        return [
          ...baseOptions,
          { label: '喜劇', value: 'comedy' },
          { label: '愛情', value: 'romance' },
          { label: '懸疑', value: 'suspense' },
          { label: '武俠', value: 'wuxia' },
          { label: '古裝', value: 'costume' },
          { label: '家庭', value: 'family' },
          { label: '犯罪', value: 'crime' },
          { label: '科幻', value: 'sci-fi' },
          { label: '恐怖', value: 'horror' },
          { label: '歷史', value: 'history' },
          { label: '戰爭', value: 'war' },
          { label: '動作', value: 'action' },
          { label: '冒險', value: 'adventure' },
          { label: '傳記', value: 'biography' },
          { label: '劇情', value: 'drama' },
          { label: '奇幻', value: 'fantasy' },
          { label: '驚悚', value: 'thriller' },
          { label: '災難', value: 'disaster' },
          { label: '歌舞', value: 'musical' },
          { label: '音樂', value: 'music' },
        ];
      case 'show':
        return [
          ...baseOptions,
          { label: '真人秀', value: 'reality' },
          { label: '脫口秀', value: 'talkshow' },
          { label: '音樂', value: 'music' },
          { label: '歌舞', value: 'musical' },
        ];
      case 'anime-tv':
      case 'anime-movie':
      default:
        return baseOptions;
    }
  };

  // 根據內容類型獲取對應的地區選項
  const getRegionOptions = (
    contentType: 'movie' | 'tv' | 'show' | 'anime-tv' | 'anime-movie'
  ) => {
    const baseOptions = [{ label: '全部', value: 'all' }];

    switch (contentType) {
      case 'movie':
      case 'anime-movie':
        return [
          ...baseOptions,
          { label: '華語', value: 'chinese' },
          { label: '歐美', value: 'western' },
          { label: '韓國', value: 'korean' },
          { label: '日本', value: 'japanese' },
          { label: '中國大陸', value: 'mainland_china' },
          { label: '美國', value: 'usa' },
          { label: '中國香港', value: 'hong_kong' },
          { label: '中國臺灣', value: 'taiwan' },
          { label: '英國', value: 'uk' },
          { label: '法國', value: 'france' },
          { label: '德國', value: 'germany' },
          { label: '意大利', value: 'italy' },
          { label: '西班牙', value: 'spain' },
          { label: '印度', value: 'india' },
          { label: '泰國', value: 'thailand' },
          { label: '俄羅斯', value: 'russia' },
          { label: '加拿大', value: 'canada' },
          { label: '澳大利亞', value: 'australia' },
          { label: '愛爾蘭', value: 'ireland' },
          { label: '瑞典', value: 'sweden' },
          { label: '巴西', value: 'brazil' },
          { label: '丹麥', value: 'denmark' },
        ];
      case 'tv':
      case 'anime-tv':
      case 'show':
        return [
          ...baseOptions,
          { label: '華語', value: 'chinese' },
          { label: '歐美', value: 'western' },
          { label: '國外', value: 'foreign' },
          { label: '韓國', value: 'korean' },
          { label: '日本', value: 'japanese' },
          { label: '中國大陸', value: 'mainland_china' },
          { label: '中國香港', value: 'hong_kong' },
          { label: '美國', value: 'usa' },
          { label: '英國', value: 'uk' },
          { label: '泰國', value: 'thailand' },
          { label: '中國臺灣', value: 'taiwan' },
          { label: '意大利', value: 'italy' },
          { label: '法國', value: 'france' },
          { label: '德國', value: 'germany' },
          { label: '西班牙', value: 'spain' },
          { label: '俄羅斯', value: 'russia' },
          { label: '瑞典', value: 'sweden' },
          { label: '巴西', value: 'brazil' },
          { label: '丹麥', value: 'denmark' },
          { label: '印度', value: 'india' },
          { label: '加拿大', value: 'canada' },
          { label: '愛爾蘭', value: 'ireland' },
          { label: '澳大利亞', value: 'australia' },
        ];
      default:
        return baseOptions;
    }
  };

  const getLabelOptions = (
    contentType: 'movie' | 'tv' | 'show' | 'anime-tv' | 'anime-movie'
  ) => {
    const baseOptions = [{ label: '全部', value: 'all' }];
    switch (contentType) {
      case 'anime-movie':
        return [
          ...baseOptions,
          { label: '定格動畫', value: 'stop_motion' },
          { label: '傳記', value: 'biography' },
          { label: '美國動畫', value: 'us_animation' },
          { label: '愛情', value: 'romance' },
          { label: '黑色幽默', value: 'dark_humor' },
          { label: '歌舞', value: 'musical' },
          { label: '兒童', value: 'children' },
          { label: '二次元', value: 'anime' },
          { label: '動物', value: 'animal' },
          { label: '青春', value: 'youth' },
          { label: '歷史', value: 'history' },
          { label: '勵志', value: 'inspirational' },
          { label: '惡搞', value: 'parody' },
          { label: '治癒', value: 'healing' },
          { label: '運動', value: 'sports' },
          { label: '後宮', value: 'harem' },
          { label: '情色', value: 'erotic' },
          { label: '人性', value: 'human_nature' },
          { label: '懸疑', value: 'suspense' },
          { label: '戀愛', value: 'love' },
          { label: '魔幻', value: 'fantasy' },
          { label: '科幻', value: 'sci_fi' },
        ];
      case 'anime-tv':
        return [
          ...baseOptions,
          { label: '黑色幽默', value: 'dark_humor' },
          { label: '歷史', value: 'history' },
          { label: '歌舞', value: 'musical' },
          { label: '勵志', value: 'inspirational' },
          { label: '惡搞', value: 'parody' },
          { label: '治癒', value: 'healing' },
          { label: '運動', value: 'sports' },
          { label: '後宮', value: 'harem' },
          { label: '情色', value: 'erotic' },
          { label: '國漫', value: 'chinese_anime' },
          { label: '人性', value: 'human_nature' },
          { label: '懸疑', value: 'suspense' },
          { label: '戀愛', value: 'love' },
          { label: '魔幻', value: 'fantasy' },
          { label: '科幻', value: 'sci_fi' },
        ];
      default:
        return baseOptions;
    }
  };

  // 根據內容類型獲取對應的平臺選項
  const getPlatformOptions = (
    contentType: 'movie' | 'tv' | 'show' | 'anime-tv' | 'anime-movie'
  ) => {
    const baseOptions = [{ label: '全部', value: 'all' }];

    switch (contentType) {
      case 'movie':
        return baseOptions; // 電影不需要平臺選項
      case 'tv':
      case 'anime-tv':
      case 'show':
        return [
          ...baseOptions,
          { label: '騰訊視頻', value: 'tencent' },
          { label: '愛奇藝', value: 'iqiyi' },
          { label: '優酷', value: 'youku' },
          { label: '湖南衛視', value: 'hunan_tv' },
          { label: 'Netflix', value: 'netflix' },
          { label: 'HBO', value: 'hbo' },
          { label: 'BBC', value: 'bbc' },
          { label: 'NHK', value: 'nhk' },
          { label: 'CBS', value: 'cbs' },
          { label: 'NBC', value: 'nbc' },
          { label: 'tvN', value: 'tvn' },
        ];
      default:
        return baseOptions;
    }
  };

  // 分類配置
  const categories: MultiLevelCategory[] = [
    ...(contentType !== 'anime-tv' && contentType !== 'anime-movie'
      ? [
          {
            key: 'type',
            label: '類型',
            options: getTypeOptions(contentType),
          },
        ]
      : [
          {
            key: 'label',
            label: '類型',
            options: getLabelOptions(contentType),
          },
        ]),
    {
      key: 'region',
      label: '地區',
      options: getRegionOptions(contentType),
    },
    {
      key: 'year',
      label: '年代',
      options: [
        { label: '全部', value: 'all' },
        { label: '2020年代', value: '2020s' },
        { label: '2025', value: '2025' },
        { label: '2024', value: '2024' },
        { label: '2023', value: '2023' },
        { label: '2022', value: '2022' },
        { label: '2021', value: '2021' },
        { label: '2020', value: '2020' },
        { label: '2019', value: '2019' },
        { label: '2010年代', value: '2010s' },
        { label: '2000年代', value: '2000s' },
        { label: '90年代', value: '1990s' },
        { label: '80年代', value: '1980s' },
        { label: '70年代', value: '1970s' },
        { label: '60年代', value: '1960s' },
        { label: '更早', value: 'earlier' },
      ],
    },
    // 只在電視劇和綜藝時顯示平臺選項
    ...(contentType === 'tv' ||
    contentType === 'show' ||
    contentType === 'anime-tv'
      ? [
          {
            key: 'platform',
            label: '平臺',
            options: getPlatformOptions(contentType),
          },
        ]
      : []),
    {
      key: 'sort',
      label: '排序',
      options: [
        { label: '綜合排序', value: 'T' },
        { label: '近期熱度', value: 'U' },
        {
          label:
            contentType === 'tv' || contentType === 'show'
              ? '首播時間'
              : '首映時間',
          value: 'R',
        },
        { label: '高分優先', value: 'S' },
      ],
    },
  ];

  // 計算下拉框位置
  const calculateDropdownPosition = (categoryKey: string) => {
    const element = categoryRefs.current[categoryKey];
    if (element) {
      const rect = element.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const isMobile = viewportWidth < 768; // md breakpoint

      let x = rect.left;
      let dropdownWidth = Math.max(rect.width, 300);
      let useFixedWidth = false; // 標記是否使用固定寬度

      // 移動端優化：防止下拉框被右側視口截斷
      if (isMobile) {
        const padding = 16; // 左右各留16px的邊距
        const maxWidth = viewportWidth - padding * 2;
        dropdownWidth = Math.min(dropdownWidth, maxWidth);
        useFixedWidth = true; // 移動端使用固定寬度

        // 如果右側超出視口，則調整x位置
        if (x + dropdownWidth > viewportWidth - padding) {
          x = viewportWidth - dropdownWidth - padding;
        }

        // 如果左側超出視口，則貼左邊
        if (x < padding) {
          x = padding;
        }
      }

      setDropdownPosition({
        x,
        y: rect.bottom,
        width: useFixedWidth ? dropdownWidth : rect.width, // PC端保持原有邏輯
      });
    }
  };

  // 處理分類點擊
  const handleCategoryClick = (categoryKey: string) => {
    if (activeCategory === categoryKey) {
      setActiveCategory(null);
    } else {
      setActiveCategory(categoryKey);
      calculateDropdownPosition(categoryKey);
    }
  };

  // 處理選項選擇
  const handleOptionSelect = (categoryKey: string, optionValue: string) => {
    // 更新本地狀態
    const newValues = {
      ...values,
      [categoryKey]: optionValue,
    };

    // 更新內部狀態
    setValues(newValues);

    // 構建傳遞給父組件的值，排序傳遞 value，其他傳遞 label
    const selectionsForParent: Record<string, string> = {
      type: 'all',
      region: 'all',
      year: 'all',
      platform: 'all',
      label: 'all',
      sort: 'T',
    };

    Object.entries(newValues).forEach(([key, value]) => {
      if (value && value !== 'all' && (key !== 'sort' || value !== 'T')) {
        const category = categories.find((cat) => cat.key === key);
        if (category) {
          const option = category.options.find((opt) => opt.value === value);
          if (option) {
            // 排序傳遞 value，其他傳遞 label
            selectionsForParent[key] =
              key === 'sort' ? option.value : option.label;
          }
        }
      }
    });

    // 調用父組件的回調，傳遞處理後的選擇值
    onChange(selectionsForParent);

    setActiveCategory(null);
  };

  // 獲取顯示文本
  const getDisplayText = (categoryKey: string) => {
    const category = categories.find((cat) => cat.key === categoryKey);
    if (!category) return '';

    const value = values[categoryKey];

    if (
      !value ||
      value === 'all' ||
      (categoryKey === 'sort' && value === 'T')
    ) {
      return category.label;
    }
    const option = category.options.find((opt) => opt.value === value);
    return option?.label || category.label;
  };

  // 檢查是否為默認值
  const isDefaultValue = (categoryKey: string) => {
    const value = values[categoryKey];
    return (
      !value || value === 'all' || (categoryKey === 'sort' && value === 'T')
    );
  };

  // 檢查選項是否被選中
  const isOptionSelected = (categoryKey: string, optionValue: string) => {
    let value = values[categoryKey];
    if (value === undefined) {
      value = 'all';
      if (categoryKey === 'sort') {
        value = 'T';
      }
    }
    return value === optionValue;
  };

  // 監聽滾動和窗口大小變化事件，重新計算位置
  useEffect(() => {
    const handleScroll = () => {
      if (activeCategory) {
        calculateDropdownPosition(activeCategory);
      }
    };

    const handleResize = () => {
      if (activeCategory) {
        calculateDropdownPosition(activeCategory);
      }
    };

    window.addEventListener('scroll', handleScroll);
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleResize);
    };
  }, [activeCategory]);

  // 點擊外部關閉下拉框
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        !Object.values(categoryRefs.current).some(
          (ref) => ref && ref.contains(event.target as Node)
        )
      ) {
        setActiveCategory(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <>
      {/* 膠囊樣式篩選欄 */}
      <div className='relative inline-flex rounded-full p-0.5 sm:p-1 bg-transparent gap-1 sm:gap-2'>
        {categories.map((category) => (
          <div
            key={category.key}
            ref={(el) => {
              categoryRefs.current[category.key] = el;
            }}
            className='relative'
          >
            <button
              onClick={() => handleCategoryClick(category.key)}
              className={`relative z-10 px-1.5 py-0.5 sm:px-2 sm:py-1 md:px-4 md:py-2 text-xs sm:text-sm font-medium rounded-full transition-all duration-200 whitespace-nowrap ${
                activeCategory === category.key
                  ? isDefaultValue(category.key)
                    ? 'text-gray-900 dark:text-gray-100 cursor-default'
                    : 'text-green-600 dark:text-green-400 cursor-default'
                  : isDefaultValue(category.key)
                  ? 'text-gray-700 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 cursor-pointer'
                  : 'text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300 cursor-pointer'
              }`}
            >
              <span>{getDisplayText(category.key)}</span>
              <svg
                className={`inline-block w-2.5 h-2.5 sm:w-3 sm:h-3 ml-0.5 sm:ml-1 transition-transform duration-200 ${
                  activeCategory === category.key ? 'rotate-180' : ''
                }`}
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2}
                  d='M19 9l-7 7-7-7'
                />
              </svg>
            </button>
          </div>
        ))}
      </div>

      {/* 展開的篩選選項 - 懸浮顯示 */}
      {activeCategory &&
        createPortal(
          <div
            ref={dropdownRef}
            className='fixed z-[9999] bg-white/95 dark:bg-gray-800/95 rounded-xl border border-gray-200/50 dark:border-gray-700/50 backdrop-blur-sm'
            style={{
              left: `${dropdownPosition.x}px`,
              top: `${dropdownPosition.y}px`,
              ...(window.innerWidth < 768
                ? { width: `${dropdownPosition.width}px` } // 移動端使用固定寬度
                : { minWidth: `${Math.max(dropdownPosition.width, 300)}px` }), // PC端使用最小寬度
              maxWidth: '600px',
              position: 'fixed',
            }}
          >
            <div className='p-2 sm:p-4'>
              <div className='grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-1 sm:gap-2'>
                {categories
                  .find((cat) => cat.key === activeCategory)
                  ?.options.map((option) => (
                    <button
                      key={option.value}
                      onClick={() =>
                        handleOptionSelect(activeCategory, option.value)
                      }
                      className={`px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm rounded-lg transition-all duration-200 text-left ${
                        isOptionSelected(activeCategory, option.value)
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border border-green-200 dark:border-green-700'
                          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100/80 dark:hover:bg-gray-700/80'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
};

export default MultiLevelSelector;
