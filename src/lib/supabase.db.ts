import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createHmac, randomUUID } from 'crypto';

import { AdminConfig } from './admin.types';
import {
  ConfigConflictError,
  getConfigSnapshot,
  markConfigSnapshot,
} from './config-snapshot';
import {
  MutationNamespace,
  NamespaceConflictError,
  NamespaceMutation,
  NamespaceMutationResult,
  NamespaceSnapshot,
  NamespaceVersion,
} from './mutation-protocol';
import { hashPassword, verifyPassword } from './password';
import {
  Favorite,
  Following,
  IStorage,
  PlayRecord,
  SkipConfig,
  TodayUpdatedRecord,
} from './types';

const SEARCH_HISTORY_LIMIT = 20;
const DEFAULT_TABLE = 'moontv_kv';

type Credential =
  | string
  | { hash: string; revokedBefore: number; generation?: string };
function credentialHash(value: Credential): string {
  return typeof value === 'string' ? value : value.hash;
}

export type KvRow = {
  key: string;
  value: unknown;
};

function tableName() {
  return process.env.SUPABASE_KV_TABLE || DEFAULT_TABLE;
}

function ensureString(value: unknown): string {
  return String(value);
}

function ensureStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      return await operation();
    } catch (error: unknown) {
      const isLastAttempt = attempt === maxRetries - 1;
      const message =
        error instanceof Error
          ? error.message
          : error && typeof error === 'object' && 'message' in error
          ? String(error.message)
          : String(error || '');
      const isTransient =
        message.includes('fetch failed') ||
        message.includes('network') ||
        message.includes('timeout') ||
        message.includes('ECONNRESET') ||
        message.includes('ETIMEDOUT') ||
        message.includes('ENOTFOUND');

      if (!isTransient || isLastAttempt) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }

  throw new Error('Supabase operation failed after retries');
}

export class SupabaseStorage implements IStorage {
  private client: SupabaseClient;

  constructor() {
    this.client = getSupabaseClient();
  }

  private readonly namespaceSnapshots = new WeakMap<
    object,
    {
      user: string;
      namespace: MutationNamespace;
      key: string;
      cursor: { version: NamespaceVersion };
    }
  >();

  async readNamespace(
    userName: string,
    namespace: MutationNamespace
  ): Promise<NamespaceSnapshot> {
    const { data, error } = await this.client.rpc('moontv_read_namespace', {
      p_table: tableName(),
      p_username: userName,
      p_namespace: namespace,
      p_is_owner: userName === process.env.USERNAME,
    });
    if (error) throw this.namespaceError(error);
    const snapshot = data as NamespaceSnapshot;
    const cursor = { version: snapshot.version };
    for (const [key, value] of Object.entries(snapshot.data)) {
      if (value && typeof value === 'object')
        this.namespaceSnapshots.set(value, {
          user: userName,
          namespace,
          key,
          cursor,
        });
    }
    return snapshot;
  }

  async mutateNamespace(
    userName: string,
    namespace: MutationNamespace,
    mutation: NamespaceMutation
  ): Promise<NamespaceMutationResult> {
    // Never refresh the expected version or retry with a new operation id here.
    // A transport error is an unknown commit outcome, not proof of rollback.
    const { data, error } = await this.client.rpc('moontv_mutate_namespace', {
      p_table: tableName(),
      p_username: userName,
      p_namespace: namespace,
      p_is_owner: userName === process.env.USERNAME,
      p_epoch: mutation.version.epoch,
      p_revision: mutation.version.revision,
      p_operation: mutation.operationId,
      p_action: mutation.action,
      p_key: mutation.key ?? null,
      p_value: mutation.value ?? null,
    });
    if (error) throw this.namespaceError(error);
    return data as NamespaceMutationResult;
  }

  private namespaceError(error: { code?: string; message: string }): Error {
    if (error.code === '40001') return new NamespaceConflictError();
    if (error.code === 'PGRST202' || error.code === '55000')
      return Object.assign(new Error('資料庫寫入協定尚未啟用，請稍後再試'), {
        code: 'NAMESPACE_UNAVAILABLE',
      });
    return Object.assign(new Error(error.message), { code: error.code });
  }

  private async updateNamespaceRecordIfUnchanged(
    userName: string,
    namespace: MutationNamespace,
    key: string,
    previous: object,
    next: unknown
  ): Promise<boolean> {
    const snapshot = this.namespaceSnapshots.get(previous);
    // Only snapshot-aligned reads confer a version, not a freshly fetched version
    // attached to stale data. This also prevents delete/recreate ABA updates.
    if (
      !snapshot ||
      snapshot.user !== userName ||
      snapshot.namespace !== namespace ||
      snapshot.key !== key
    )
      return false;
    try {
      const result = await this.mutateNamespace(userName, namespace, {
        version: snapshot.cursor.version,
        operationId: randomUUID(),
        action: 'set',
        key,
        value: next,
      });
      // Records from the same snapshot may be refreshed sequentially by cron.
      snapshot.cursor.version = result.version;
      this.namespaceSnapshots.delete(previous);
      return true;
    } catch (error) {
      if (error instanceof NamespaceConflictError) return false;
      throw error;
    }
  }

  private async getValue<T>(key: string): Promise<T | null> {
    const row = await withRetry(async () => {
      const { data, error } = await this.client
        .from(tableName())
        .select('value')
        .eq('key', key)
        .maybeSingle();

      if (error) throw error;
      return data as Pick<KvRow, 'value'> | null;
    });

    return row ? (row.value as T) : null;
  }

  private async setValue(key: string, value: unknown): Promise<void> {
    const { error } = await this.client.from(tableName()).upsert(
      {
        key,
        value,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key' }
    );

    if (error) throw error;
  }

  private async deleteKey(key: string): Promise<void> {
    const { error } = await this.client
      .from(tableName())
      .delete()
      .eq('key', key);
    if (error) throw error;
  }

  private async listByPrefix<T>(prefix: string): Promise<Record<string, T>> {
    const result: Record<string, T> = {};
    const pageSize = 500;
    for (let offset = 0; ; offset += pageSize) {
      const rows = await withRetry(async () => {
        const { data, error } = await this.client
          .from(tableName())
          .select('key,value')
          .like('key', `${prefix.replace(/[\\%_]/g, '\\$&')}%`)
          .order('key')
          .range(offset, offset + pageSize - 1);
        if (error) throw error;
        return (data || []) as KvRow[];
      });
      rows.forEach((row) => {
        if (row.key.startsWith(prefix)) {
          result[row.key.slice(prefix.length)] = row.value as T;
        }
      });
      if (rows.length < pageSize) break;
    }
    return result;
  }

  private async deleteByPrefix(prefix: string): Promise<void> {
    const { error } = await this.client
      .from(tableName())
      .delete()
      .like('key', `${prefix.replace(/[\\%_]/g, '\\$&')}%`);

    if (error) throw error;
  }

  private prKey(user: string, key: string) {
    return `u:${user}:pr:${key}`;
  }

  async getPlayRecord(
    userName: string,
    key: string
  ): Promise<PlayRecord | null> {
    return this.getValue<PlayRecord>(this.prKey(userName, key));
  }

  async setPlayRecord(
    userName: string,
    key: string,
    record: PlayRecord
  ): Promise<void> {
    // A title is not an identity (remakes and unrelated works can share it).
    // Update exactly this source/id; never scan/delete another work on progress saves.
    await this.setValue(this.prKey(userName, key), record);
  }

  async updatePlayRecordIfUnchanged(
    userName: string,
    key: string,
    previous: PlayRecord,
    next: PlayRecord
  ): Promise<boolean> {
    return this.updateNamespaceRecordIfUnchanged(
      userName,
      'pr',
      key,
      previous,
      next
    );
  }

  async updateFavoriteIfUnchanged(
    userName: string,
    key: string,
    previous: Favorite,
    next: Favorite
  ): Promise<boolean> {
    return this.updateNamespaceRecordIfUnchanged(
      userName,
      'fav',
      key,
      previous,
      next
    );
  }

  async getAllPlayRecords(
    userName: string
  ): Promise<Record<string, PlayRecord>> {
    return (await this.readNamespace(userName, 'pr')).data as Record<
      string,
      PlayRecord
    >;
  }

  async deletePlayRecord(userName: string, key: string): Promise<void> {
    await this.deleteKey(this.prKey(userName, key));
  }

  private favKey(user: string, key: string) {
    return `u:${user}:fav:${key}`;
  }

  async getFavorite(userName: string, key: string): Promise<Favorite | null> {
    return this.getValue<Favorite>(this.favKey(userName, key));
  }

  async setFavorite(
    userName: string,
    key: string,
    favorite: Favorite
  ): Promise<void> {
    await this.setValue(this.favKey(userName, key), favorite);
  }

  async getAllFavorites(userName: string): Promise<Record<string, Favorite>> {
    return (await this.readNamespace(userName, 'fav')).data as Record<
      string,
      Favorite
    >;
  }

  async deleteFavorite(userName: string, key: string): Promise<void> {
    await this.deleteKey(this.favKey(userName, key));
  }

  private followingKey(user: string, key: string) {
    return `u:${user}:following:${key}`;
  }

  async getFollowing(userName: string, key: string): Promise<Following | null> {
    return (
      (
        (await this.readNamespace(userName, 'followings')).data as Record<
          string,
          Following
        >
      )[key] ?? null
    );
  }

  async setFollowing(
    userName: string,
    key: string,
    following: Following
  ): Promise<void> {
    await this.setValue(this.followingKey(userName, key), following);
  }

  async updateFollowingIfUnchanged(
    userName: string,
    key: string,
    previous: Following,
    following: Following
  ): Promise<boolean> {
    return this.updateNamespaceRecordIfUnchanged(
      userName,
      'followings',
      key,
      previous,
      following
    );
  }

  async getAllFollowings(userName: string): Promise<Record<string, Following>> {
    return (await this.readNamespace(userName, 'followings')).data as Record<
      string,
      Following
    >;
  }

  async deleteFollowing(userName: string, key: string): Promise<void> {
    await this.deleteKey(this.followingKey(userName, key));
  }

  async getTodayUpdated(userName: string): Promise<TodayUpdatedRecord | null> {
    return this.getValue<TodayUpdatedRecord>(`u:${userName}:today-updated`);
  }

  async setTodayUpdated(
    userName: string,
    record: TodayUpdatedRecord
  ): Promise<void> {
    await this.setValue(`u:${userName}:today-updated`, record);
  }

  private userPwdKey(user: string) {
    return `u:${user}:pwd`;
  }

  async registerUser(userName: string, password: string): Promise<void> {
    const hashedPassword = await hashPassword(password);
    // The key constraint, not a prior existence check, arbitrates concurrent
    // registrations. Never replace another registration's password.
    const { error } = await this.client.from(tableName()).insert({
      key: this.userPwdKey(userName),
      value: { hash: hashedPassword, revokedBefore: Date.now() },
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
  }

  private sessionVersion(
    userName: string,
    credential: Exclude<Credential, string>
  ): string {
    return createHmac('sha256', process.env.PASSWORD || '')
      .update(
        JSON.stringify([userName, credential.hash, credential.generation || ''])
      )
      .digest('hex');
  }

  async verifyUserSession(
    userName: string,
    password: string
  ): Promise<{ valid: boolean; sessionVersion?: string }> {
    const stored = await this.getValue<Credential>(this.userPwdKey(userName));
    if (stored === null) return { valid: false };
    const { valid, upgradedHash } = await verifyPassword(
      password,
      credentialHash(stored)
    );
    if (!valid) return { valid: false };
    const verified = upgradedHash
      ? typeof stored === 'string'
        ? upgradedHash
        : { ...stored, hash: upgradedHash }
      : stored;
    if (
      upgradedHash &&
      !(await this.compareAndSetValue(
        this.userPwdKey(userName),
        stored,
        verified
      ))
    )
      return { valid: false };
    return {
      valid: true,
      ...(typeof verified === 'string'
        ? {}
        : { sessionVersion: this.sessionVersion(userName, verified) }),
    };
  }

  async verifyUser(userName: string, password: string): Promise<boolean> {
    return (await this.verifyUserSession(userName, password)).valid;
  }

  async getUserSessionState(
    userName: string
  ): Promise<{ exists: boolean; notBefore: number; sessionVersion?: string }> {
    const stored = await this.getValue<Credential>(this.userPwdKey(userName));
    if (stored === null) return { exists: false, notBefore: Infinity };
    return typeof stored === 'string'
      ? { exists: true, notBefore: 0 }
      : {
          exists: true,
          notBefore: stored.revokedBefore,
          sessionVersion: this.sessionVersion(userName, stored),
        };
  }

  async getUserPassword(userName: string): Promise<string | null> {
    const stored = await this.getValue<Credential>(this.userPwdKey(userName));
    return stored === null ? null : credentialHash(stored);
  }

  async getUserSessionNotBefore(userName: string): Promise<number> {
    const stored = await this.getValue<Credential>(this.userPwdKey(userName));
    if (stored === null) return Number.POSITIVE_INFINITY;
    return typeof stored === 'string' ? 0 : stored.revokedBefore;
  }

  async registerUserAtomic(
    userName: string,
    password: string,
    previous: AdminConfig,
    next: AdminConfig
  ): Promise<string> {
    const hash = await hashPassword(password);
    const snapshot = getConfigSnapshot(previous);
    if (!snapshot) throw new ConfigConflictError();
    const { data, error } = await this.client.rpc('moontv_register_user', {
      p_table: tableName(),
      p_expected_config: JSON.parse(snapshot),
      p_next_config: next,
      p_username: userName,
      p_password_hash: hash,
    });
    if (error) throw this.rpcError(error);
    if (!data) throw new ConfigConflictError();
    markConfigSnapshot(next, JSON.stringify(next));
    return this.sessionVersion(userName, { hash, revokedBefore: 0 });
  }

  private rpcError(error: { code?: string; message: string }): Error {
    return Object.assign(
      new Error(
        error.code === 'PGRST202'
          ? '資料庫需要先安裝 002_atomic_kv 遷移；尚未修改任何資料'
          : error.message
      ),
      { code: error.code }
    );
  }

  async acquireLease(
    name: string,
    ttlMs: number
  ): Promise<(() => Promise<void>) | null> {
    const key = `system:lease:${name}`;
    const previous = await this.getValue<{ expires: number; nonce: string }>(
      key
    );
    if (previous && previous.expires > Date.now()) return null;
    const lease = { expires: Date.now() + ttlMs, nonce: crypto.randomUUID() };
    if (!(await this.compareAndSetValue(key, previous, lease))) return null;
    return async () => {
      const { error } = await this.client
        .from(tableName())
        .delete()
        .eq('key', key)
        .eq('value', JSON.stringify(lease));
      if (error) throw error;
    };
  }

  async snapshotAllData(): Promise<KvRow[]> {
    const { data, error } = await this.client.rpc('moontv_snapshot_kv', {
      p_table: tableName(),
    });
    if (error) throw this.rpcError(error);
    return data as KvRow[];
  }

  async restoreAllData(rows: KvRow[]): Promise<void> {
    const { error } = await this.client.rpc('moontv_restore_kv', {
      p_table: tableName(),
      p_rows: rows,
    });
    if (error) throw this.rpcError(error);
  }

  async checkUserExist(userName: string): Promise<boolean> {
    return (await this.getValue<string>(this.userPwdKey(userName))) !== null;
  }

  async changePassword(
    userName: string,
    newPassword: string,
    currentPassword?: string
  ): Promise<void> {
    const key = this.userPwdKey(userName);
    const previous = await this.getValue<Credential>(key);
    if (previous === null) throw new Error('帳號不存在');
    if (
      currentPassword !== undefined &&
      !(await verifyPassword(currentPassword, credentialHash(previous))).valid
    )
      throw new Error('目前密碼錯誤');
    const hashedPassword = await hashPassword(newPassword);
    if (
      !(await this.compareAndSetValue(key, previous, {
        hash: hashedPassword,
        revokedBefore: Math.max(
          Date.now(),
          typeof previous === 'string' ? 0 : previous.revokedBefore
        ),
      }))
    )
      throw new ConfigConflictError();
  }

  async getUserCredentialSnapshot(userName: string): Promise<unknown> {
    return this.getValue<Credential>(this.userPwdKey(userName));
  }

  async deleteUserAtomic(
    userName: string,
    previous: AdminConfig,
    expectedCredential: unknown
  ): Promise<void> {
    if (!getConfigSnapshot(previous)) throw new ConfigConflictError();
    const raw = JSON.parse(
      getConfigSnapshot(previous) as string
    ) as AdminConfig;
    const next = {
      ...raw,
      UserConfig: {
        ...raw.UserConfig,
        Users: raw.UserConfig.Users.filter(
          (user) => user.username !== userName
        ),
      },
    };
    const { data, error } = await this.client.rpc('moontv_delete_user', {
      p_table: tableName(),
      p_expected_config: raw,
      p_next_config: next,
      p_username: userName,
      p_expected_credential: expectedCredential,
    });
    if (error) {
      if (error.code === 'PGRST202')
        throw new Error(
          '資料庫需要先安裝 004_atomic_user_delete 遷移；尚未刪除資料'
        );
      throw this.rpcError(error);
    }
    if (!data) throw new ConfigConflictError();
  }

  async deleteUser(_userName: string): Promise<void> {
    throw new Error('帳號刪除必須使用已授權的交易式操作');
  }

  private shKey(user: string) {
    return `u:${user}:sh`;
  }

  async getSearchHistory(userName: string): Promise<string[]> {
    return ensureStringArray(
      await this.getValue<string[]>(this.shKey(userName))
    );
  }

  async addSearchHistory(userName: string, keyword: string): Promise<void> {
    const normalized = ensureString(keyword);
    await this.mutateSearchHistory(userName, (history) =>
      [normalized, ...history.filter((item) => item !== normalized)].slice(
        0,
        SEARCH_HISTORY_LIMIT
      )
    );
  }

  async deleteSearchHistory(userName: string, keyword?: string): Promise<void> {
    await this.mutateSearchHistory(userName, (history) =>
      keyword ? history.filter((item) => item !== ensureString(keyword)) : []
    );
  }

  async getAllUsers(): Promise<string[]> {
    const users: string[] = [];
    const pageSize = 500;
    for (let offset = 0; ; offset += pageSize) {
      const rows = await withRetry(async () => {
        const { data, error } = await this.client
          .from(tableName())
          .select('key')
          .like('key', 'u:%:pwd')
          .order('key')
          .range(offset, offset + pageSize - 1);
        if (error) throw error;
        return (data || []) as Pick<KvRow, 'key'>[];
      });
      users.push(
        ...rows
          .map((row) => row.key.match(/^u:(.+?):pwd$/)?.[1])
          .filter((user): user is string => Boolean(user))
      );
      if (rows.length < pageSize) break;
    }
    return users;
  }

  private adminConfigKey() {
    return 'admin:config';
  }

  async getAdminConfig(): Promise<AdminConfig | null> {
    const config = await this.getValue<AdminConfig>(this.adminConfigKey());
    return config ? markConfigSnapshot(config, JSON.stringify(config)) : null;
  }

  async setAdminConfig(config: AdminConfig): Promise<void> {
    const snapshot = getConfigSnapshot(config);
    // Unversioned writes are initialization only, never blind replacements.
    const previous =
      snapshot === undefined
        ? null
        : snapshot === null
        ? null
        : JSON.parse(snapshot);
    if (
      !(await this.compareAndSetValue(this.adminConfigKey(), previous, config))
    ) {
      throw new ConfigConflictError();
    }
    markConfigSnapshot(config, JSON.stringify(config));
  }

  private async compareAndSetValue(
    key: string,
    previous: unknown,
    value: unknown
  ): Promise<boolean> {
    if (previous === null) {
      const { error } = await this.client
        .from(tableName())
        .insert({ key, value, updated_at: new Date().toISOString() });
      if (error?.code === '23505') return false;
      if (error) throw error;
      return true;
    }
    const { data, error } = await this.client
      .from(tableName())
      .update({ value, updated_at: new Date().toISOString() })
      .eq('key', key)
      .eq('value', JSON.stringify(previous))
      .select('key');
    if (error) throw error;
    return Boolean(data?.length);
  }

  private async mutateSearchHistory(
    userName: string,
    mutate: (history: string[]) => string[]
  ): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const previous = await this.getValue<string[]>(this.shKey(userName));
      if (
        await this.compareAndSetValue(
          this.shKey(userName),
          previous,
          mutate(ensureStringArray(previous))
        )
      )
        return;
    }
    throw new Error('搜尋紀錄已變更，請重試');
  }

  async appendRegisteredUser(userName: string): Promise<AdminConfig> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const previous = await this.getAdminConfig();
      const allowRegister =
        previous &&
        (typeof previous.UserConfig.AllowRegister === 'boolean'
          ? previous.UserConfig.AllowRegister
          : process.env.NEXT_PUBLIC_ENABLE_REGISTER === 'true');
      if (!previous || !allowRegister)
        throw new Error('Registration is closed');
      if (
        previous.UserConfig.Users.some((entry) => entry.username === userName)
      )
        throw new Error('User already configured');
      const next: AdminConfig = {
        ...previous,
        UserConfig: {
          ...previous.UserConfig,
          Users: [
            ...previous.UserConfig.Users,
            { username: userName, role: 'user' },
          ],
        },
      };
      const { data, error } = await this.client
        .from(tableName())
        .update({ value: next, updated_at: new Date().toISOString() })
        .eq('key', this.adminConfigKey())
        .eq('value', JSON.stringify(previous))
        .select('key');
      if (error) throw error;
      if (data?.length) return next;
    }
    throw new Error(
      'Concurrent admin configuration updates; retry registration'
    );
  }

  async updateUserLastOnline(
    userName: string,
    timestamp: number
  ): Promise<boolean> {
    // Cross-instance optimistic concurrency: heartbeat writes must not restore
    // a stale ban, role, source list, or any other administrative setting.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const previous = await this.getAdminConfig();
      const user = previous?.UserConfig.Users.find(
        (entry) => entry.username === userName
      );
      if (!previous || !user || user.banned) return false;
      const next = {
        ...previous,
        UserConfig: {
          ...previous.UserConfig,
          Users: previous.UserConfig.Users.map((entry) =>
            entry.username === userName
              ? {
                  ...entry,
                  lastOnline: Math.max(entry.lastOnline || 0, timestamp),
                }
              : entry
          ),
        },
      };
      const { data, error } = await this.client
        .from(tableName())
        .update({ value: next, updated_at: new Date().toISOString() })
        .eq('key', this.adminConfigKey())
        .eq('value', JSON.stringify(previous))
        .select('key');
      if (error) throw error;
      if (data?.length) return true;
    }
    throw new Error('Concurrent admin configuration updates; retry heartbeat');
  }

  private skipConfigKey(user: string, source: string, id: string) {
    return `u:${user}:skip:${source}+${id}`;
  }

  async getSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<SkipConfig | null> {
    return this.getValue<SkipConfig>(this.skipConfigKey(userName, source, id));
  }

  async setSkipConfig(
    userName: string,
    source: string,
    id: string,
    config: SkipConfig
  ): Promise<void> {
    await this.setValue(this.skipConfigKey(userName, source, id), config);
  }

  async deleteSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<void> {
    await this.deleteKey(this.skipConfigKey(userName, source, id));
  }

  async getAllSkipConfigs(
    userName: string
  ): Promise<Record<string, SkipConfig>> {
    return this.listByPrefix<SkipConfig>(`u:${userName}:skip:`);
  }

  // Preserve every backup row, including repeated titles, with bounded upsert batches.
  private async importValues<T>(
    prefix: string,
    entries: Array<[string, T]>,
    onProgress?: (done: number, total: number) => void
  ): Promise<void> {
    const batchSize = 100;
    for (let index = 0; index < entries.length; index += batchSize) {
      const batch = entries
        .slice(index, index + batchSize)
        .map(([key, value]) => ({
          key: `${prefix}${key}`,
          value,
          updated_at: new Date().toISOString(),
        }));
      await withRetry(async () => {
        const { error } = await this.client
          .from(tableName())
          .upsert(batch, { onConflict: 'key' });
        if (error) throw error;
      });
      onProgress?.(Math.min(index + batchSize, entries.length), entries.length);
    }
  }

  async batchImportPlayRecords(
    userName: string,
    entries: Array<[string, PlayRecord]>,
    onProgress?: (done: number, total: number) => void
  ): Promise<void> {
    await this.importValues(`u:${userName}:pr:`, entries, onProgress);
  }

  async batchImportFavorites(
    userName: string,
    entries: Array<[string, Favorite]>,
    onProgress?: (done: number, total: number) => void
  ): Promise<void> {
    await this.importValues(`u:${userName}:fav:`, entries, onProgress);
  }

  async batchImportFollowings(
    userName: string,
    entries: Array<[string, Following]>,
    onProgress?: (done: number, total: number) => void
  ): Promise<void> {
    await this.importValues(`u:${userName}:following:`, entries, onProgress);
  }

  async batchImportSkipConfigs(
    userName: string,
    entries: Array<[string, SkipConfig]>,
    onProgress?: (done: number, total: number) => void
  ): Promise<void> {
    await this.importValues(`u:${userName}:skip:`, entries, onProgress);
  }

  async batchImportSearchHistory(
    userName: string,
    keywords: string[],
    onProgress?: (done: number, total: number) => void
  ): Promise<void> {
    await this.setValue(
      this.shKey(userName),
      Array.from(new Set(keywords)).slice(0, SEARCH_HISTORY_LIMIT)
    );
    onProgress?.(keywords.length, keywords.length);
  }

  async batchImportTodayUpdated(
    userName: string,
    record: TodayUpdatedRecord
  ): Promise<void> {
    await this.setTodayUpdated(userName, record);
  }

  async clearAllData(): Promise<void> {
    throw new Error('資料取代必須使用已授權的交易式還原操作');
  }
}

function getSupabaseClient(): SupabaseClient {
  const globalKey = Symbol.for('__MOONTV_SUPABASE_CLIENT__');
  const supabaseGlobal = globalThis as typeof globalThis & {
    [key: symbol]: SupabaseClient | undefined;
  };
  let client = supabaseGlobal[globalKey];

  if (!client) {
    const url = process.env.SUPABASE_URL;
    const serviceRoleKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

    if (!url || !serviceRoleKey) {
      throw new Error(
        'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY env variables must be set'
      );
    }

    client = createClient(url, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    supabaseGlobal[globalKey] = client;
  }

  return client;
}
