const CURRENT_VERSION = '4.7.0';

export enum UpdateStatus {
  HAS_UPDATE = 'has_update',
  NO_UPDATE = 'no_update',
  FETCH_FAILED = 'fetch_failed',
}

const VERSION_CHECK_URLS = [
  'https://raw.githubusercontent.com/Stardm0/MoonTV/main/VERSION.txt',
];

/** 比較上游基礎版本；本地自訂後綴不影響相容版本判斷。 */
function parseVersion(value: string): number[] | null {
  const match = value
    .trim()
    .match(
      /^v?(\d+)\.(\d+)(?:\.(\d+))?(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/i
    );
  if (!match) return null;
  const parts = [match[1], match[2], match[3] || '0'].map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

export function compareVersions(
  remoteVersion: string,
  currentVersion = CURRENT_VERSION
): UpdateStatus {
  const remote = parseVersion(remoteVersion);
  const current = parseVersion(currentVersion);
  // 網路錯誤頁或格式錯誤不得被誤認為新版。
  if (!remote || !current) return UpdateStatus.FETCH_FAILED;
  for (let index = 0; index < 3; index += 1) {
    if (remote[index] > current[index]) return UpdateStatus.HAS_UPDATE;
    if (remote[index] < current[index]) return UpdateStatus.NO_UPDATE;
  }
  return UpdateStatus.NO_UPDATE;
}

/** 每次檢查使用最新上游版本，不沿用舊部署或 HTTP 快取的通知。 */
export async function checkForUpdates(): Promise<UpdateStatus> {
  for (const url of VERSION_CHECK_URLS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(`${url}?_t=${Date.now()}`, {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) continue;
      const status = compareVersions(await response.text());
      if (status !== UpdateStatus.FETCH_FAILED) return status;
    } catch {
      // 嘗試下一個已設定來源，全部失敗時顯示無法檢查。
    } finally {
      clearTimeout(timeout);
    }
  }
  return UpdateStatus.FETCH_FAILED;
}

export { CURRENT_VERSION };
