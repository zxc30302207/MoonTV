import { generateSignature, safeEqual } from './auth-crypto';

export type TVBoxTokenPayload = {
  timestamp: number;
  sessionVersion?: string;
  username: string;
};

const DEFAULT_TVBOX_TOKEN_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

function getTvboxSecret(): string {
  return process.env.PASSWORD || '';
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function getTvboxTokenMaxAgeMs(): number {
  const days = Number(process.env.TVBOX_TOKEN_MAX_AGE_DAYS);
  if (!Number.isFinite(days) || days <= 0) {
    return DEFAULT_TVBOX_TOKEN_MAX_AGE_MS;
  }
  return days * 24 * 60 * 60 * 1000;
}

export async function createTVBoxToken(
  username: string,
  now = Date.now(),
  sessionVersion?: string
): Promise<string> {
  const payload: TVBoxTokenPayload = {
    timestamp: now,
    username,
    ...(sessionVersion ? { sessionVersion } : {}),
  };
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signature = await generateSignature(
    `tvbox:${encodedPayload}`,
    getTvboxSecret()
  );
  return `${encodedPayload}.${signature}`;
}

export async function verifyTVBoxTokenPayload(
  token: string,
  now = Date.now()
): Promise<TVBoxTokenPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encodedPayload, signature] = parts;
  if (!encodedPayload || !signature || !getTvboxSecret()) return null;

  const expected = await generateSignature(
    `tvbox:${encodedPayload}`,
    getTvboxSecret()
  );
  if (!safeEqual(signature, expected)) return null;

  try {
    const payload = JSON.parse(
      decodeBase64Url(encodedPayload)
    ) as Partial<TVBoxTokenPayload>;
    if (
      typeof payload.username !== 'string' ||
      !payload.username ||
      typeof payload.timestamp !== 'number' ||
      !Number.isFinite(payload.timestamp)
    ) {
      return null;
    }
    if (
      payload.timestamp > now + 60_000 ||
      now - payload.timestamp > getTvboxTokenMaxAgeMs()
    ) {
      return null;
    }
    if (
      payload.sessionVersion !== undefined &&
      (typeof payload.sessionVersion !== 'string' ||
        !/^[a-f0-9]{64}$/.test(payload.sessionVersion))
    )
      return null;
    return {
      username: payload.username,
      timestamp: payload.timestamp,
      ...(payload.sessionVersion
        ? { sessionVersion: payload.sessionVersion }
        : {}),
    };
  } catch {
    return null;
  }
}

// Keep the username-only helper compatible for callers that do not authorize
// sessions. Routes must validate the payload timestamp and active membership.
export async function verifyTVBoxToken(
  token: string,
  now = Date.now()
): Promise<string | null> {
  return (await verifyTVBoxTokenPayload(token, now))?.username ?? null;
}
