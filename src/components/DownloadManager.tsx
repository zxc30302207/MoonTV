'use client';

import { Download, List, Pause, Play, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import Swal from 'sweetalert2';

import { formatTime } from '@/lib/formatTime';
import { downloadM3U8Video, DownloadProgress, M3U8Task, parseM3U8, PauseResumeController, StreamSaverMode } from '@/lib/m3u8-downloader';

import AddDownloadModal from './AddDownloadModal';
import SegmentViewer from './SegmentViewer';


interface DownloadTask {
  id: string;
  url: string;
  title: string;
  status: 'waiting' | 'downloading' | 'paused' | 'completed' | 'error' | 'merging';
  progress: number;
  current: number;
  total: number;
  abortController?: AbortController;
  pauseResumeController?: PauseResumeController; // 暫停/恢復控制器
  completeStreamRef?: { current: (() => Promise<void>) | null }; // 完成流函數引用（用於邊下邊存模式立即保存）
  isEarlyCompleting?: boolean; // 標記是否正在提前完成（用於避免錯誤處理覆蓋狀態）
  autoResume?: boolean; // 標記是否需要自動恢復下載（刷新頁面導致的暫停）
  // 任務配置信息（用於斷點續傳）
  config?: {
    downloadType: 'TS' | 'MP4';
    concurrency: number;
    rangeMode: boolean;
    startSegment: number;
    endSegment: number;
    streamMode?: StreamSaverMode;
    maxRetries?: number; // 最大重試次數
    parsedTask?: M3U8Task;
  };
  // 片段信息（用於查看和重試）
  parsedTask?: M3U8Task;
}

interface DownloadManagerProps {
  isOpen: boolean;
  onClose: () => void;
  onReady?: () => void;
}

const DownloadManager = ({
  isOpen,
  onClose,
  onReady,
}: DownloadManagerProps) => {
  // 任務列表狀態
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  // 添加下載彈窗狀態
  const [showAddModal, setShowAddModal] = useState(false);
  // 查看片段的任務ID
  const [viewingSegmentsTaskId, setViewingSegmentsTaskId] = useState<string | null>(null);
  // 使用 ref 保存最新的 tasks，用於事件處理器
  const tasksRef = useRef<DownloadTask[]>([]);
  // 追蹤是否已經處理過自動恢復
  const hasAutoResumed = useRef(false);
  // 標記頁面是否正在卸載
  const isUnloading = useRef(false);
  // 防止重復觸發合並的標記
  const mergingTaskIds = useRef(new Set<string>());

  // 同步 tasks 到 ref
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  useEffect(() => {
    onReady?.();
  }, [onReady]);

  // 從 localStorage 加載任務
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('downloadTasks');
      if (saved) {
        try {
          const savedTasks = JSON.parse(saved);

          const processedTasks = savedTasks.map((t: DownloadTask & { _originalStatus?: string }) => {
            // 使用 _originalStatus 判斷是否需要自動恢復
            const wasDownloading = t._originalStatus === 'downloading' || t.status === 'downloading';
            const { _originalStatus, ...taskWithoutOriginal } = t;

            return {
              ...taskWithoutOriginal,
              // 如果之前正在下載，設為暫停並標記自動恢復
              status: wasDownloading ? 'paused' : t.status,
              autoResume: wasDownloading,
              abortController: undefined
            };
          });

          setTasks(processedTasks);
        } catch {
          // 忽略解析錯誤
        }
      }
    }
  }, []);

  // 自動恢復因刷新頁面而暫停的下載任務
  useEffect(() => {
    // 只執行一次自動恢復
    if (hasAutoResumed.current) return;

    const tasksToResume = tasks.filter(t => t.autoResume && t.status === 'paused');

    if (tasksToResume.length > 0) {
      hasAutoResumed.current = true;

      // 延遲一點時間後開始恢復下載，確保組件已完全加載
      setTimeout(() => {
        tasksToResume.forEach(task => {
          resumeTask(task.id);
        });

        // 清除 autoResume 標記
        setTasks(prev => prev.map(t => ({ ...t, autoResume: false })));
      }, 500);
    }
  }, [tasks]); // eslint-disable-line react-hooks/exhaustive-deps

  // 保存任務到 localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const tasksToSave = tasks.map(({ abortController: _abortController, pauseResumeController: _pauseResumeController, config, ...rest }) => ({
        ...rest,
        // 保存配置但排除 parsedTask（太大）
        config: config ? {
          downloadType: config.downloadType,
          concurrency: config.concurrency,
          rangeMode: config.rangeMode,
          startSegment: config.startSegment,
          endSegment: config.endSegment,
          streamMode: config.streamMode,
          maxRetries: config.maxRetries,
        } : undefined,
        // 保存原始狀態，用於恢復時判斷
        _originalStatus: rest.status,
      }));
      localStorage.setItem('downloadTasks', JSON.stringify(tasksToSave));

      // 觸發自定義事件，通知任務列表更新
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('downloadTasksUpdated'));
      }
    }
  }, [tasks]);

  // 頁面卸載/刷新時取消所有正在下載的任務
  useEffect(() => {
    const handleBeforeUnload = () => {
      // 標記頁面正在卸載
      isUnloading.current = true;

      // 使用 ref 獲取最新的 tasks
      tasksRef.current.forEach(task => {
        if (task.status === 'downloading' && task.abortController) {
          task.abortController.abort();
        }
        if (task.pauseResumeController) {
          task.pauseResumeController.destroy();
        }
      });
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []); // 空依賴數組，避免重復綁定/解綁

  // 執行下載任務（核心下載邏輯）
  const executeDownload = useCallback(async (
    taskId: string,
    parsedTask: M3U8Task,
    controller: AbortController,
    pauseResumeController: PauseResumeController,
    downloadType: 'TS' | 'MP4',
    concurrency: number,
    rangeMode: boolean,
    startSegment: number,
    endSegment: number,
    streamMode: StreamSaverMode = 'disabled',
    maxRetries = 3,
    completeStreamRef?: { current: (() => Promise<void>) | null }
  ) => {
    try {
      // 不要創建新對象，直接使用傳入的 parsedTask
      // 只修改需要的屬性
      parsedTask.type = downloadType;

      if (rangeMode) {
        parsedTask.rangeDownload = {
          startSegment: Math.max(1, Math.min(startSegment, parsedTask.tsUrlList.length)),
          endSegment: Math.max(1, Math.min(endSegment, parsedTask.tsUrlList.length)),
          targetSegment: Math.abs(endSegment - startSegment) + 1,
        };
      }

      await downloadM3U8Video(
        parsedTask,
        (prog: DownloadProgress) => {
          setTasks(prev => prev.map(t => {
            if (t.id !== taskId) return t;
            // 合並中時不更新進度
            if (t.status === 'merging') return t;
            // 如果正在提前完成，不更新狀態（狀態會在立即保存時手動更新）
            if (t.isEarlyCompleting) return t;

            // 只有任務本身是 downloading 時才允許更新狀態，避免手動暫停被覆蓋
            const shouldUpdateStatus = t.status === 'downloading';

            // 創建新的 parsedTask 引用以觸發重新渲染
            // 注意：downloadedSegments 是 Map，需要保持引用以便數據共享
            // 重要：finishList 也保持引用，避免覆蓋手動重試的狀態
            const updatedParsedTask = t.parsedTask ? {
              ...t.parsedTask,
              finishNum: parsedTask.finishNum,
              errorNum: parsedTask.errorNum,
              // 保持 finishList 的引用，不要覆蓋（手動重試可能已更新）
              finishList: parsedTask.finishList,
              // 保持 downloadedSegments 的引用，確保數據共享
              downloadedSegments: parsedTask.downloadedSegments,
            } : undefined;

            return {
              ...t,
              progress: prog.percentage,
              current: prog.current,
              total: prog.total,
              status: shouldUpdateStatus
                ? (prog.status === 'done' ? 'completed' : prog.status === 'error' ? 'error' : 'downloading')
                : t.status,
              parsedTask: updatedParsedTask,
            };
          }));
        },
        controller.signal,
        pauseResumeController,
        concurrency,
        streamMode,
        maxRetries,
        completeStreamRef
      );

      // 下載函數執行完成後，檢查是否有失敗片段
      const taskAfterDownload = tasksRef.current.find(t => t.id === taskId);
      const hasFailedSegments = taskAfterDownload?.parsedTask?.finishList.some(
        item => item.status === 'error'
      );

      // 邊下邊存模式下，失敗片段已被跳過並寫入文件，無需等待重試
      // 只有普通模式下有失敗片段才需要保持 abortController 等待手動重試
      if (hasFailedSegments && streamMode === 'disabled') {
        // 普通模式：有失敗片段，保持 abortController 以便後續可以區分狀態
        // eslint-disable-next-line no-console
        console.log(`⚠️ 任務 ${taskId} 有失敗片段，保持下載狀態等待重試`);
      } else {
        // 邊下邊存模式或全部成功，清除 abortController
        setTasks(prev => prev.map(t =>
          t.id === taskId
            ? { ...t, abortController: undefined }
            : t
        ));

        if (hasFailedSegments && streamMode !== 'disabled') {
          // eslint-disable-next-line no-console
          console.log(`✅ 邊下邊存模式：任務 ${taskId} 已完成，失敗片段已跳過`);
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message === '下載已取消') {
        // 檢查是否是提前完成的情況
        const taskAfterError = tasksRef.current.find(t => t.id === taskId);
        // 如果任務正在提前完成，或者已經完成，都不需要更新狀態
        if (taskAfterError?.isEarlyCompleting || taskAfterError?.status === 'completed') {
          // 如果是提前完成，狀態已經在立即保存時更新了，不需要再次更新
          return;
        }

        // 如果是頁面卸載導致的取消，不更新狀態
        if (!isUnloading.current) {
          setTasks(prev => prev.map(t =>
            t.id === taskId
              ? { ...t, status: 'paused' as const, abortController: undefined }
              : t
          ));
        }
      } else {
        // eslint-disable-next-line no-console
        console.error('下載失敗:', error);
        setTasks(prev => prev.map(t =>
          t.id === taskId
            ? { ...t, status: 'error' as const, abortController: undefined }
            : t
        ));
      }
    }
  }, []);

  // 從配置創建並開始下載任務
  const addTaskFromConfig = useCallback((config: {
    url: string;
    title: string;
    downloadType: 'TS' | 'MP4';
    concurrency: number;
    rangeMode: boolean;
    startSegment: number;
    endSegment: number;
    streamMode: StreamSaverMode;
    maxRetries: number;
    parsedTask: M3U8Task;
  }) => {
    const taskId = Date.now().toString();
    const controller = new AbortController();
    const pauseResumeController = new PauseResumeController();
    const completeStreamRef = { current: null as (() => Promise<void>) | null };

    // 創建新任務並直接開始下載
    const newTask: DownloadTask = {
      id: taskId,
      url: config.url,
      title: config.title,
      status: 'downloading',
      progress: 0,
      current: 0,
      total: config.parsedTask.tsUrlList.length,
      config: {
        downloadType: config.downloadType,
        concurrency: config.concurrency,
        rangeMode: config.rangeMode,
        startSegment: config.startSegment,
        endSegment: config.endSegment,
        streamMode: config.streamMode,
          maxRetries: config.maxRetries ?? 3,
        parsedTask: config.parsedTask,
      },
      parsedTask: config.parsedTask, // 保存片段信息
      abortController: controller,
      pauseResumeController: pauseResumeController,
      completeStreamRef: completeStreamRef,
    };

    // 添加到任務列表
    setTasks(prev => [...prev, newTask]);

    // 使用 setTimeout 確保 state 更新後再開始下載
    setTimeout(() => {
      executeDownload(
        taskId,
        config.parsedTask,
        controller,
        pauseResumeController,
        config.downloadType,
        config.concurrency,
        config.rangeMode,
        config.startSegment,
        config.endSegment,
        config.streamMode,
        config.maxRetries || 3,
        completeStreamRef
      );
    }, 0);
  }, [executeDownload]);

  // 監聽來自播放頁面的添加下載任務事件
  useEffect(() => {
    const handleAddTaskEvent = (event: CustomEvent) => {
      const config = event.detail;
      const taskId = Date.now().toString();
      const controller = new AbortController();
      const pauseResumeController = new PauseResumeController();
      const completeStreamRef = { current: null as (() => Promise<void>) | null };

      // 創建新任務並直接開始下載
      const newTask: DownloadTask = {
        id: taskId,
        url: config.url,
        title: config.title,
        status: 'downloading',
        progress: 0,
        current: 0,
        total: config.parsedTask.tsUrlList.length,
        config: {
          downloadType: config.downloadType,
          concurrency: config.concurrency,
          rangeMode: config.rangeMode,
          startSegment: config.startSegment,
          endSegment: config.endSegment,
          streamMode: config.streamMode,
          maxRetries: config.maxRetries ?? 3,
          parsedTask: config.parsedTask,
        },
        parsedTask: config.parsedTask, // 保存片段信息
        abortController: controller,
        pauseResumeController: pauseResumeController,
        completeStreamRef: completeStreamRef,
      };

      // 添加到任務列表
      setTasks(prev => [...prev, newTask]);

      // 使用 setTimeout 確保 state 更新後再開始下載
      setTimeout(() => {
        executeDownload(
          taskId,
          config.parsedTask,
          controller,
          pauseResumeController,
          config.downloadType,
          config.concurrency,
          config.rangeMode,
          config.startSegment,
          config.endSegment,
          config.streamMode,
          config.maxRetries ?? 3,
          completeStreamRef
        );
      }, 0);
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('addDownloadTask', handleAddTaskEvent as EventListener);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('addDownloadTask', handleAddTaskEvent as EventListener);
      }
    };
  }, [executeDownload]); // 直接依賴 executeDownload

  // 執行下載任務（從任務配置啟動）
  const startTaskDownload = useCallback(async (taskId: string, parsedTask: M3U8Task) => {
    // 使用 tasksRef 獲取最新的 tasks
    const taskToDownload = tasksRef.current.find(t => t.id === taskId);
    if (!taskToDownload?.config) return;

    const controller = new AbortController();
    const pauseResumeController = new PauseResumeController();
    const completeStreamRef = { current: null as (() => Promise<void>) | null };
    const { downloadType, concurrency, rangeMode, startSegment, endSegment, streamMode, maxRetries } = taskToDownload.config;

    // 更新任務狀態
    setTasks(prev => prev.map(t =>
      t.id === taskId
        ? { ...t, status: 'downloading' as const, abortController: controller, pauseResumeController: pauseResumeController, completeStreamRef: completeStreamRef }
        : t
    ));

    executeDownload(taskId, parsedTask, controller, pauseResumeController, downloadType, concurrency, rangeMode, startSegment, endSegment, streamMode || 'disabled', maxRetries ?? 3, completeStreamRef);
  }, [executeDownload]);

  // 刪除任務
  const deleteTask = useCallback((taskId: string) => {
    setTasks(prev => {
      const task = prev.find(t => t.id === taskId);
      if (task?.abortController) {
        task.abortController.abort();
      }
      if (task?.pauseResumeController) {
        task.pauseResumeController.destroy();
      }
      return prev.filter(t => t.id !== taskId);
    });
  }, []);

  // 暫停任務
  const pauseTask = useCallback((taskId: string) => {
    setTasks(prev => {
      const task = prev.find(t => t.id === taskId);
      if (task?.pauseResumeController) {
        task.pauseResumeController.pause();
      }
      return prev.map(t =>
        t.id === taskId
          ? { ...t, status: 'paused' as const }
          : t
      );
    });
  }, []);

  // 繼續下載任務
  const resumeTask = useCallback(async (taskId: string) => {
    // eslint-disable-next-line no-console
    console.log(`🔄 resumeTask 被調用: taskId=${taskId}`);

    // 使用 tasksRef 獲取最新的 tasks
    const taskToResume = tasksRef.current.find(t => t.id === taskId);
    if (!taskToResume) {
      // eslint-disable-next-line no-console
      console.log(`⚠️ 找不到任務: ${taskId}`);
      return;
    }

    // eslint-disable-next-line no-console
    console.log(`📋 任務狀態: ${taskToResume.status}, abortController: ${!!taskToResume.abortController}`);

    // 檢查是否有失敗片段
    const hasFailedSegments = taskToResume.parsedTask?.finishList.some(
      item => item.status === 'error'
    );

    // 如果任務正在下載中（有 abortController）且還有失敗片段，不重復開始
    if (taskToResume.status === 'downloading' && taskToResume.abortController && hasFailedSegments) {
      // eslint-disable-next-line no-console
      console.log(`⚠️ 任務正在下載中且有失敗片段，跳過`);
      return;
    }

    // 如果任務有 pauseResumeController 且處於暫停狀態，只需恢復即可
    if (taskToResume.pauseResumeController && taskToResume.pauseResumeController.getPaused()) {
      // eslint-disable-next-line no-console
      console.log(`▶️ 任務處於暫停狀態，恢復下載...`);
      taskToResume.pauseResumeController.resume();
      setTasks(prev => prev.map(t =>
        t.id === taskId
          ? { ...t, status: 'downloading' as const }
          : t
      ));
      return;
    }

    // 使用 task.parsedTask 而不是 config.parsedTask，因為手動重試更新的是 task.parsedTask
    const parsedTaskToUse = taskToResume.parsedTask || taskToResume.config?.parsedTask;

    if (parsedTaskToUse) {
      const downloadedCount = parsedTaskToUse.downloadedSegments?.size || 0;
      const isStreamMode = taskToResume.config?.streamMode !== 'disabled';

      // 檢查是否還有需要下載的片段(空狀態表示待下載)
      const { startSegment, endSegment } = parsedTaskToUse.rangeDownload;
      let pendingCount = 0;
      let successCount = 0;
      let errorCount = 0;

      for (let i = startSegment - 1; i < endSegment; i++) {
        const status = parsedTaskToUse.finishList[i].status;
        if (status === '' || status === 'downloading') pendingCount++;
        else if (status === 'success') successCount++;
        else if (status === 'error') errorCount++;
      }

      const totalInRange = endSegment - startSegment + 1;

      // eslint-disable-next-line no-console
      console.log(`✅ 使用已保存的 parsedTask，範圍內片段: ${totalInRange}個，成功: ${successCount}，失敗: ${errorCount}，待下載: ${pendingCount}，已保存數據: ${downloadedCount} 個, 邊下邊存: ${isStreamMode}`);

      // 如果範圍內所有片段都已完成(沒有pending)
      if (pendingCount === 0) {
        // 全部成功
        if (errorCount === 0) {
          // eslint-disable-next-line no-console
          console.log(`🎉 範圍內所有 ${totalInRange} 個片段都已成功下載`);

          // 邊下邊存模式：數據已直接寫入文件，直接標記為完成
          if (isStreamMode) {
            // eslint-disable-next-line no-console
            console.log(`✅ 邊下邊存模式，數據已寫入文件，直接標記為完成`);
            setTasks(prev => prev.map(t =>
              t.id === taskId ? { ...t, status: 'completed' as const, progress: 100 } : t
            ));
            return;
          }

          // 普通模式：需要合並片段數據
          // eslint-disable-next-line no-console
          console.log(`📦 普通模式，開始合並 ${downloadedCount} 個片段數據...`);

          // 先標記為合並中
          setTasks(prev => prev.map(t =>
            t.id === taskId ? { ...t, status: 'merging' as const, progress: 99 } : t
          ));

          // 異步合並和下載
          setTimeout(async () => {
            try {
              // 從 downloadedSegments 按順序獲取片段數據
              const segments: ArrayBuffer[] = [];
              for (let i = startSegment - 1; i < endSegment; i++) {
                const segment = parsedTaskToUse.downloadedSegments?.get(i);
                if (segment) {
                  segments.push(segment);
                }
              }

              if (segments.length === 0) {
                throw new Error('沒有可合並的片段數據');
              }

              // eslint-disable-next-line no-console
              console.log(`📦 合並 ${segments.length} 個片段...`);

              // 動態導入合並函數
              const { mergeSegments, triggerDownload } = await import('@/lib/m3u8-downloader');
              const { transmuxTSToMP4 } = await import('@/lib/mp4-transmuxer');

              // 如果是 MP4 格式，進行轉碼
              const downloadType = taskToResume.config?.downloadType || 'TS';
              let blob: Blob;

              if (downloadType === 'MP4') {
                // 計算範圍內的視頻時長
                const totalDuration = parsedTaskToUse.durationSecond || 0;
                const totalSegmentsCount = parsedTaskToUse.finishList.length;
                const rangeDuration = (totalInRange / totalSegmentsCount) * totalDuration;

                // eslint-disable-next-line no-console
                console.log(`🎬 轉碼為 MP4 格式...`);
                blob = transmuxTSToMP4(segments, rangeDuration);
              } else {
                blob = mergeSegments(segments, downloadType);
              }

              // 觸發下載
              triggerDownload(blob, parsedTaskToUse.title, downloadType);

              // 標記為完成
              setTasks(prev => prev.map(t =>
                t.id === taskId ? { ...t, status: 'completed' as const, progress: 100 } : t
              ));

              // eslint-disable-next-line no-console
              console.log(`✅ 合並下載完成！`);
            } catch (error) {
              // eslint-disable-next-line no-console
              console.error('合並下載失敗:', error);
              setTasks(prev => prev.map(t =>
                t.id === taskId ? { ...t, status: 'error' as const } : t
              ));
            }
          }, 100);

          return;
        } else {
          // 有失敗片段，不啟動下載，等待手動重試
          // eslint-disable-next-line no-console
          console.log(`⚠️ 範圍內有 ${errorCount} 個片段失敗，等待手動重試`);
          return;
        }
      }

      // 還有片段未下載完成，繼續下載
      // eslint-disable-next-line no-console
      console.log(`▶️ 還有 ${pendingCount} 個片段待下載，繼續下載...`);
      startTaskDownload(taskId, parsedTaskToUse);
      return;
    }

    // 否則重新解析並下載
    try {
      const parsedTask = await parseM3U8(taskToResume.url);
      parsedTask.title = taskToResume.title;

      // 保存解析結果到任務配置，保留原有的用戶配置
      setTasks(prev => prev.map(t =>
        t.id === taskId
          ? {
            ...t,
            config: {
              downloadType: t.config?.downloadType || 'TS',
              concurrency: t.config?.concurrency || 6,
              rangeMode: t.config?.rangeMode || false,
              startSegment: t.config?.startSegment || 1,
              endSegment: t.config?.endSegment || parsedTask.tsUrlList.length,
              streamMode: t.config?.streamMode || 'disabled',
              parsedTask,
            }
          }
          : t
      ));

      startTaskDownload(taskId, parsedTask);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('重新解析失敗:', error);
      setTasks(prev => prev.map(t =>
        t.id === taskId
          ? { ...t, status: 'error' as const }
          : t
      ));
    }
  }, [startTaskDownload]);

  // 全部暫停
  const pauseAllTasks = useCallback(() => {
    setTasks(prev => {
      prev.forEach(task => {
        if (task.status === 'downloading' && task.pauseResumeController) {
          task.pauseResumeController.pause();
        }
      });
      return prev.map(t =>
        t.status === 'downloading'
          ? { ...t, status: 'paused' as const }
          : t
      );
    });
  }, []);

  // 全部開始
  const startAllTasks = useCallback(() => {
    // 使用 tasksRef 獲取最新的 tasks，避免閉包問題
    tasksRef.current.forEach(task => {
      if (task.status === 'waiting' || task.status === 'paused' || task.status === 'error') {
        resumeTask(task.id);
      }
    });
  }, [resumeTask]); // eslint-disable-line react-hooks/exhaustive-deps

  // 清空所有任務
  const clearAllTasks = useCallback(() => {
    setTasks(prev => {
      prev.forEach(task => {
        if (task.abortController) {
          task.abortController.abort();
        }
        if (task.pauseResumeController) {
          task.pauseResumeController.destroy();
        }
      });
      return [];
    });
  }, []);

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-4xl max-h-[80vh] flex flex-col">
          {/* 頭部 */}
          <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <Download className="h-5 w-5" />
              下載管理器
            </h2>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* 操作欄 */}
          <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex gap-2">
            <button
              onClick={() => setShowAddModal(true)}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors flex items-center gap-2"
            >
              <Download className="h-4 w-4" />
              添加下載
            </button>
            <button
              onClick={startAllTasks}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center gap-2"
            >
              <Play className="h-4 w-4" />
              全部開始
            </button>
            <button
              onClick={pauseAllTasks}
              className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg transition-colors flex items-center gap-2"
            >
              <Pause className="h-4 w-4" />
              全部暫停
            </button>
            <button
              onClick={clearAllTasks}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
            >
              清空全部
            </button>
          </div>

          {/* 任務列表 */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {tasks.length === 0 ? (
              <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                暫無下載任務
              </div>
            ) : (
              tasks.map((task) => (
                <div
                  key={task.id}
                  className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 space-y-3"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-gray-900 dark:text-white truncate">
                        {task.title}
                      </h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400 truncate mt-1">
                        {task.url}
                      </p>
                      {/* 下載配置信息 */}
                      {task.config && (
                        <div className="flex flex-wrap gap-2 mt-2">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
                            {task.config.downloadType} 格式
                          </span>
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400">
                            {task.config.concurrency} 線程
                          </span>
                          {task.config.rangeMode && (
                            (() => {
                              // 計算時長範圍
                              let startTime = 0, endTime = 0;
                              if (task.parsedTask && Array.isArray(task.parsedTask.segmentDurations)) {
                                const { startSegment, endSegment } = task.parsedTask.rangeDownload;
                                const segs = task.parsedTask.segmentDurations;
                                startTime = segs.slice(0, startSegment - 1).reduce((a, b) => a + b, 0);
                                endTime = segs.slice(0, endSegment).reduce((a, b) => a + b, 0);
                              }
                              // 格式化
                              // 使用統一的 formatTime
                              return (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400">
                                  範圍: {task.config.startSegment}-{task.config.endSegment}
                                  {task.parsedTask && task.parsedTask.segmentDurations && task.parsedTask.segmentDurations.length > 0 && (
                                    <>
                                      &nbsp;|&nbsp;時長: {formatTime(startTime)} ~ {formatTime(endTime)}
                                    </>
                                  )}
                                </span>
                              );
                            })()
                          )}
                          {task.parsedTask && (() => {
                            // 直接同步 SegmentViewer 的失敗片段統計邏輯
                            const { startSegment, endSegment } = task.parsedTask.rangeDownload;
                            const filteredSegments = task.parsedTask.finishList.slice(startSegment - 1, endSegment);
                            const errorCount = filteredSegments.filter(item => item.status === 'error').length;
                            return errorCount > 0 ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
                                失敗: {errorCount} 個片段
                              </span>
                            ) : null;
                          })()}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {/* 立即保存按鈕 */}
                      {task.parsedTask && (
                        <button
                          onClick={async () => {
                            // 防止重復觸發
                            if (mergingTaskIds.current.has(task.id)) return;
                            // 類型檢查：確保 parsedTask 存在
                            if (!task.parsedTask) return;

                            const streamMode = task.config?.streamMode || 'disabled';

                            // 邊下邊存模式：提示用戶確認並完成流
                            if (streamMode !== 'disabled') {
                              const result = await Swal.fire({
                                title: '立即保存',
                                text: '立即保存將跳過後續片段下載，直接完成下載。文件將包含目前已下載的片段。\n\n是否繼續？',
                                icon: 'warning',
                                showCancelButton: true,
                                confirmButtonText: '確定',
                                cancelButtonText: '取消',
                                customClass: {
                                  container: 'z-[11000]'
                                },
                              });
                              if (!result.isConfirmed) return;
                              // 調用完成流函數來關閉流並完成下載
                              if (task.completeStreamRef?.current) {
                                try {
                                  // 先標記為正在提前完成，避免錯誤處理覆蓋狀態
                                  setTasks(prev => prev.map(t =>
                                    t.id === task.id
                                      ? { ...t, isEarlyCompleting: true }
                                      : t
                                  ));

                                  // 先取消後續下載，避免繼續下載
                                  if (task.abortController) {
                                    task.abortController.abort();
                                  }

                                  // 等待一小段時間，確保 abort 信號已傳播，錯誤處理已檢查 isEarlyCompleting
                                  await new Promise(resolve => setTimeout(resolve, 100));

                                  // 然後完成流（這會調用 onProgress 更新進度為 100%）
                                  await task.completeStreamRef.current();

                                  // 最後更新狀態為完成（使用函數式更新確保獲取最新狀態）
                                  setTasks(prev => prev.map(t => {
                                    if (t.id === task.id) {
                                      return {
                                        ...t,
                                        status: 'completed' as const,
                                        progress: 100,
                                        current: t.total,
                                        abortController: undefined,
                                        // 保留 isEarlyCompleting 標記一段時間，防止錯誤處理覆蓋狀態
                                        // 稍後通過 setTimeout 清除
                                      };
                                    }
                                    return t;
                                  }));

                                  // 延遲清除 isEarlyCompleting 標記，確保錯誤處理已經檢查過
                                  setTimeout(() => {
                                    setTasks(prev => prev.map(t =>
                                      t.id === task.id && t.status === 'completed'
                                        ? { ...t, isEarlyCompleting: false }
                                        : t
                                    ));
                                  }, 1000);
                                } catch (error) {
                                  // eslint-disable-next-line no-console
                                  console.error('完成下載失敗:', error);
                                  Swal.fire({
                                    icon: 'error',
                                    title: '完成下載失敗',
                                    text: error instanceof Error ? error.message : String(error),
                                  });
                                  // 清除標記並恢復狀態
                                  setTasks(prev => prev.map(t =>
                                    t.id === task.id
                                      ? { ...t, isEarlyCompleting: false }
                                      : t
                                  ));
                                }
                              } else {
                                Swal.fire({
                                  icon: 'error',
                                  title: '無法完成下載',
                                  text: '流未初始化',
                                });
                              }
                              return;
                            }

                            // 普通模式：合並並下載
                            mergingTaskIds.current.add(task.id);
                            try {
                              const { mergeSegments, triggerDownload } = await import('@/lib/m3u8-downloader');
                              const { transmuxTSToMP4 } = await import('@/lib/mp4-transmuxer');
                              const { startSegment, endSegment } = task.parsedTask.rangeDownload;
                              const downloadType = task.config?.downloadType || 'TS';
                              // 按順序收集已下載片段
                              const segments: ArrayBuffer[] = [];
                              for (let i = startSegment - 1; i < endSegment; i++) {
                                const segment = task.parsedTask.downloadedSegments?.get(i);
                                if (segment) segments.push(segment);
                              }
                              if (segments.length === 0) {
                                alert('沒有可合並的片段數據！');
                                return;
                              }
                              let blob: Blob;
                              if (downloadType === 'MP4') {
                                const totalDuration = task.parsedTask.durationSecond || 0;
                                const totalSegments = endSegment - startSegment + 1;
                                const rangeDuration = (totalDuration / totalSegments) * segments.length;
                                blob = transmuxTSToMP4(segments, rangeDuration);
                              } else {
                                blob = mergeSegments(segments, downloadType);
                              }
                              triggerDownload(blob, task.parsedTask.title, downloadType);
                            } catch (e) {
                              alert('合並下載失敗：' + (e instanceof Error ? e.message : e));
                            } finally {
                              setTimeout(() => mergingTaskIds.current.delete(task.id), 2000);
                            }
                          }}
                          className="p-2 hover:bg-green-100 dark:hover:bg-green-900/30 text-green-600 dark:text-green-400 rounded-lg transition-colors"
                          title={task.config?.streamMode === 'disabled' ? '立即合並已下載片段並導出文件' : '立即保存（將跳過後續片段下載，直接完成下載）'}
                        >
                          <Download className="h-4 w-4" />
                        </button>
                      )}
                      {/* 查看片段按鈕 */}
                      {task.parsedTask && (
                        <button
                          onClick={() => setViewingSegmentsTaskId(task.id)}
                          className="p-2 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
                          title="查看片段"
                        >
                          <List className="h-4 w-4" />
                        </button>
                      )}
                      {task.status === 'downloading' ? (
                        <button
                          onClick={() => pauseTask(task.id)}
                          className="p-2 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
                          title="暫停"
                        >
                          <Pause className="h-4 w-4" />
                        </button>
                      ) : (task.status === 'waiting' || task.status === 'paused' || task.status === 'error') ? (
                        <button
                          onClick={() => resumeTask(task.id)}
                          className="p-2 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
                          title="開始/繼續"
                        >
                          <Play className="h-4 w-4" />
                        </button>
                      ) : null}
                      <button
                        onClick={() => deleteTask(task.id)}
                        className="p-2 hover:bg-red-100 dark:hover:bg-red-900/30 text-red-600 dark:text-red-400 rounded-lg transition-colors"
                        title="刪除"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {/* 進度條 */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-700 dark:text-gray-300">
                        {task.status === 'completed' ? '已完成' :
                          task.status === 'merging' ? '合並中' :
                            task.status === 'downloading' ? '下載中' :
                              task.status === 'error' ? '下載失敗' :
                                task.status === 'paused' ? '已暫停' : '等待中'}
                      </span>
                      <span className="text-gray-600 dark:text-gray-400">
                        {Math.floor(task.progress)}%
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-2">
                      <div
                        className="bg-green-600 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${task.progress}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                      <span>
                        {task.current} / {task.total} 片段
                      </span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* 添加下載彈窗 */}
      <AddDownloadModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onAddTask={(config) => {
          addTaskFromConfig(config);
          setShowAddModal(false);
        }}
        initialUrl=""
        initialTitle=""
      />

      {/* 片段查看器 */}
      {viewingSegmentsTaskId && (() => {
        const task = tasks.find(t => t.id === viewingSegmentsTaskId);
        return task?.parsedTask ? (
          <SegmentViewer
            task={task.parsedTask}
            isOpen={true}
            onClose={() => setViewingSegmentsTaskId(null)}
            taskExists={() => tasks.some(t => t.id === viewingSegmentsTaskId)}
            concurrency={task.config?.concurrency || 6}
            streamMode={task.config?.streamMode || 'disabled'}
            onSegmentRetry={(_index) => {
              // 重試成功後更新任務進度
              setTasks(prev => prev.map(t => {
                if (t.id === viewingSegmentsTaskId && t.parsedTask) {
                  const { startSegment, endSegment } = t.parsedTask.rangeDownload;

                  // 只檢查下載範圍內的片段狀態
                  let successCount = 0;
                  let errorCount = 0;
                  for (let i = startSegment - 1; i < endSegment; i++) {
                    if (t.parsedTask.finishList[i].status === 'success') {
                      successCount++;
                    } else if (t.parsedTask.finishList[i].status === 'error') {
                      errorCount++;
                    }
                  }

                  const totalInRange = endSegment - startSegment + 1;
                  const progress = (successCount / totalInRange) * 100;

                  // 檢查範圍內是否所有片段都成功了
                  if (errorCount === 0 && successCount === totalInRange) {
                    // 防止重復觸發
                    if (mergingTaskIds.current.has(viewingSegmentsTaskId)) {
                      // eslint-disable-next-line no-console
                      console.log(`⚠️ 任務 ${viewingSegmentsTaskId} 已經在合並中，跳過`);
                      return t;
                    }

                    mergingTaskIds.current.add(viewingSegmentsTaskId);

                    // 所有片段都成功，自動觸發合並保存
                    // parsedTask.downloadedSegments 已經在 SegmentViewer 中更新了
                    // eslint-disable-next-line no-console
                    console.log(`✅ 範圍內所有 ${totalInRange} 個片段重試成功！downloadedSegments 有 ${t.parsedTask.downloadedSegments?.size || 0} 個片段，自動觸發合並保存...`);

                    // 保存 taskId（閉包中的值）
                    const taskIdToResume = viewingSegmentsTaskId;

                    // 先關閉片段查看器
                    setViewingSegmentsTaskId(null);

                    // 清除 abortController，允許 resumeTask 觸發合並
                    setTasks(prevTasks => prevTasks.map(task =>
                      task.id === taskIdToResume
                        ? { ...task, abortController: undefined }
                        : task
                    ));

                    // 然後觸發合並保存
                    setTimeout(() => {
                      resumeTask(taskIdToResume);
                      // 3秒後清除標記，允許下次觸發
                      setTimeout(() => {
                        mergingTaskIds.current.delete(taskIdToResume);
                      }, 3000);
                    }, 500);
                  }

                  // 注意：這裡返回的是淺拷貝，parsedTask 引用不變，所以 downloadedSegments 的修改會保留
                  return {
                    ...t,
                    current: successCount,
                    progress,
                  };
                }
                return t;
              }));
            }}
          />
        ) : null;
      })()}
    </>
  );
};

export default DownloadManager;
