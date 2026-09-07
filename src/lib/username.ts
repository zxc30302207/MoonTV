const USERNAME_PATTERN = /^[\p{L}\p{N}_-]{1,64}$/u;

export function normalizeUsername(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const username = value.normalize('NFKC').trim();
  return USERNAME_PATTERN.test(username) ? username : null;
}
