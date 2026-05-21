#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

const DEFAULT_QUERIES = ['愛', '家', '2026'];
const DEFAULT_TIMEOUT_MS = 8000;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const AD_MARKER_PATTERN =
  /(^|[/?#&._=-])(ad|ads|adv|adver|advert|advertise|advertisement|adbreak|adinsert|adseg|commercial|doubleclick|googleads|promo|preroll|pre-roll|sponsor|vast|vmap|gg|hdgg)([/?#&._=-]|$)|廣告|广告/i;
const NON_MEDIA_SEGMENT_PATTERN = /\.(?:gif|jpe?g|png|webp)(?:[?#].*)?$/i;

const args = parseArgs(process.argv.slice(2));
const env = loadEnvFile('.env.local');
const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const configSources = Object.entries(config.api_site || {}).map(
  ([key, source]) => ({
    key,
    name: source.name,
    api: source.api,
    detail: source.detail,
    disabled: false,
    from: 'config',
  })
);
const supabaseSources = await loadSupabaseSources(env).catch(() => []);
const sources = mergeSources(configSources, supabaseSources);
const filteredSources = args.source
  ? sources.filter((source) => source.key === args.source)
  : sources;
const selectedSources = args.limit
  ? filteredSources.slice(0, args.limit)
  : filteredSources;
const queries = args.queries || DEFAULT_QUERIES;
const results = [];

for (const source of selectedSources) {
  if (source.disabled && !args.includeDisabled) {
    results.push(resultFor(source, 'skipped', 'disabled'));
    continue;
  }

  results.push(await auditSource(source, queries));
}

if (args.json) {
  console.log(JSON.stringify(results, null, 2));
} else {
  printSummary(results);
}

async function auditSource(source, queries) {
  const detail = {
    key: source.key,
    name: source.name,
    api: source.api,
    from: source.from,
    status: 'fail',
    searchOk: false,
    detailOk: false,
    playableOk: false,
    adMarkers: false,
    reason: '',
    sampleTitle: '',
    sampleUrlType: '',
  };

  try {
    const searchResult = await firstSuccessfulSearch(source, queries);
    detail.searchOk = true;
    detail.sampleTitle = searchResult.item.vod_name || '';

    const vod = await fetchJson(buildApiUrl(source.api, 'ids', searchResult.item.vod_id));
    const detailItem = Array.isArray(vod.list) ? vod.list[0] : null;
    if (!detailItem) {
      return { ...detail, reason: 'detail list empty' };
    }
    detail.detailOk = true;

    const playUrl = firstPlayableUrl(detailItem.vod_play_url);
    if (!playUrl) {
      return { ...detail, reason: 'no playable url' };
    }

    if (!/\.m3u8(?:$|[?#])/i.test(playUrl)) {
      return {
        ...detail,
        playableOk: true,
        status: 'pass',
        sampleUrlType: 'non-m3u8',
        reason: 'non-m3u8 playable url',
      };
    }

    const playlist = await fetchText(playUrl);
    if (!playlist.trimStart().startsWith('#EXTM3U')) {
      return { ...detail, reason: 'm3u8 response is not a playlist' };
    }

    const segmentUrl = firstSegmentUrl(playlist, playUrl);
    if (segmentUrl) {
      await fetchReachable(segmentUrl);
    }

    return {
      ...detail,
      playableOk: true,
      adMarkers: AD_MARKER_PATTERN.test(playlist),
      sampleUrlType: 'm3u8',
      status: 'pass',
      reason: 'ok',
    };
  } catch (error) {
    return {
      ...detail,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function firstSuccessfulSearch(source, queries) {
  let lastError = null;
  for (const query of queries) {
    try {
      const data = await fetchJson(buildApiUrl(source.api, 'search', query));
      const item = firstVodItem(data);
      if (item) return { query, item };
    } catch (error) {
      lastError = error;
    }
  }

  const data = await fetchJson(buildApiUrl(source.api, 'list', ''));
  const item = firstVodItem(data);
  if (item) return { query: '', item };

  throw lastError || new Error('search list empty');
}

function buildApiUrl(api, mode, value) {
  const separator = api.includes('?') ? '&' : '?';
  if (mode === 'search') {
    return `${api}${separator}ac=videolist&wd=${encodeURIComponent(value)}&pg=1`;
  }
  if (mode === 'list') {
    return `${api}${separator}ac=videolist&pg=1`;
  }
  return `${api}${separator}ac=videolist&ids=${encodeURIComponent(value)}`;
}

function firstVodItem(data) {
  return Array.isArray(data.list)
    ? data.list.find((entry) => entry?.vod_id && entry?.vod_name)
    : null;
}

function firstPlayableUrl(vodPlayUrl) {
  if (typeof vodPlayUrl !== 'string') return '';
  return vodPlayUrl
    .split('#')
    .map((part) => part.split('$').pop()?.trim() || '')
    .find((url) => /^https?:\/\//i.test(url));
}

function firstSegmentUrl(playlist, playlistUrl) {
  const line = playlist
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find(
      (item) =>
        item &&
        !item.startsWith('#') &&
        !AD_MARKER_PATTERN.test(decodeURIComponentSafe(item)) &&
        !NON_MEDIA_SEGMENT_PATTERN.test(item)
    );
  if (!line || /\.m3u8(?:$|[?#])/i.test(line)) return '';
  return new URL(line, playlistUrl).toString();
}

function decodeURIComponentSafe(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function fetchJson(url) {
  const response = await fetchReachable(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
  });
  return response.json();
}

async function fetchText(url) {
  const response = await fetchReachable(url, {
    headers: {
      Accept: '*/*',
      'User-Agent': USER_AGENT,
    },
  });
  return response.text();
}

async function fetchReachable(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(args.timeout || DEFAULT_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${url}`);
  }
  return response;
}

async function loadSupabaseSources(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return [];
  const { createClient } = await import('@supabase/supabase-js');
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client
    .from(env.SUPABASE_KV_TABLE || 'moontv_kv')
    .select('value')
    .eq('key', 'admin:config')
    .maybeSingle();
  if (error || !data?.value) return [];
  const adminConfig =
    typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
  return (adminConfig.SourceConfig || []).map((source) => ({
    key: source.key,
    name: source.name,
    api: source.api,
    detail: source.detail,
    disabled: Boolean(source.disabled),
    from: source.from || 'db',
  }));
}

function mergeSources(configSources, supabaseSources) {
  const sources = new Map();
  for (const source of configSources) sources.set(source.key, source);
  for (const source of supabaseSources) sources.set(source.key, source);
  return Array.from(sources.values()).sort((a, b) =>
    a.key.localeCompare(b.key)
  );
}

function resultFor(source, status, reason) {
  return {
    key: source.key,
    name: source.name,
    api: source.api,
    from: source.from,
    status,
    searchOk: false,
    detailOk: false,
    playableOk: false,
    adMarkers: false,
    reason,
    sampleTitle: '',
    sampleUrlType: '',
  };
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.match(/^\s*([^#=]+)=(.*)$/))
      .filter(Boolean)
      .map((match) => [
        match[1].trim(),
        match[2].trim().replace(/^['"]|['"]$/g, ''),
      ])
  );
}

function parseArgs(argv) {
  const parsed = {
    includeDisabled: false,
    json: false,
    limit: 0,
    queries: null,
    source: '',
    timeout: DEFAULT_TIMEOUT_MS,
  };
  for (const arg of argv) {
    if (arg === '--include-disabled') parsed.includeDisabled = true;
    else if (arg === '--json') parsed.json = true;
    else if (arg.startsWith('--limit=')) {
      parsed.limit = Number.parseInt(arg.slice('--limit='.length), 10) || 0;
    } else if (arg.startsWith('--queries=')) {
      parsed.queries = arg
        .slice('--queries='.length)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    } else if (arg.startsWith('--source=')) {
      parsed.source = arg.slice('--source='.length).trim();
    } else if (arg.startsWith('--timeout=')) {
      parsed.timeout =
        Number.parseInt(arg.slice('--timeout='.length), 10) ||
        DEFAULT_TIMEOUT_MS;
    }
  }
  return parsed;
}

function printSummary(results) {
  const counts = results.reduce(
    (acc, result) => {
      acc[result.status] = (acc[result.status] || 0) + 1;
      return acc;
    },
    { pass: 0, fail: 0, skipped: 0 }
  );
  console.log(
    `Audited ${results.length} sources: ${counts.pass} pass, ${counts.fail} fail, ${counts.skipped} skipped`
  );
  console.table(
    results.map((result) => ({
      key: result.key,
      status: result.status,
      search: result.searchOk,
      detail: result.detailOk,
      playable: result.playableOk,
      ads: result.adMarkers,
      reason: result.reason,
    }))
  );
}
