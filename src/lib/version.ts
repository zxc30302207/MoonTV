/* eslint-disable no-console */

'use client';

const CURRENT_VERSION = '3.8.2';

// 版本檢查結果枚舉
export enum UpdateStatus {
  HAS_UPDATE = 'has_update', // 有新版本
  NO_UPDATE = 'no_update', // 無新版本
  FETCH_FAILED = 'fetch_failed', // 獲取失敗
}

// 遠程版本檢查URL配置
const VERSION_CHECK_URLS = [
  'https://raw.githubusercontent.com/Stardm0/MoonTV/main/VERSION.txt',
];

/**
 * 檢查是否有新版本可用
 * @returns Promise<UpdateStatus> - 返回版本檢查狀態
 */
export async function checkForUpdates(): Promise<UpdateStatus> {
  try {
    // 嘗試從主要URL獲取版本信息
    const primaryVersion = await fetchVersionFromUrl(VERSION_CHECK_URLS[0]);
    if (primaryVersion) {
      return compareVersions(primaryVersion);
    }

    // 如果主要URL失敗，嘗試備用URL
    const backupVersion = await fetchVersionFromUrl(VERSION_CHECK_URLS[1]);
    if (backupVersion) {
      return compareVersions(backupVersion);
    }

    // 如果兩個URL都失敗，返回獲取失敗狀態
    return UpdateStatus.FETCH_FAILED;
  } catch (error) {
    console.error('版本檢查失敗:', error);
    return UpdateStatus.FETCH_FAILED;
  }
}

/**
 * 從指定URL獲取版本信息
 * @param url - 版本信息URL
 * @returns Promise<string | null> - 版本字符串或null
 */
async function fetchVersionFromUrl(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5秒超時

    // 添加時間戳參數以避免緩存
    const timestamp = Date.now();
    const urlWithTimestamp = url.includes('?')
      ? `${url}&_t=${timestamp}`
      : `${url}?_t=${timestamp}`;

    const response = await fetch(urlWithTimestamp, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'Content-Type': 'text/plain',
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const version = await response.text();
    return version.trim();
  } catch (error) {
    console.warn(`從 ${url} 獲取版本信息失敗:`, error);
    return null;
  }
}

/**
 * 比較版本號
 * @param remoteVersion - 遠程版本號
 * @returns UpdateStatus - 返回版本比較結果
 */
function compareVersions(remoteVersion: string): UpdateStatus {
  // 如果版本號相同，無需更新
  if (remoteVersion === CURRENT_VERSION) {
    return UpdateStatus.NO_UPDATE;
  }

  try {
    // 解析版本號為數字數組 [X, Y, Z]
    const currentParts = CURRENT_VERSION.split('.').map((part) => {
      const num = parseInt(part, 10);
      if (isNaN(num) || num < 0) {
        throw new Error(`無效的版本號格式: ${CURRENT_VERSION}`);
      }
      return num;
    });

    const remoteParts = remoteVersion.split('.').map((part) => {
      const num = parseInt(part, 10);
      if (isNaN(num) || num < 0) {
        throw new Error(`無效的版本號格式: ${remoteVersion}`);
      }
      return num;
    });

    // 標準化版本號到3個部分
    const normalizeVersion = (parts: number[]) => {
      if (parts.length >= 3) {
        return parts.slice(0, 3); // 取前三個元素
      } else {
        // 不足3個的部分補0
        const normalized = [...parts];
        while (normalized.length < 3) {
          normalized.push(0);
        }
        return normalized;
      }
    };

    const normalizedCurrent = normalizeVersion(currentParts);
    const normalizedRemote = normalizeVersion(remoteParts);

    // 逐級比較版本號
    for (let i = 0; i < 3; i++) {
      if (normalizedRemote[i] > normalizedCurrent[i]) {
        return UpdateStatus.HAS_UPDATE;
      } else if (normalizedRemote[i] < normalizedCurrent[i]) {
        return UpdateStatus.NO_UPDATE;
      }
      // 如果當前級別相等，繼續比較下一級
    }

    // 所有級別都相等，無需更新
    return UpdateStatus.NO_UPDATE;
  } catch (error) {
    console.error('版本號比較失敗:', error);
    // 如果版本號格式無效，回退到字符串比較
    return remoteVersion !== CURRENT_VERSION
      ? UpdateStatus.HAS_UPDATE
      : UpdateStatus.NO_UPDATE;
  }
}

// 導出當前版本號供其他地方使用
export { compareVersions, CURRENT_VERSION };
