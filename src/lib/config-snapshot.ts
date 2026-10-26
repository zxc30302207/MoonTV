import type { AdminConfig } from './admin.types';

// Enumerable symbols survive object spreads, but are never serialized to JSON.
// Keep the exact database value even when runtime defaults are applied later.
const snapshot = Symbol.for('moontv.admin-config.snapshot');
type VersionedConfig = AdminConfig & { [snapshot]?: string | null };

export class ConfigConflictError extends Error {
  constructor() {
    super('設定已被其他請求更新，請重新載入後再試');
    this.name = 'ConfigConflictError';
  }
}

export function markConfigSnapshot(
  config: AdminConfig,
  previous: string | null
) {
  (config as VersionedConfig)[snapshot] = previous;
  return config;
}

export function getConfigSnapshot(
  config: AdminConfig
): string | null | undefined {
  return (config as VersionedConfig)[snapshot];
}

export function cloneConfigSnapshot(config: AdminConfig): AdminConfig {
  const clone = JSON.parse(JSON.stringify(config)) as AdminConfig;
  const previous = getConfigSnapshot(config);
  return previous === undefined ? clone : markConfigSnapshot(clone, previous);
}
