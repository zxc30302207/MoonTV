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

export function getClientIp(request: { headers: Headers }): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0]?.trim() || 'unknown';
  }
  return (
    request.headers.get('x-real-ip') ||
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('true-client-ip') ||
    'unknown'
  );
}

export function rateLimit(
  key: string,
  config: RateLimitConfig
): RateLimitResult {
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
    'RateLimit-Limit': result.limit.toString(),
    'RateLimit-Remaining': result.remaining.toString(),
    'RateLimit-Reset': Math.ceil(result.resetAt / 1000).toString(),
    ...(result.allowed ? {} : { 'Retry-After': retryAfter.toString() }),
  };
}
