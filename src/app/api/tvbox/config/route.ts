import { NextResponse } from 'next/server';

import { getAvailableApiSites, getConfig } from '@/lib/config';

export const runtime = 'nodejs';

/**
 * TVBox 配置接口
 * 參考常見 TVBox JSON 結構，最小可用字段：sites
 * 未來可擴展 parses、lives、ads 等
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const allowQueryPassword =
      process.env.TVBOX_ALLOW_QUERY_PASSWORD === 'true';
    const inputPassword =
      request.headers.get('x-tvbox-password') ||
      (allowQueryPassword
        ? url.searchParams.get('pwd') || url.searchParams.get('password')
        : '') ||
      '';
    const un = url.searchParams.get('un') || '';

    const adminConfig = await getConfig();
    const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';

    // 本地存儲模式下 un 參數可以為空
    if (storageType !== 'localstorage' && !un.trim()) {
      return NextResponse.json({ error: '缺少參數 un' }, { status: 400 });
    }

    let username = '';
    if (un.trim()) {
      try {
        username = Buffer.from(un, 'base64').toString('utf8');
      } catch (e) {
        return NextResponse.json({ error: '參數 un 非法' }, { status: 400 });
      }
    }

    const enabled =
      storageType === 'localstorage'
        ? process.env.TVBOX_ENABLED == null
          ? true
          : String(process.env.TVBOX_ENABLED).toLowerCase() === 'true'
        : adminConfig.SiteConfig.TVBoxEnabled === true;
    const password =
      storageType === 'localstorage'
        ? process.env.PASSWORD || ''
        : adminConfig.SiteConfig.TVBoxPassword || '';

    if (!enabled) {
      return NextResponse.json({ error: 'TVBox 接口未開啟' }, { status: 403 });
    }

    if (!password || inputPassword !== password) {
      return NextResponse.json({ error: '密碼錯誤或未提供' }, { status: 401 });
    }

    const sites = await getAvailableApiSites(username || undefined);

    // 將內部 SourceConfig 映射為 TVBox 兼容的 sites
    // 常見字段：key/api/name/type/searchable/quickSearch
    const tvboxSites = sites.map((s) => ({
      key: s.key,
      api: s.api,
      name: s.name,
      type: 1,
      searchable: 1,
      quickSearch: 1,
      ext: s.detail || '',
    }));

    // 插入「豆瓣｜自定義」為第一個站點，指向分類接口
    const origin = new URL(request.url).origin;
    const doubanCustomSiteUrl = new URL(`${origin}/api/tvbox/categories`);
    if (allowQueryPassword && password) {
      doubanCustomSiteUrl.searchParams.set('pwd', password);
    }
    const doubanCustomSite = {
      key: 'douban_custom',
      api: doubanCustomSiteUrl.toString(),
      name: '豆瓣｜自定義',
      type: 1,
      searchable: 0,
      ext: '',
    };

    const payload: Record<string, unknown> = {
      sites: [doubanCustomSite, ...tvboxSites],
      parses: [],
      lives: [],
      ads: [],
    };

    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'private, no-store',
        Vary: 'x-tvbox-password',
      },
    });
  } catch (e) {
    return NextResponse.json(
      { sites: [], parses: [], lives: [], ads: [] },
      {
        status: 500,
      }
    );
  }
}
