import { NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import type { DoubanItem, DoubanResult } from '@/lib/types';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const allowQueryPassword = process.env.TVBOX_ALLOW_QUERY_PASSWORD === 'true';
  const inputPassword =
    request.headers.get('x-tvbox-password') ||
    (allowQueryPassword
      ? url.searchParams.get('pwd') || url.searchParams.get('password')
      : '') ||
    '';

  const adminConfig = await getConfig();
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
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

  try {
    const cfg = await getConfig();

    // 豆瓣默認分類（來源於 README 可用分類）
    const doubanDefaults = {
      movie: ['熱門', '最新', '經典', '豆瓣高分'],
      tv: ['熱門', '美劇', '英劇', '韓劇', '日劇', '國產劇', '日本動畫'],
    };

    // 用戶自定義分類（從配置獲取）
    const custom = (cfg.CustomCategories || []).map((c) => ({
      name: c.name || c.query,
      type: c.type,
      query: c.query,
    }));

    // Apple CMS 類似分類返回（參考 provide/vod 的分類結構）
    const classes: { type_id: number; type_name: string }[] = [];
    let nextId = 1;

    doubanDefaults.movie.forEach((name) => {
      classes.push({ type_id: nextId++, type_name: `電影·${name}` });
    });
    doubanDefaults.tv.forEach((name) => {
      classes.push({ type_id: nextId++, type_name: `劇集·${name}` });
    });
    custom.forEach((c) => {
      classes.push({ type_id: nextId++, type_name: `${c.name}` });
    });

    // 分頁參數：t（分類 id），pg（頁碼，默認1），wd（關鍵字）
    const tParam = Number(url.searchParams.get('t') || '');
    const wdParam = url.searchParams.get('wd') || '';
    const pgParam = Math.max(1, parseInt(url.searchParams.get('pg') || '1'));
    const pageSize = Math.max(
      1,
      Math.min(50, parseInt(url.searchParams.get('pagesize') || '20'))
    );

    if (tParam || wdParam) {
      // 重建與 classes 相同順序的選擇器映射
      const selectors: Array<{
        kind: 'movie' | 'tv';
        category?: string;
        label?: string;
      }> = [];
      doubanDefaults.movie.forEach((name) =>
        selectors.push({ kind: 'movie', category: name })
      );
      doubanDefaults.tv.forEach((name) =>
        selectors.push({ kind: 'tv', category: name })
      );
      custom.forEach((c) => selectors.push({ kind: c.type, label: c.query }));

      let kind: 'movie' | 'tv' = 'movie';
      let category = '';
      let label = '';
      let sort = '';
      if (tParam && tParam >= 1 && tParam <= selectors.length) {
        const sel = selectors[tParam - 1];
        kind = sel.kind;
        category = sel.category || '';
        label = sel.label || '';
      }
      if (wdParam) {
        label = wdParam;
      }

      const origin = url.origin;
      const qs = new URLSearchParams();
      qs.set('kind', kind);
      // 處理「熱門/最新」無數據的問題：
      // - 熱門：不傳 category/label，由後端按默認推薦返回
      // - 最新：不傳 category/label，傳 sort=time
      if (category === '最新') {
        sort = 'time';
        category = '';
        label = '';
        // 按首頁策略靠近「最新上映」：限定年份為當年
        const year = new Date().getFullYear();
        qs.set('year', String(year));
      } else if (category === '熱門') {
        category = '';
        label = '';
      }

      if (category) qs.set('category', category);
      if (label) qs.set('label', label);
      qs.set('start', String((pgParam - 1) * pageSize));
      qs.set('limit', String(pageSize));
      if (sort) qs.set('sort', sort);

      const resp = await fetch(
        `${origin}/api/douban/recommends?${qs.toString()}`
      );
      const data: DoubanResult = await resp.json();
      const list: DoubanItem[] = Array.isArray(data.list) ? data.list : [];

      const payload = {
        code: 1,
        msg: 'success',
        page: pgParam,
        pagecount: 999,
        limit: pageSize,
        total: 0,
        list: list.map((item) => ({
          vod_id: item.id,
          vod_name: item.title,
          vod_pic: item.poster,
          vod_year: item.year || '',
          vod_remarks: item.rate || '',
        })),
      };

      return NextResponse.json(payload, {
        headers: {
          'Cache-Control': 'private, no-store',
          Vary: 'x-tvbox-password',
        },
      });
    }

    // 返回分類
    return NextResponse.json(
      { code: 1, msg: 'success', class: classes, list: [] },
      {
        headers: {
          'Cache-Control': 'private, no-store',
          Vary: 'x-tvbox-password',
        },
      }
    );
  } catch (e) {
    return NextResponse.json(
      { code: 0, msg: 'error', class: [], list: [] },
      { status: 500 }
    );
  }
}
