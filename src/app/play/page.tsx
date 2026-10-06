import { Suspense } from 'react';

import PlayClient from './PlayClient';

/**
 * 播放頁入口。
 *
 * 完整邏輯已拆分至同目錄下的 usePlayEngine / PlayClient 及
 * components / hooks / play-utils 模塊，此文件僅保留 Suspense 包裝。
 */
export default function PlayPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <PlayClient />
    </Suspense>
  );
}
