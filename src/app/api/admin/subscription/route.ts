/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getVerifiedAuthInfo } from '@/lib/auth-server';
import { configSelfCheck, getConfig } from '@/lib/config';
import { getStorage } from '@/lib/db';
import { IStorage } from '@/lib/types';
import { assertSafeUrl, parseAllowedHosts, safeFetch } from '@/lib/url-safety';

export const runtime = 'nodejs';

// 支持的操作類型
type Action = 'update' | 'import' | 'check';

interface BaseBody {
  action?: Action;
}

// Base58 解碼函數（使用 BigInt，邊緣運行時支持）
function decodeBase58(str: string): string {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  // @ts-expect-error BigInt is supported in edge runtime
  let num = 0n;
  for (const ch of str) {
    const index = alphabet.indexOf(ch);
    if (index === -1) throw new Error('Invalid Base58 character');
    // @ts-expect-error BigInt is supported in edge runtime
    num = num * 58n + BigInt(index);
  }
  // 轉換為字節數組
  const bytes: number[] = [];
  // @ts-expect-error BigInt is supported in edge runtime
  while (num > 0n) {
    // @ts-expect-error BigInt is supported in edge runtime
    bytes.unshift(Number(num & 0xffn));
    // @ts-expect-error BigInt is supported in edge runtime
    num >>= 8n;
  }
  // 轉換為 UTF-8 字符串
  return new TextDecoder().decode(new Uint8Array(bytes));
}

// 從 URL 獲取並解析訂閱數據
function validateSubscriptionUrl(url: string): string {
  const allowedHosts = parseAllowedHosts(
    process.env.ALLOWED_SUBSCRIPTION_HOSTS || process.env.ALLOWED_PROXY_HOSTS
  );
  const safeUrl = assertSafeUrl(url, {
    allowPrivateNetworks: process.env.ALLOW_PRIVATE_NETWORKS === 'true',
    allowedHosts,
  });
  return safeUrl.toString();
}

async function fetchSubscriptionData(url: string): Promise<any> {
  const safeUrl = validateSubscriptionUrl(url);
  const allowedHosts = parseAllowedHosts(
    process.env.ALLOWED_SUBSCRIPTION_HOSTS || process.env.ALLOWED_PROXY_HOSTS
  );
  const response = await safeFetch(
    safeUrl,
    {},
    {
      allowPrivateNetworks: process.env.ALLOW_PRIVATE_NETWORKS === 'true',
      allowedHosts,
    }
  );
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  const text = await response.text();
  // 嘗試 Base58 解碼
  try {
    const decoded = decodeBase58(text);
    return JSON.parse(decoded);
  } catch (e) {
    // 如果不是 Base58，直接解析為 JSON
    return JSON.parse(text);
  }
}

// 導入數據到配置
function importSources(
  adminConfig: any,
  subscriptionData: any,
  importMode: 'overwrite' | 'merge'
) {
  // 假設 subscriptionData 是一個對象，包含 api_site 和 custom_category
  const { api_site = {} } = subscriptionData;

  if (importMode === 'overwrite') {
    // 完全覆蓋：清空現有 SourceConfig
    adminConfig.SourceConfig = [];
    // 更新 ConfigFile，將 api_site 置為空，保留其他字段
    const defaultConfig = {
      cache_time: 7200,
      api_site: {},
      custom_category: [],
    };
    const configFileObj = { ...defaultConfig };
    try {
      if (
        adminConfig.ConfigFile &&
        typeof adminConfig.ConfigFile === 'string'
      ) {
        const parsed = JSON.parse(adminConfig.ConfigFile);
        // 保留原有 cache_time 和 custom_category（如果存在）
        configFileObj.cache_time =
          parsed.cache_time ?? defaultConfig.cache_time;
        configFileObj.custom_category =
          parsed.custom_category ?? defaultConfig.custom_category;
      }
    } catch (e) {
      // 解析失敗，使用默認值
    }
    // 確保 api_site 為空對象
    configFileObj.api_site = {};
    adminConfig.ConfigFile = JSON.stringify(configFileObj);
  }

  // 合並 api_site
  const existingKeys = new Set(adminConfig.SourceConfig.map((s: any) => s.key));
  Object.entries(api_site).forEach(([key, site]: [string, any]) => {
    if (existingKeys.has(key)) {
      // 更新現有源
      const existing = adminConfig.SourceConfig.find((s: any) => s.key === key);
      if (existing) {
        existing.name = site.name;
        existing.api = site.api;
        existing.detail = site.detail;
        existing.from = 'config';
      }
    } else {
      // 添加新源
      adminConfig.SourceConfig.push({
        key,
        name: site.name,
        api: site.api,
        detail: site.detail,
        from: 'config',
        disabled: false,
      });
    }
  });
}

export async function GET(request: NextRequest) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return NextResponse.json(
      {
        error: '不支持本地存儲進行管理員配置',
      },
      { status: 400 }
    );
  }

  const authInfo = await getVerifiedAuthInfo(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const username = authInfo.username;

  try {
    const config = await getConfig();
    // 權限校驗
    if (username !== process.env.USERNAME) {
      const userEntry = config.UserConfig.Users.find(
        (u) => u.username === username
      );
      if (!userEntry || userEntry.role !== 'admin' || userEntry.banned) {
        return NextResponse.json({ error: '權限不足' }, { status: 401 });
      }
    }

    return NextResponse.json({
      subscriptionConfig: config.SubscriptionConfig || {},
    });
  } catch (error) {
    console.error('獲取訂閱配置失敗:', error);
    return NextResponse.json({ error: '獲取訂閱配置失敗' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return NextResponse.json(
      {
        error: '不支持本地存儲進行管理員配置',
      },
      { status: 400 }
    );
  }

  try {
    const body = (await request.json()) as BaseBody & Record<string, any>;
    const { action } = body;

    // 基礎校驗
    const ACTIONS: Action[] = ['update', 'import', 'check'];
    if (!action || !ACTIONS.includes(action)) {
      return NextResponse.json({ error: '參數格式錯誤' }, { status: 400 });
    }

    // 對於 update 和 import 操作需要身份驗證
    let username: string | null = null;
    if (action === 'update' || action === 'import') {
      const authInfo = await getVerifiedAuthInfo(request);
      if (!authInfo || !authInfo.username) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      username = authInfo.username;
    }

    // 獲取配置與存儲
    const adminConfig = await getConfig();
    const storage: IStorage | null = getStorage();

    // 權限與身份校驗（僅對 update 和 import）
    if (username) {
      if (username !== process.env.USERNAME) {
        const userEntry = adminConfig.UserConfig.Users.find(
          (u) => u.username === username
        );
        if (!userEntry || userEntry.role !== 'admin' || userEntry.banned) {
          return NextResponse.json({ error: '權限不足' }, { status: 401 });
        }
      }
    }

    switch (action) {
      case 'update': {
        const { subscriptionUrl, autoUpdate, updateInterval, importMode } =
          body;
        // 更新訂閱配置
        adminConfig.SubscriptionConfig = adminConfig.SubscriptionConfig || {};
        if (subscriptionUrl !== undefined) {
          try {
            adminConfig.SubscriptionConfig.subscriptionUrl =
              validateSubscriptionUrl(subscriptionUrl);
          } catch (error) {
            return NextResponse.json(
              {
                error:
                  error instanceof Error ? error.message : '訂閱地址不合法',
              },
              { status: 400 }
            );
          }
        }
        if (autoUpdate !== undefined) {
          adminConfig.SubscriptionConfig.autoUpdate = Boolean(autoUpdate);
        }
        if (updateInterval !== undefined) {
          adminConfig.SubscriptionConfig.updateInterval =
            Number(updateInterval);
        }
        if (importMode !== undefined) {
          if (importMode !== 'overwrite' && importMode !== 'merge') {
            return NextResponse.json(
              { error: 'importMode 必須是 overwrite 或 merge' },
              { status: 400 }
            );
          }
          adminConfig.SubscriptionConfig.importMode = importMode;
        }
        // 保存配置
        if (storage && typeof (storage as any).setAdminConfig === 'function') {
          await (storage as any).setAdminConfig(configSelfCheck(adminConfig));
        }
        return NextResponse.json({ success: true });
      }

      case 'import': {
        const { subscriptionUrl, importMode } = body;
        const url =
          subscriptionUrl || adminConfig.SubscriptionConfig?.subscriptionUrl;
        if (!url) {
          return NextResponse.json(
            { error: '訂閱地址未提供' },
            { status: 400 }
          );
        }
        try {
          validateSubscriptionUrl(url);
        } catch (error) {
          return NextResponse.json(
            {
              error: error instanceof Error ? error.message : '訂閱地址不合法',
            },
            { status: 400 }
          );
        }
        const mode =
          importMode || adminConfig.SubscriptionConfig?.importMode || 'merge';
        // 獲取數據
        const subscriptionData = await fetchSubscriptionData(url);
        // 導入數據
        importSources(adminConfig, subscriptionData, mode);
        // 更新最後更新時間
        adminConfig.SubscriptionConfig = adminConfig.SubscriptionConfig || {};
        adminConfig.SubscriptionConfig.lastUpdated = Math.floor(
          Date.now() / 1000
        );
        // 保存配置
        if (storage && typeof (storage as any).setAdminConfig === 'function') {
          await (storage as any).setAdminConfig(configSelfCheck(adminConfig));
        }
        return NextResponse.json({ success: true, imported: true });
      }

      case 'check': {
        const subConfig = adminConfig.SubscriptionConfig || {};
        const {
          autoUpdate = false,
          subscriptionUrl,
          lastUpdated,
          updateInterval = 86400,
        } = subConfig;
        const now = Math.floor(Date.now() / 1000);
        let shouldImport = false;
        let urlToImport = '';
        if (autoUpdate && subscriptionUrl) {
          if (!lastUpdated || now - lastUpdated > updateInterval) {
            shouldImport = true;
            urlToImport = subscriptionUrl;
          }
        }
        if (shouldImport) {
          // 執行導入
          try {
            validateSubscriptionUrl(urlToImport);
            const subscriptionData = await fetchSubscriptionData(urlToImport);
            const mode = subConfig.importMode || 'merge';
            importSources(adminConfig, subscriptionData, mode);
            adminConfig.SubscriptionConfig =
              adminConfig.SubscriptionConfig || {};
            adminConfig.SubscriptionConfig.lastUpdated = now;
            // 保存配置
            if (
              storage &&
              typeof (storage as any).setAdminConfig === 'function'
            ) {
              await (storage as any).setAdminConfig(
                configSelfCheck(adminConfig)
              );
            }
            return NextResponse.json({
              success: true,
              updated: true,
              imported: true,
            });
          } catch (error) {
            console.error('自動更新導入失敗:', error);
            return NextResponse.json(
              {
                success: false,
                updated: false,
                error: '自動更新導入失敗',
              },
              { status: 500 }
            );
          }
        } else {
          return NextResponse.json({
            success: true,
            updated: false,
            reason: '未滿足自動更新條件',
          });
        }
      }

      default:
        return NextResponse.json({ error: '未知操作' }, { status: 400 });
    }
  } catch (error) {
    console.error('訂閱操作失敗:', error);
    return NextResponse.json({ error: '訂閱操作失敗' }, { status: 500 });
  }
}
