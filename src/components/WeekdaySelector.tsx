/* eslint-disable react-hooks/exhaustive-deps */

'use client';

import React, { useEffect, useState } from 'react';

interface WeekdaySelectorProps {
  onWeekdayChange: (weekday: string) => void;
  className?: string;
}

const weekdays = [
  { value: 'Mon', label: '週一', shortLabel: '週一' },
  { value: 'Tue', label: '週二', shortLabel: '週二' },
  { value: 'Wed', label: '週三', shortLabel: '週三' },
  { value: 'Thu', label: '週四', shortLabel: '週四' },
  { value: 'Fri', label: '週五', shortLabel: '週五' },
  { value: 'Sat', label: '週六', shortLabel: '週六' },
  { value: 'Sun', label: '週日', shortLabel: '週日' },
];

const WeekdaySelector: React.FC<WeekdaySelectorProps> = ({
  onWeekdayChange,
  className = '',
}) => {
  // 獲取今天的星期數，默認選中今天
  const getTodayWeekday = (): string => {
    const today = new Date().getDay();
    // getDay() 返回 0-6，0 是週日，1-6 是週一到週六
    const weekdayMap = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return weekdayMap[today];
  };

  const [selectedWeekday, setSelectedWeekday] = useState<string>(
    getTodayWeekday()
  );

  // 組件初始化時通知父組件默認選中的星期
  useEffect(() => {
    onWeekdayChange(getTodayWeekday());
  }, []); // 只在組件掛載時執行一次

  return (
    <div
      className={`relative inline-flex rounded-full p-0.5 sm:p-1 ${className}`}
    >
      {weekdays.map((weekday) => {
        const isActive = selectedWeekday === weekday.value;
        return (
          <button
            key={weekday.value}
            onClick={() => {
              setSelectedWeekday(weekday.value);
              onWeekdayChange(weekday.value);
            }}
            className={`
              relative z-10 px-2 py-1 sm:px-4 sm:py-2 text-xs sm:text-sm font-medium rounded-full transition-all duration-200 whitespace-nowrap
              ${
                isActive
                  ? 'text-green-600 dark:text-green-400 font-semibold'
                  : 'text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 cursor-pointer'
              }
            `}
            title={weekday.label}
          >
            {weekday.shortLabel}
          </button>
        );
      })}
    </div>
  );
};

export default WeekdaySelector;
