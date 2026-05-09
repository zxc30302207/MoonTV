/* eslint-disable no-console, @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */
'use client';

import { useEffect } from 'react';

/**
 * 訂閱自動更新檢查組件
 * 在頁面加載時檢查是否需要自動更新訂閱，並執行導入（如果需要）
 * 僅執行一次（組件掛載時）
 */
export default function SubscriptionAutoUpdate() {
  useEffect(() => {
    const checkUpdate = async () => {
      try {
        const response = await fetch('/api/admin/subscription', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'check' }),
        });
        if (response.ok) {
          const data = await response.json();
          if (data.updated) {

            console.log('訂閱自動更新已執行', data);
          } else {
            console.log('訂閱自動更新未執行:', data.reason);
          }
        } else {
          console.warn('訂閱自動更新檢查失敗:', response.status);
        }
      } catch (error) {
        // 靜默失敗，不影響用戶體驗
        console.error('訂閱自動更新檢查異常:', error);
      }
    };

    checkUpdate();
  }, []); // 空依賴數組確保只運行一次

  // 該組件不渲染任何內容
  return null;
}