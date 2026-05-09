'use client';

import { RefreshCw, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { formatTime } from '@/lib/formatTime';
import {
  aesDecrypt,
  downloadTsSegment,
  M3U8Task,
  StreamSaverMode,
} from '@/lib/m3u8-downloader';

interface SegmentViewerProps {
  task: M3U8Task;
  isOpen: boolean;
  onClose: () => void;
  onSegmentRetry?: (index: number) => void;
  taskExists?: () => boolean;
  concurrency?: number; // 並發下載數量，默認6
  streamMode?: StreamSaverMode; // 邊下邊存模式
}

const SegmentViewer = ({
  task,
  isOpen,
  onClose,
  onSegmentRetry,
  taskExists,
  concurrency = 6,
  streamMode = 'disabled',
}: SegmentViewerProps) => {
  const [retryingSegments, setRetryingSegments] = useState<Set<number>>(
    new Set()
  );
  const [, forceUpdate] = useState({});

  // 處理單個片段重試
  const handleRetrySegment = async (index: number) => {
    if (retryingSegments.has(index)) return;

    // 檢查任務是否仍然存在
    if (taskExists && !taskExists()) {
      // eslint-disable-next-line no-console
      console.log(`任務已刪除，取消片段 ${index + 1} 的重試`);
      return;
    }

    setRetryingSegments((prev) => new Set(prev).add(index));

    try {
      // 下載片段
      let segmentData = await downloadTsSegment(task.tsUrlList[index]);

      // AES 解密
      if (task.aesConf.key) {
        segmentData = aesDecrypt(
          segmentData,
          task.aesConf.key,
          task.aesConf.iv
        );
      }

      // 保存片段數據到任務的 downloadedSegments 中
      if (!task.downloadedSegments) {
        task.downloadedSegments = new Map();
      }
      task.downloadedSegments.set(index, segmentData);

      // 更新片段狀態
      task.finishList[index].status = 'success';
      task.finishNum++;
      task.errorNum = Math.max(0, task.errorNum - 1);

      // 觸發外部回調
      if (onSegmentRetry) {
        onSegmentRetry(index);
      }

      // 強制更新視圖
      forceUpdate({});

      // eslint-disable-next-line no-console
      console.log(`片段 ${index + 1} 重試成功，數據已保存`);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`片段 ${index + 1} 重試失敗:`, error);
    } finally {
      setRetryingSegments((prev) => {
        const newSet = new Set(prev);
        newSet.delete(index);
        return newSet;
      });
    }
  };

  // 批量重試所有失敗的片段（並發控制）
  const handleRetryAllFailed = async () => {
    // 檢查任務是否仍然存在
    if (taskExists && !taskExists()) {
      // eslint-disable-next-line no-console
      console.log('任務已刪除，取消批量重試');
      return;
    }

    const failedIndices = task.finishList
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.status === 'error')
      .map(({ index }) => index);

    if (failedIndices.length === 0) {
      // eslint-disable-next-line no-console
      console.log('⚠️ 沒有失敗的片段可重試');
      return;
    }

    // eslint-disable-next-line no-console
    console.log(
      `開始批量重試 ${failedIndices.length} 個失敗片段，並發數: ${concurrency}`
    );

    // 創建重試隊列
    const retryQueue = [...failedIndices];

    // 並發控制：同時最多 concurrency 個重試任務
    const processQueue = async () => {
      while (retryQueue.length > 0) {
        // 檢查任務是否仍然存在
        if (taskExists && !taskExists()) {
          // eslint-disable-next-line no-console
          console.log('任務已刪除，停止批量重試');
          return;
        }

        const index = retryQueue.shift();
        if (index !== undefined) {
          await handleRetrySegment(index);
        }
      }
    };

    // 啟動多個並發 worker
    const workers: Promise<void>[] = [];
    for (let i = 0; i < Math.min(concurrency, failedIndices.length); i++) {
      workers.push(processQueue());
    }

    try {
      await Promise.all(workers);

      // 檢查是否所有失敗片段都已重試成功
      const remainingErrors = task.finishList.filter(
        (item) => item.status === 'error'
      ).length;

      // eslint-disable-next-line no-console
      console.log(`批量重試完成，剩餘失敗片段: ${remainingErrors}`);

      if (remainingErrors === 0) {
        // eslint-disable-next-line no-console
        console.log(
          `✅ 所有片段已成功！已保存 ${
            task.downloadedSegments?.size || 0
          } 個片段數據，即將自動合並保存...`
        );
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('批量重試出錯:', error);
    }
  };

  // 按 ESC 關閉
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEsc);
    }

    return () => {
      document.removeEventListener('keydown', handleEsc);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // 根據範圍下載配置過濾片段
  const { startSegment, endSegment } = task.rangeDownload;
  const filteredSegments = task.finishList.slice(startSegment - 1, endSegment);
  const segmentOffset = startSegment - 1; // 用於計算實際索引

  // 計算時長範圍
  const segmentDurations = task.segmentDurations || [];
  const startTime = segmentDurations
    .slice(0, startSegment - 1)
    .reduce((a, b) => a + b, 0);
  const endTime = segmentDurations
    .slice(0, endSegment)
    .reduce((a, b) => a + b, 0);

  // 使用統一的 formatTime

  const successCount = filteredSegments.filter(
    (item) => item.status === 'success'
  ).length;
  const errorCount = filteredSegments.filter(
    (item) => item.status === 'error'
  ).length;
  const downloadingCount = filteredSegments.filter(
    (item) => item.status === 'downloading'
  ).length;
  const pendingCount = filteredSegments.filter(
    (item) => item.status === ''
  ).length;

  return (
    <div className='fixed inset-0 bg-black/50 backdrop-blur-sm z-[10000] flex items-center justify-center p-4'>
      <div className='bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-4xl max-h-[80vh] flex flex-col'>
        {/* 標題欄 */}
        <div className='flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700'>
          <div>
            <h2 className='text-lg font-semibold text-gray-900 dark:text-white'>
              片段列表
            </h2>
            <p className='text-sm text-gray-500 dark:text-gray-400 mt-1'>
              {task.title}
            </p>
            <p className='text-xs text-gray-400 dark:text-gray-500 mt-1'>
              片段範圍：{startSegment} ~ {endSegment} &nbsp;|&nbsp; 時長範圍：
              {formatTime(startTime)} ~ {formatTime(endTime)}
            </p>
          </div>
          <button
            onClick={onClose}
            className='p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors'
          >
            <X className='h-5 w-5' />
          </button>
        </div>

        {/* 統計信息 */}
        <div className='p-4 bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700'>
          <div className='grid grid-cols-2 sm:grid-cols-5 gap-3'>
            <div className='bg-white dark:bg-gray-800 rounded-lg p-3'>
              <div className='text-xs text-gray-500 dark:text-gray-400'>
                總片段
              </div>
              <div className='text-lg font-semibold text-gray-900 dark:text-white mt-1'>
                {filteredSegments.length}
              </div>
            </div>
            <div className='bg-green-50 dark:bg-green-900/20 rounded-lg p-3'>
              <div className='text-xs text-green-600 dark:text-green-400'>
                成功
              </div>
              <div className='text-lg font-semibold text-green-700 dark:text-green-300 mt-1'>
                {successCount}
              </div>
            </div>
            <div className='bg-red-50 dark:bg-red-900/20 rounded-lg p-3 relative'>
              <div className='text-xs text-red-600 dark:text-red-400'>失敗</div>
              <div className='flex items-center justify-between mt-1'>
                <div className='text-lg font-semibold text-red-700 dark:text-red-300'>
                  {errorCount}
                </div>
                <button
                  onClick={handleRetryAllFailed}
                  disabled={
                    retryingSegments.size > 0 ||
                    errorCount === 0 ||
                    streamMode !== 'disabled'
                  }
                  className='p-1.5 rounded-md hover:bg-red-200 dark:hover:bg-red-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
                  title={
                    streamMode !== 'disabled'
                      ? '邊下邊存模式重試由重試次數控制'
                      : '重試所有失敗片段'
                  }
                >
                  <RefreshCw
                    className={`h-4 w-4 text-red-600 dark:text-red-400 ${
                      retryingSegments.size > 0 ? 'animate-spin' : ''
                    }`}
                  />
                </button>
              </div>
            </div>
            <div className='bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3'>
              <div className='text-xs text-blue-600 dark:text-blue-400'>
                下載中
              </div>
              <div className='text-lg font-semibold text-blue-700 dark:text-blue-300 mt-1'>
                {downloadingCount}
              </div>
            </div>
            <div className='bg-gray-100 dark:bg-gray-700 rounded-lg p-3'>
              <div className='text-xs text-gray-600 dark:text-gray-400'>
                待下載
              </div>
              <div className='text-lg font-semibold text-gray-700 dark:text-gray-300 mt-1'>
                {pendingCount}
              </div>
            </div>
          </div>
        </div>

        {/* 片段列表 */}
        <div className='flex-1 overflow-y-auto p-4'>
          <div className='grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2'>
            {filteredSegments.map((segment, relativeIndex) => {
              const index = segmentOffset + relativeIndex; // 實際索引
              const isRetrying = retryingSegments.has(index);
              const bgColor =
                segment.status === 'success'
                  ? 'bg-green-100 dark:bg-green-900/30 border-green-300 dark:border-green-700'
                  : segment.status === 'error'
                  ? 'bg-red-100 dark:bg-red-900/30 border-red-300 dark:border-red-700'
                  : segment.status === 'downloading'
                  ? 'bg-blue-100 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700'
                  : 'bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600';

              const textColor =
                segment.status === 'success'
                  ? 'text-green-700 dark:text-green-300'
                  : segment.status === 'error'
                  ? 'text-red-700 dark:text-red-300'
                  : segment.status === 'downloading'
                  ? 'text-blue-700 dark:text-blue-300'
                  : 'text-gray-700 dark:text-gray-300';

              return (
                <div
                  key={index}
                  className={`relative border rounded-lg p-3 transition-all ${bgColor} ${
                    segment.status === 'error' &&
                    !isRetrying &&
                    streamMode === 'disabled'
                      ? 'cursor-pointer hover:shadow-md'
                      : ''
                  }`}
                  onClick={() => {
                    if (
                      segment.status === 'error' &&
                      !isRetrying &&
                      streamMode === 'disabled'
                    ) {
                      handleRetrySegment(index);
                    }
                  }}
                  title={
                    segment.status === 'error'
                      ? streamMode !== 'disabled'
                        ? '邊下邊存模式無法重試失敗片段'
                        : '點擊重試'
                      : segment.status === 'success'
                      ? '下載成功'
                      : segment.status === 'downloading'
                      ? '下載中'
                      : '待下載'
                  }
                >
                  <div className='flex items-center justify-between'>
                    <span className={`text-sm font-medium ${textColor}`}>
                      #{index + 1}
                    </span>
                    {segment.status === 'error' && (
                      <RefreshCw
                        className={`h-3 w-3 ${textColor} ${
                          isRetrying ? 'animate-spin' : ''
                        }`}
                      />
                    )}
                  </div>
                  <div className={`text-xs mt-1 ${textColor} opacity-75`}>
                    {segment.status === 'success'
                      ? '✓ 成功'
                      : segment.status === 'error'
                      ? `✗ 失敗${
                          segment.retryCount
                            ? ` (重試${segment.retryCount}次)`
                            : ''
                        }`
                      : segment.status === 'downloading'
                      ? `⟳ ${
                          segment.retryCount && segment.retryCount > 0
                            ? `重試中(第${segment.retryCount}次)`
                            : '下載中'
                        }`
                      : '○ 待下載'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 底部提示 */}
        <div className='p-4 bg-gray-50 dark:bg-gray-900/50 border-t border-gray-200 dark:border-gray-700'>
          <p className='text-xs text-gray-500 dark:text-gray-400 text-center'>
            點擊紅色片段可以重試下載 • 綠色表示成功 • 藍色表示下載中 •
            灰色表示待下載
          </p>
        </div>
      </div>
    </div>
  );
};

export default SegmentViewer;
