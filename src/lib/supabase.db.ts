import { createClient, SupabaseClient } from '@supabase/supabase-js';

import { AdminConfig } from './admin.types';
import { normalizePasswordForStorage, verifyPassword } from './password';
import { Favorite, IStorage, PlayRecord, SkipConfig } from './types';

const SEARCH_HISTORY_LIMIT = 20;
const DEFAULT_TABLE = 'moontv_kv';

type KvRow = {
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
        error instanceof Error ? error.message : String(error || '');
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
    await withRetry(async () => {
      const { error } = await this.client.from(tableName()).upsert(
        {
          key,
          value,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'key' }
      );

      if (error) throw error;
    });
  }

  private async deleteKey(key: string): Promise<void> {
    await withRetry(async () => {
      const { error } = await this.client
        .from(tableName())
        .delete()
        .eq('key', key);
      if (error) throw error;
    });
  }

  private async listByPrefix<T>(prefix: string): Promise<Record<string, T>> {
    const rows = await withRetry(async () => {
      const { data, error } = await this.client
        .from(tableName())
        .select('key,value')
        .like('key', `${prefix}%`);

      if (error) throw error;
      return (data || []) as KvRow[];
    });

    const result: Record<string, T> = {};
    rows.forEach((row) => {
      result[row.key.replace(prefix, '')] = row.value as T;
    });
    return result;
  }

  private async deleteByPrefix(prefix: string): Promise<void> {
    await withRetry(async () => {
      const { error } = await this.client
        .from(tableName())
        .delete()
        .like('key', `${prefix}%`);

      if (error) throw error;
    });
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
    if (record.title) {
      const prefix = `u:${userName}:pr:`;
      const records = await this.listByPrefix<PlayRecord>(prefix);

      await Promise.all(
        Object.entries(records)
          .filter(
            ([recordKey, existing]) =>
              recordKey !== key && existing.title === record.title
          )
          .map(([recordKey]) => this.deleteKey(`${prefix}${recordKey}`))
      );
    }

    await this.setValue(this.prKey(userName, key), record);
  }

  async getAllPlayRecords(
    userName: string
  ): Promise<Record<string, PlayRecord>> {
    return this.listByPrefix<PlayRecord>(`u:${userName}:pr:`);
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
    return this.listByPrefix<Favorite>(`u:${userName}:fav:`);
  }

  async deleteFavorite(userName: string, key: string): Promise<void> {
    await this.deleteKey(this.favKey(userName, key));
  }

  private userPwdKey(user: string) {
    return `u:${user}:pwd`;
  }

  async registerUser(userName: string, password: string): Promise<void> {
    const hashedPassword = await normalizePasswordForStorage(password);
    await this.setValue(this.userPwdKey(userName), hashedPassword);
  }

  async verifyUser(userName: string, password: string): Promise<boolean> {
    const stored = await this.getValue<string>(this.userPwdKey(userName));
    if (stored === null) return false;

    const { valid, upgradedHash } = await verifyPassword(
      password,
      ensureString(stored)
    );

    if (valid && upgradedHash) {
      await this.setValue(this.userPwdKey(userName), upgradedHash);
    }

    return valid;
  }

  async getUserPassword(userName: string): Promise<string | null> {
    const stored = await this.getValue<string>(this.userPwdKey(userName));
    return stored === null ? null : ensureString(stored);
  }

  async checkUserExist(userName: string): Promise<boolean> {
    return (await this.getValue<string>(this.userPwdKey(userName))) !== null;
  }

  async changePassword(userName: string, newPassword: string): Promise<void> {
    const hashedPassword = await normalizePasswordForStorage(newPassword);
    await this.setValue(this.userPwdKey(userName), hashedPassword);
  }

  async deleteUser(userName: string): Promise<void> {
    await this.deleteKey(this.userPwdKey(userName));
    await this.deleteKey(this.shKey(userName));
    await this.deleteByPrefix(`u:${userName}:pr:`);
    await this.deleteByPrefix(`u:${userName}:fav:`);
    await this.deleteByPrefix(`u:${userName}:skip:`);
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
    const history = (await this.getSearchHistory(userName)).filter(
      (item) => item !== normalized
    );

    history.unshift(normalized);
    await this.setValue(
      this.shKey(userName),
      history.slice(0, SEARCH_HISTORY_LIMIT)
    );
  }

  async deleteSearchHistory(userName: string, keyword?: string): Promise<void> {
    if (!keyword) {
      await this.deleteKey(this.shKey(userName));
      return;
    }

    const normalized = ensureString(keyword);
    const history = (await this.getSearchHistory(userName)).filter(
      (item) => item !== normalized
    );
    await this.setValue(this.shKey(userName), history);
  }

  async getAllUsers(): Promise<string[]> {
    const rows = await withRetry(async () => {
      const { data, error } = await this.client
        .from(tableName())
        .select('key')
        .like('key', 'u:%:pwd');

      if (error) throw error;
      return (data || []) as Pick<KvRow, 'key'>[];
    });

    return rows
      .map((row) => row.key.match(/^u:(.+?):pwd$/)?.[1])
      .filter((user): user is string => Boolean(user));
  }

  private adminConfigKey() {
    return 'admin:config';
  }

  async getAdminConfig(): Promise<AdminConfig | null> {
    return this.getValue<AdminConfig>(this.adminConfigKey());
  }

  async setAdminConfig(config: AdminConfig): Promise<void> {
    await this.setValue(this.adminConfigKey(), config);
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

  async clearAllData(): Promise<void> {
    await withRetry(async () => {
      const { error } = await this.client
        .from(tableName())
        .delete()
        .neq('key', '');

      if (error) throw error;
    });
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
