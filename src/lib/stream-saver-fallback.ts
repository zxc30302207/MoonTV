/* eslint-disable @typescript-eslint/no-explicit-any, no-console */
/**
 * StreamSaver 降級方案
 * 在不支持 Service Worker 的環境中使用
 * 優先使用 File System Access API，其次使用 Blob 降級
 */

/**
 * 檢查是否支持 File System Access API
 */
export function supportsFileSystemAccess(): boolean {
  return (
    typeof window !== 'undefined' &&
    'showSaveFilePicker' in window &&
    typeof (window as any).showSaveFilePicker === 'function'
  );
}

/**
 * 使用 File System Access API 創建寫入流
 */
export async function createFileSystemWriteStream(
  filename: string,
  _fileSize?: number
): Promise<WritableStream<Uint8Array> | null> {
  if (!supportsFileSystemAccess()) {
    return null;
  }

  try {
    // 根據文件名後綴動態設置 accept 類型，避免移動端總是 .m3u8
    let acceptExt = '.ts';
    if (filename.toLowerCase().endsWith('.mp4')) acceptExt = '.mp4';
    else if (filename.toLowerCase().endsWith('.ts')) acceptExt = '.ts';
    const options: any = {
      suggestedName: filename,
      types: [
        {
          description: 'Video files',
          accept: {
            'video/*': [acceptExt],
          },
        },
      ],
    };

    // 請求用戶選擇保存位置
    const fileHandle = await (window as any).showSaveFilePicker(options);
    const writable = await fileHandle.createWritable();

    return new WritableStream({
      async write(chunk: Uint8Array) {
        await writable.write(chunk);
      },
      async close() {
        await writable.close();
      },
      async abort(reason: any) {
        await writable.abort(reason);
      },
    });
  } catch (err: any) {
    if (err.name === 'AbortError') {
      console.log('用戶取消了文件保存');
      return null;
    }
    console.error('File System Access API 錯誤:', err);
    return null;
  }
}

/**
 * Blob 降級方案 - 將數據收集到內存後一次性下載
 * 注意：大文件可能導致內存溢出
 */
export function createBlobWriteStream(
  filename: string,
  maxSize: number = 500 * 1024 * 1024 // 默認最大 500MB
): WritableStream<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalSize = 0;

  return new WritableStream({
    write(chunk: Uint8Array) {
      totalSize += chunk.length;

      if (totalSize > maxSize) {
        throw new Error(
          `文件大小超過限制 (${Math.round(maxSize / 1024 / 1024)}MB)，` +
          '請使用支持 Service Worker 或 File System Access API 的瀏覽器'
        );
      }

      chunks.push(chunk);
    },
    close() {
      // 創建 Blob 並觸發下載
      const blob = new Blob(chunks as BlobPart[], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();

      // 清理
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);

      // 清空內存
      chunks.length = 0;
    },
    abort(reason: any) {
      console.error('下載被中止:', reason);
      chunks.length = 0;
    },
  });
}

/**
 * 智能選擇最佳的寫入流方案
 */
export async function createAdaptiveWriteStream(
  filename: string,
  estimatedSize?: number
): Promise<WritableStream<Uint8Array>> {
  // 1. 優先嘗試 File System Access API（Chrome/Edge）
  if (supportsFileSystemAccess()) {
    console.log('使用 File System Access API');
    const stream = await createFileSystemWriteStream(filename, estimatedSize);
    if (stream) return stream;
  }

  // 2. 檢查 Service Worker 是否可用
  if (
    'serviceWorker' in navigator &&
    navigator.serviceWorker.controller &&
    window.isSecureContext
  ) {
    console.log('Service Worker 可用，嘗試使用流式下載');
    // 這裡返回 null，讓調用方使用原始的 stream-saver 實現
    throw new Error('USE_SERVICE_WORKER');
  }

  // 3. 降級到 Blob 方案（有大小限制）
  console.warn(
    '當前環境不支持流式下載，使用 Blob 降級方案（可能有內存限制）'
  );

  // 如果文件太大，警告用戶
  if (estimatedSize && estimatedSize > 500 * 1024 * 1024) {
    const confirmDownload = confirm(
      '文件較大，可能導致內存不足。建議使用 Chrome/Edge 瀏覽器或本地部署版本。\n\n是否繼續下載？'
    );

    if (!confirmDownload) {
      throw new Error('用戶取消下載');
    }
  }

  return createBlobWriteStream(filename);
}

/**
 * 檢測當前平臺是否支持邊下邊存
 */
export function detectStreamingCapability(): {
  supported: boolean;
  method: 'service-worker' | 'file-system-access' | 'blob' | 'none';
  limitation?: string;
} {
  // 檢測是否在雲平臺
  const isCloudPlatform =
    typeof window !== 'undefined' &&
    (window.location.hostname.includes('pages.dev') ||
      window.location.hostname.includes('.workers.dev') ||
      window.location.hostname.includes('.vercel.app') ||
      window.location.hostname.includes('.netlify.app'));

  // 1. File System Access API
  if (supportsFileSystemAccess()) {
    return {
      supported: true,
      method: 'file-system-access',
    };
  }

  // 2. Service Worker
  if (
    'serviceWorker' in navigator &&
    window.isSecureContext &&
    !isCloudPlatform
  ) {
    return {
      supported: true,
      method: 'service-worker',
    };
  }

  // 3. Blob 降級
  return {
    supported: true,
    method: 'blob',
    limitation: '文件大小限制約 500MB，不支持超大文件',
  };
}
