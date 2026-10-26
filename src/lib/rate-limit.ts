import { createHmac } from 'crypto';
import { isIP } from 'net';

type Bucket = {
  count: number;
  resetAt: number;
};

export type RateLimitConfig = {
  limit: number;
  windowMs: number;
  prefix?: string;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  limit: number;
  unavailable?: boolean;
};

const buckets = new Map<string, Bucket>();
const CLEANUP_INTERVAL_MS = 60_000;
let lastCleanup = 0;

function cleanupExpiredBuckets(now: number) {
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  buckets.forEach((bucket, key) => {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  });
}

// Only trust a platform-overwritten header. Self-hosted installations must
// explicitly name a header stripped/replaced by their trusted reverse proxy.
export function getClientIp(request: { headers: Headers }): string {
  const header =
    process.env.VERCEL === '1'
      ? 'x-vercel-forwarded-for'
      : process.env.RATE_LIMIT_TRUSTED_IP_HEADER;
  if (!header) return 'unknown';
  const raw = request.headers.get(header)?.trim() || '';
  if (!isIP(raw) || raw.includes('%')) return 'unknown'; // Never select a spoofable entry from a list.
  return isIP(raw) === 6
    ? new URL(`http://[${raw}]/`).hostname.slice(1, -1)
    : raw;
}

const SCOPES: Record<string, number> = {
  login: 10,
  register: 5,
  'image-proxy': 300,
  'm3u8-parse': 60,
  'm3u8-proxy': 1200,
  'm3u8-filter': 60,
};

// Supabase deployments must never fall back to a per-instance allowance.
export async function rateLimit(
  key: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  if (process.env.NEXT_PUBLIC_STORAGE_TYPE !== 'supabase') {
    return localRateLimit(key, config);
  }
  const unavailable = (): RateLimitResult => ({
    allowed: false,
    remaining: 0,
    limit: config.limit,
    resetAt: Date.now() + 30_000,
    unavailable: true,
  });
  const scope = config.prefix || '';
  const url = process.env.SUPABASE_URL;
  const secret =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  const hashKey = process.env.PASSWORD;
  if (
    !url ||
    !secret ||
    !hashKey ||
    SCOPES[scope] !== config.limit ||
    config.windowMs !== 60_000
  ) {
    return unavailable();
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const subject = createHmac('sha256', hashKey)
      .update(`moontv-rate-v1:${scope}:${key}`)
      .digest('hex');
    const response = await fetch(
      `${url.replace(/\/$/, '')}/rest/v1/rpc/moontv_consume_rate_limit`,
      {
        method: 'POST',
        headers: {
          apikey: secret,
          Authorization: `Bearer ${secret}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ p_scope: scope, p_subject_hash: subject }),
        cache: 'no-store',
        signal: controller.signal,
      }
    );
    if (!response.ok) return unavailable();
    const data = await response.json();
    if (
      typeof data?.allowed !== 'boolean' ||
      !Number.isInteger(data.remaining) ||
      data.remaining < 0 ||
      data.remaining > config.limit ||
      data.limit !== config.limit ||
      !Number.isSafeInteger(data.reset_at_ms)
    ) {
      return unavailable();
    }
    return {
      allowed: data.allowed,
      remaining: data.remaining,
      limit: data.limit,
      resetAt: data.reset_at_ms,
    };
  } catch {
    // No retry: a lost response may already have consumed a token.
    return unavailable();
  } finally {
    clearTimeout(timeout);
  }
}

function localRateLimit(key: string, config: RateLimitConfig): RateLimitResult {
  const now = Date.now();
  cleanupExpiredBuckets(now);

  const bucketKey = config.prefix ? `${config.prefix}:${key}` : key;
  const existing = buckets.get(bucketKey);

  if (!existing || existing.resetAt <= now) {
    const resetAt = now + config.windowMs;
    buckets.set(bucketKey, { count: 1, resetAt });
    return {
      allowed: true,
      remaining: Math.max(0, config.limit - 1),
      resetAt,
      limit: config.limit,
    };
  }

  existing.count += 1;
  const remaining = Math.max(0, config.limit - existing.count);
  return {
    allowed: existing.count <= config.limit,
    remaining,
    resetAt: existing.resetAt,
    limit: config.limit,
  };
}

export function getRateLimitHeaders(
  result: RateLimitResult,
  now = Date.now()
): Record<string, string> {
  const retryAfter = Math.max(0, Math.ceil((result.resetAt - now) / 1000));
  return {
    'Cache-Control': 'private, no-store',
    'RateLimit-Limit': result.limit.toString(),
    'RateLimit-Remaining': result.remaining.toString(),
    'RateLimit-Reset': Math.ceil(result.resetAt / 1000).toString(),
    ...(result.allowed ? {} : { 'Retry-After': retryAfter.toString() }),
  };
}
