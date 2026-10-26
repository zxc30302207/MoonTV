import { randomUUID } from 'crypto';

import type { ImportUserData } from '@/app/api/admin/data_migration/validation';

import type { AdminConfig } from './admin.types';
import { normalizePasswordForStorage } from './password';

type Row = { key: string; value: unknown };
const fields = {
  pr: 'playRecords',
  fav: 'favorites',
  following: 'followings',
  skip: 'skipConfigs',
} as const;

export function snapshotToBackup(rows: Row[]): {
  adminConfig: AdminConfig;
  userData: Record<string, ImportUserData>;
  extraRows: Row[];
} {
  const config = rows.find((row) => row.key === 'admin:config');
  if (!config) throw new Error('備份缺少管理員設定');
  const userData: Record<string, ImportUserData> = Object.create(null);
  const extraRows: Row[] = [];
  for (const row of rows) {
    if (row.key === 'admin:config') continue;
    const match =
      /^u:([^:]+):(pwd|sh|today-updated|pr|fav|following|skip)(?::(.*))?$/.exec(
        row.key
      );
    if (!match) {
      extraRows.push(row);
      continue;
    }
    const [, username, namespace, key] = match;
    if (
      (['pwd', 'sh', 'today-updated'].includes(namespace) &&
        key !== undefined) ||
      (namespace in fields && !key)
    )
      throw new Error('資料庫存在不合法資料鍵，請先修復後再備份');
    const user = (userData[username] ||= {});
    if (namespace === 'pwd') {
      const credential = row.value as
        | string
        | { hash: string; revokedBefore: number };
      user.password =
        typeof credential === 'string' ? credential : credential.hash;
      user.sessionNotBefore =
        typeof credential === 'string' ? 0 : credential.revokedBefore;
    } else if (namespace === 'sh') user.searchHistory = row.value as string[];
    else if (namespace === 'today-updated')
      user.todayUpdated = row.value as ImportUserData['todayUpdated'];
    else if (key) {
      const field = fields[namespace as keyof typeof fields];
      const records = (user[field] ||= Object.create(null)) as Record<
        string,
        unknown
      >;
      records[key] = row.value;
    } else extraRows.push(row);
  }
  return { adminConfig: config.value as AdminConfig, userData, extraRows };
}

export async function backupToRows(
  data: ReturnType<typeof snapshotToBackup>,
  restoredAt = Date.now()
): Promise<Row[]> {
  const rows: Row[] = [{ key: 'admin:config', value: data.adminConfig }];
  for (const [username, user] of Object.entries(data.userData)) {
    const prefix = `u:${username}:`;
    // Restoring credentials must not revive old stolen sessions. This is an
    // explicit documented restore effect, not a deploy-time account reset.
    if (user.password)
      rows.push({
        key: `${prefix}pwd`,
        value: {
          hash: await normalizePasswordForStorage(user.password),
          revokedBefore: Math.max(restoredAt, user.sessionNotBefore || 0),
          generation: randomUUID(),
        },
      });
    for (const [namespace, field] of Object.entries(fields)) {
      for (const [key, value] of Object.entries(
        user[field as (typeof fields)[keyof typeof fields]] || {}
      )) {
        rows.push({ key: `${prefix}${namespace}:${key}`, value });
      }
    }
    if (user.searchHistory)
      rows.push({ key: `${prefix}sh`, value: user.searchHistory });
    if (user.todayUpdated)
      rows.push({ key: `${prefix}today-updated`, value: user.todayUpdated });
  }
  const keys = new Set(rows.map((row) => row.key));
  for (const row of data.extraRows || []) {
    if (
      keys.has(row.key) ||
      /^u:[^:]+:(pwd|sh|today-updated|pr|fav|following|skip)(:|$)/.test(row.key)
    )
      throw new Error('備份資料鍵重複或格式不合法');
    keys.add(row.key);
    rows.push(row);
  }
  return rows;
}
