const HASH_PREFIX = 'pbkdf2$';
const DEFAULT_ITERATIONS = 120000;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

type ParsedHash = {
  iterations: number;
  salt: Uint8Array;
  hash: Uint8Array;
};

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return Uint8Array.from(Buffer.from(base64, 'base64'));
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function parsePasswordHash(value: string): ParsedHash | null {
  if (!value.startsWith(HASH_PREFIX)) return null;
  const parts = value.split('$');
  if (parts.length !== 4) return null;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 10000) return null;
  try {
    const salt = base64ToBytes(parts[2]);
    const hash = base64ToBytes(parts[3]);
    if (salt.length < 8 || hash.length < 16) return null;
    return { iterations, salt, hash };
  } catch {
    return null;
  }
}

function encodePasswordHash(
  iterations: number,
  salt: Uint8Array,
  hash: Uint8Array
): string {
  return `${HASH_PREFIX}${iterations}$${bytesToBase64(salt)}$${bytesToBase64(
    hash
  )}`;
}

async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations: number
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    KEY_LENGTH * 8
  );

  return new Uint8Array(derivedBits);
}

function safeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

export function isPasswordHash(value: string): boolean {
  return parsePasswordHash(value) !== null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const derived = await deriveKey(password, salt, DEFAULT_ITERATIONS);
  return encodePasswordHash(DEFAULT_ITERATIONS, salt, derived);
}

export async function normalizePasswordForStorage(
  password: string
): Promise<string> {
  return parsePasswordHash(password) ? password : hashPassword(password);
}

export async function verifyPassword(
  password: string,
  stored: string
): Promise<{ valid: boolean; upgradedHash?: string }> {
  const parsed = parsePasswordHash(stored);
  if (!parsed) {
    if (password !== stored) return { valid: false };
    return { valid: true, upgradedHash: await hashPassword(password) };
  }

  const derived = await deriveKey(password, parsed.salt, parsed.iterations);
  if (!safeEqualBytes(derived, parsed.hash)) {
    return { valid: false };
  }

  if (parsed.iterations < DEFAULT_ITERATIONS) {
    return { valid: true, upgradedHash: await hashPassword(password) };
  }

  return { valid: true };
}
