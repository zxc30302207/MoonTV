/* eslint-disable @typescript-eslint/no-explicit-any,no-console */
import he from 'he';

function getDoubanImageProxyConfig(): {
  proxyType:
    | 'direct'
    | 'server'
    | 'img3'
    | 'cmliussss-cdn-tencent'
    | 'cmliussss-cdn-ali'
    | 'custom';
  proxyUrl: string;
} {
  const doubanImageProxyType =
    localStorage.getItem('doubanImageProxyType') ||
    (window as any).RUNTIME_CONFIG?.DOUBAN_IMAGE_PROXY_TYPE ||
    'server';
  const doubanImageProxy =
    localStorage.getItem('doubanImageProxyUrl') ||
    (window as any).RUNTIME_CONFIG?.DOUBAN_IMAGE_PROXY ||
    '';
  return {
    proxyType: doubanImageProxyType,
    proxyUrl: doubanImageProxy,
  };
}

/**
 * 處理圖片 URL，如果設置了圖片代理則使用代理
 */
/**
 * 處理圖片 URL：若為豆瓣域名則依設定走代理。
 */
export function processImageUrl(originalUrl: string): string {
  if (!originalUrl) return originalUrl;

  // 僅處理豆瓣圖片代理
  // 非豆瓣域名，直接返回原始連結
  if (!originalUrl.includes('doubanio.com')) {
    return originalUrl;
  }

  const { proxyType, proxyUrl } = getDoubanImageProxyConfig();
  switch (proxyType) {
    case 'server':
      return `/api/image-proxy?url=${encodeURIComponent(originalUrl)}`;
    case 'img3':
      return originalUrl.replace(/img\d+\.doubanio\.com/g, 'img3.doubanio.com');
    case 'cmliussss-cdn-tencent':
      return originalUrl.replace(
        /img\d+\.doubanio\.com/g,
        'img.doubanio.cmliussss.net'
      );
    case 'cmliussss-cdn-ali':
      return originalUrl.replace(
        /img\d+\.doubanio\.com/g,
        'img.doubanio.cmliussss.com'
      );
    case 'custom':
      return `${proxyUrl}${encodeURIComponent(originalUrl)}`;
    case 'direct':
    default:
      return originalUrl;
  }
}

/**
 * 從m3u8地址獲取視頻質量等級和網絡信息
 * @param m3u8Url m3u8播放列表的URL
 * @returns Promise<{quality: string, loadSpeed: string, pingTime: number}> 視頻質量等級和網絡信息
 */
export async function getVideoResolutionFromM3u8(m3u8Url: string): Promise<{
  quality: string; // 如720p、1080p等
  loadSpeed: string; // 自動轉換為KB/s或MB/s
  pingTime: number; // 網絡延遲（毫秒）
}> {
  try {
    const { default: Hls } = await import('hls.js');
    // 直接使用m3u8 URL作為視頻源，避免CORS問題
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.muted = true;
      video.preload = 'metadata';

      // 測量網絡延遲（ping時間） - 使用m3u8 URL而不是ts文件
      const pingStart = performance.now();
      let pingTime = 0;

      // 測量ping時間（使用m3u8 URL）
      fetch(m3u8Url, { method: 'HEAD', mode: 'no-cors' })
        .then(() => {
          pingTime = performance.now() - pingStart;
        })
        .catch(() => {
          pingTime = performance.now() - pingStart; // 記錄到失敗為止的時間
        });

      // 固定使用hls.js加載
      const hls = new Hls();

      // 設置超時處理
      const timeout = setTimeout(() => {
        hls.destroy();
        video.remove();
        reject(new Error('Timeout loading video metadata'));
      }, 4000);

      video.onerror = () => {
        clearTimeout(timeout);
        hls.destroy();
        video.remove();
        reject(new Error('Failed to load video metadata'));
      };

      let actualLoadSpeed = '未知';
      let hasSpeedCalculated = false;
      let hasMetadataLoaded = false;

      let fragmentStartTime = 0;

      // 檢查是否可以返回結果
      const checkAndResolve = () => {
        if (
          hasMetadataLoaded &&
          (hasSpeedCalculated || actualLoadSpeed !== '未知')
        ) {
          clearTimeout(timeout);
          const width = video.videoWidth;
          if (width && width > 0) {
            hls.destroy();
            video.remove();

            // 根據視頻寬度判斷視頻質量等級，使用經典分辨率的寬度作為分割點
            const quality =
              width >= 3840
                ? '4K' // 4K: 3840x2160
                : width >= 2560
                ? '2K' // 2K: 2560x1440
                : width >= 1920
                ? '1080p' // 1080p: 1920x1080
                : width >= 1280
                ? '720p' // 720p: 1280x720
                : width >= 854
                ? '480p'
                : 'SD'; // 480p: 854x480

            resolve({
              quality,
              loadSpeed: actualLoadSpeed,
              pingTime: Math.round(pingTime),
            });
          } else {
            // webkit 無法獲取尺寸，直接返回
            resolve({
              quality: '未知',
              loadSpeed: actualLoadSpeed,
              pingTime: Math.round(pingTime),
            });
          }
        }
      };

      // 監聽片段加載開始
      hls.on(Hls.Events.FRAG_LOADING, () => {
        fragmentStartTime = performance.now();
      });

      // 監聽片段加載完成，只需首個分片即可計算速度
      hls.on(Hls.Events.FRAG_LOADED, (event: any, data: any) => {
        if (
          fragmentStartTime > 0 &&
          data &&
          data.payload &&
          !hasSpeedCalculated
        ) {
          const loadTime = performance.now() - fragmentStartTime;
          const size = data.payload.byteLength || 0;

          if (loadTime > 0 && size > 0) {
            const speedKBps = size / 1024 / (loadTime / 1000);

            // 立即計算速度，無需等待更多分片
            const avgSpeedKBps = speedKBps;

            if (avgSpeedKBps >= 1024) {
              actualLoadSpeed = `${(avgSpeedKBps / 1024).toFixed(1)} MB/s`;
            } else {
              actualLoadSpeed = `${avgSpeedKBps.toFixed(1)} KB/s`;
            }
            hasSpeedCalculated = true;
            checkAndResolve(); // 嘗試返回結果
          }
        }
      });

      hls.loadSource(m3u8Url);
      hls.attachMedia(video);

      // 監聽hls.js錯誤
      hls.on(Hls.Events.ERROR, (event: any, data: any) => {
        console.error('HLS錯誤:', data);
        if (data.fatal) {
          clearTimeout(timeout);
          hls.destroy();
          video.remove();
          reject(new Error(`HLS播放失敗: ${data.type}`));
        }
      });

      // 監聽視頻元數據加載完成
      video.onloadedmetadata = () => {
        hasMetadataLoaded = true;
        checkAndResolve(); // 嘗試返回結果
      };
    });
  } catch (error) {
    throw new Error(
      `Error getting video resolution: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

export function cleanHtmlTags(text: string): string {
  if (!text) return '';

  const cleanedText = text
    .replace(/<[^>]+>/g, '\n') // 將 HTML 標簽替換為換行
    .replace(/\n+/g, '\n') // 將多個連續換行合並為一個
    .replace(/[ \t]+/g, ' ') // 將多個連續空格和製表符合並為一個空格，但保留換行符
    .replace(/^\n+|\n+$/g, '') // 去掉首尾換行
    .trim(); // 去掉首尾空格

  // 使用 he 庫解碼 HTML 實體
  return he.decode(cleanedText);
}

/**
 * 獲取配置的超時時間（秒）
 * 從 localStorage 讀取，如果不存在或無效則返回默認值3秒
 */
export function getRequestTimeout(): number {
  if (typeof window === 'undefined') {
    return 30; // 服務器端返回默認值
  }

  try {
    const savedTimeout = localStorage.getItem('requestTimeout');
    if (savedTimeout) {
      const timeoutSeconds = parseInt(savedTimeout, 10);
      if (
        !isNaN(timeoutSeconds) &&
        timeoutSeconds >= 1 &&
        timeoutSeconds <= 60
      ) {
        return timeoutSeconds;
      }
    }
  } catch (error) {
    console.warn('Failed to read timeout from localStorage:', error);
  }

  return 30; // 默認30秒
}
