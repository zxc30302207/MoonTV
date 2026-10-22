import { NextRequest, NextResponse } from 'next/server';

import { getVerifiedAuthInfo } from '@/lib/auth-server';
import { getConfig } from '@/lib/config';
import { getStorage } from '@/lib/db';

export const runtime = 'nodejs';

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
    const body = await request.json();

    const authInfo = await getVerifiedAuthInfo(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const username = authInfo.username;

    const {
      SiteName,
      Announcement,
      SearchDownstreamMaxPage,
      SiteInterfaceCacheTime,
      DoubanProxyType,
      DoubanProxy,
      DoubanImageProxyType,
      DoubanImageProxy,
      BangumiProxy,
      BangumiImageProxy,
      DisableYellowFilter,
      DanmakuApiBaseUrl,
      TVBoxEnabled,
      TVBoxPassword,
      PlaybackSaveInterval,
    } = body as {
      SiteName: string;
      Announcement: string;
      SearchDownstreamMaxPage: number;
      SiteInterfaceCacheTime: number;
      DoubanProxyType: string;
      DoubanProxy: string;
      DoubanImageProxyType: string;
      DoubanImageProxy: string;
      BangumiProxy?: string;
      BangumiImageProxy?: string;
      DisableYellowFilter: boolean;
      DanmakuApiBaseUrl?: string;
      TVBoxEnabled?: boolean;
      TVBoxPassword?: string;
      PlaybackSaveInterval?: number;
    };

    // 參數校驗
    if (
      typeof SiteName !== 'string' ||
      typeof Announcement !== 'string' ||
      typeof SearchDownstreamMaxPage !== 'number' ||
      typeof SiteInterfaceCacheTime !== 'number' ||
      typeof DoubanProxyType !== 'string' ||
      typeof DoubanProxy !== 'string' ||
      typeof DoubanImageProxyType !== 'string' ||
      typeof DoubanImageProxy !== 'string' ||
      (BangumiProxy !== undefined && typeof BangumiProxy !== 'string') ||
      (BangumiImageProxy !== undefined &&
        typeof BangumiImageProxy !== 'string') ||
      typeof DisableYellowFilter !== 'boolean' ||
      (DanmakuApiBaseUrl !== undefined &&
        typeof DanmakuApiBaseUrl !== 'string') ||
      (TVBoxEnabled !== undefined && typeof TVBoxEnabled !== 'boolean') ||
      (TVBoxPassword !== undefined && typeof TVBoxPassword !== 'string') ||
      (PlaybackSaveInterval !== undefined &&
        (typeof PlaybackSaveInterval !== 'number' ||
          !Number.isFinite(PlaybackSaveInterval) ||
          PlaybackSaveInterval < 1 ||
          PlaybackSaveInterval > 3600))
    ) {
      return NextResponse.json({ error: '參數格式錯誤' }, { status: 400 });
    }

    const adminConfig = await getConfig();
    const storage = getStorage();

    // 權限校驗
    if (username !== process.env.USERNAME) {
      // 管理員
      const user = adminConfig.UserConfig.Users.find(
        (u) => u.username === username
      );
      if (!user || user.role !== 'admin' || user.banned) {
        return NextResponse.json({ error: '權限不足' }, { status: 401 });
      }
    }

    // 更新緩存中的站點設置
    adminConfig.SiteConfig = {
      ...adminConfig.SiteConfig,
      SiteName,
      Announcement,
      SearchDownstreamMaxPage,
      SiteInterfaceCacheTime,
      DoubanProxyType,
      DoubanProxy,
      DoubanImageProxyType,
      DoubanImageProxy,
      BangumiProxy: BangumiProxy || '',
      BangumiImageProxy: BangumiImageProxy || '',
      DisableYellowFilter,
      DanmakuApiBaseUrl:
        DanmakuApiBaseUrl ?? adminConfig.SiteConfig.DanmakuApiBaseUrl,
      TVBoxEnabled: TVBoxEnabled ?? adminConfig.SiteConfig.TVBoxEnabled,
      TVBoxPassword: TVBoxPassword ?? adminConfig.SiteConfig.TVBoxPassword,
      PlaybackSaveInterval:
        PlaybackSaveInterval ?? adminConfig.SiteConfig.PlaybackSaveInterval,
    };

    // 同步更新 ConfigFile 中的 cache_time
    try {
      const configFileData = JSON.parse(adminConfig.ConfigFile);
      configFileData.cache_time = SiteInterfaceCacheTime;
      adminConfig.ConfigFile = JSON.stringify(configFileData);
    } catch (e) {
      /* ignore malformed config json */
    }

    // 寫入數據庫
    if (storage && typeof storage.setAdminConfig === 'function') {
      await storage.setAdminConfig(adminConfig);
    }

    return NextResponse.json(
      { ok: true },
      {
        headers: {
          'Cache-Control': 'no-store', // 不緩存結果
        },
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: '更新站點配置失敗',
      },
      { status: 500 }
    );
  }
}
