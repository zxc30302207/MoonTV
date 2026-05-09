/* eslint-disable no-console, @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */

import { createClient, RedisClientType } from 'redis';

import { AdminConfig } from './admin.types';
import { normalizePasswordForStorage, verifyPassword } from './password';
import { Favorite, IStorage, PlayRecord, SkipConfig } from './types';

// 搜索歷史最大條數
const SEARCH_HISTORY_LIMIT = 20;

// 數據類型轉換輔助函數
function ensureString(value: any): string {
  return String(value);
}

function ensureStringArray(value: any[]): string[] {
  return value.map((item) => String(item));
}

// 連接配置接口
export interface RedisConnectionConfig {
  url: string;
  clientName: string; // 用於日誌顯示，如 "Redis" 或 "Pika"
}

// 添加Redis操作重試包裝器
function createRetryWrapper(clientName: string, getClient: () => RedisClientType) {
  return async function withRetry<T>(
    operation: () => Promise<T>,
    maxRetries = 3
  ): Promise<T> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await operation();
      } catch (err: any) {
        const isLastAttempt = i === maxRetries - 1;
        const isConnectionError =
          err.message?.includes('Connection') ||
          err.message?.includes('ECONNREFUSED') ||
          err.message?.includes('ENOTFOUND') ||
          err.code === 'ECONNRESET' ||
          err.code === 'EPIPE';

        if (isConnectionError && !isLastAttempt) {
          console.log(
            `${clientName} operation failed, retrying... (${i + 1}/${maxRetries})`
          );
          console.error('Error:', err.message);

          // 等待一段時間後重試
          await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));

          // 嘗試重新連接
          try {
            const client = getClient();
            if (!client.isOpen) {
              await client.connect();
            }
          } catch (reconnectErr) {
            console.error('Failed to reconnect:', reconnectErr);
          }

          continue;
        }

        throw err;
      }
    }

    throw new Error('Max retries exceeded');
  };
}

// 創建客戶端的工廠函數
export function createRedisClient(config: RedisConnectionConfig, globalSymbol: symbol): RedisClientType {
  let client: RedisClientType | undefined = (global as any)[globalSymbol];

  if (!client) {
    if (!config.url) {
      throw new Error(`${config.clientName}_URL env variable not set`);
    }

    // 創建客戶端配置
    const clientConfig: any = {
      url: config.url,
      socket: {
        // 重連策略：指數退避，最大30秒
        reconnectStrategy: (retries: number) => {
          console.log(`${config.clientName} reconnection attempt ${retries + 1}`);
          if (retries > 10) {
            console.error(`${config.clientName} max reconnection attempts exceeded`);
            return false; // 停止重連
          }
          return Math.min(1000 * Math.pow(2, retries), 30000); // 指數退避，最大30秒
        },
        connectTimeout: 10000, // 10秒連接超時
        // 設置no delay，減少延遲
        noDelay: true,
      },
      // 添加其他配置
      pingInterval: 30000, // 30秒ping一次，保持連接活躍
    };

    client = createClient(clientConfig);

    // 添加錯誤事件監聽
    client.on('error', (err) => {
      console.error(`${config.clientName} client error:`, err);
    });

    client.on('connect', () => {
      console.log(`${config.clientName} connected`);
    });

    client.on('reconnecting', () => {
      console.log(`${config.clientName} reconnecting...`);
    });

    client.on('ready', () => {
      console.log(`${config.clientName} ready`);
    });

    // 初始連接，帶重試機制
    const connectWithRetry = async () => {
      try {
        await client!.connect();
        console.log(`${config.clientName} connected successfully`);
      } catch (err) {
        console.error(`${config.clientName} initial connection failed:`, err);
        console.log('Will retry in 5 seconds...');
        setTimeout(connectWithRetry, 5000);
      }
    };

    connectWithRetry();

    (global as any)[globalSymbol] = client;
  }

  return client;
}

// 抽象基類，包含所有通用的Redis操作邏輯
export abstract class BaseRedisStorage implements IStorage {
  protected client: RedisClientType;
  protected withRetry: <T>(operation: () => Promise<T>, maxRetries?: number) => Promise<T>;

  constructor(config: RedisConnectionConfig, globalSymbol: symbol) {
    this.client = createRedisClient(config, globalSymbol);
    this.withRetry = createRetryWrapper(config.clientName, () => this.client);
  }

  // ---------- 播放記錄 ----------
  private prKey(user: string, key: string) {
    return `u:${user}:pr:${key}`; // u:username:pr:source+id
  }

  async getPlayRecord(
    userName: string,
    key: string
  ): Promise<PlayRecord | null> {
    const val = await this.withRetry(() =>
      this.client.get(this.prKey(userName, key))
    );
    return val ? (JSON.parse(val) as PlayRecord) : null;
  }

  async setPlayRecord(
    userName: string,
    key: string,
    record: PlayRecord
  ): Promise<void> {
    // 刪除同名的舊記錄
    if (record.title) {
      const pattern = `u:${userName}:pr:*`;
      const allKeys: string[] = await this.withRetry(() => this.client.keys(pattern));

      for (const fullKey of allKeys) {
        const val = await this.withRetry(() => this.client.get(fullKey));
        if (val) {
          const existingRecord = JSON.parse(val) as PlayRecord;
          // 如果找到同名但不是當前key的記錄，則刪除它
          if (existingRecord.title === record.title && fullKey !== this.prKey(userName, key)) {
            await this.withRetry(() => this.client.del(fullKey));
          }
        }
      }
    }
    await this.withRetry(() =>
      this.client.set(this.prKey(userName, key), JSON.stringify(record))
    );
  }

  async getAllPlayRecords(
    userName: string
  ): Promise<Record<string, PlayRecord>> {
    const pattern = `u:${userName}:pr:*`;
    const keys: string[] = await this.withRetry(() => this.client.keys(pattern));
    if (keys.length === 0) return {};
    const values = await this.withRetry(() => this.client.mGet(keys));
    const result: Record<string, PlayRecord> = {};
    keys.forEach((fullKey: string, idx: number) => {
      const raw = values[idx];
      if (raw) {
        const rec = JSON.parse(raw) as PlayRecord;
        // 截取 source+id 部分
        const keyPart = ensureString(fullKey.replace(`u:${userName}:pr:`, ''));
        result[keyPart] = rec;
      }
    });
    return result;
  }

  async deletePlayRecord(userName: string, key: string): Promise<void> {
    await this.withRetry(() => this.client.del(this.prKey(userName, key)));
  }

  // ---------- 收藏 ----------
  private favKey(user: string, key: string) {
    return `u:${user}:fav:${key}`;
  }

  async getFavorite(userName: string, key: string): Promise<Favorite | null> {
    const val = await this.withRetry(() =>
      this.client.get(this.favKey(userName, key))
    );
    return val ? (JSON.parse(val) as Favorite) : null;
  }

  async setFavorite(
    userName: string,
    key: string,
    favorite: Favorite
  ): Promise<void> {
    await this.withRetry(() =>
      this.client.set(this.favKey(userName, key), JSON.stringify(favorite))
    );
  }

  async getAllFavorites(userName: string): Promise<Record<string, Favorite>> {
    const pattern = `u:${userName}:fav:*`;
    const keys: string[] = await this.withRetry(() => this.client.keys(pattern));
    if (keys.length === 0) return {};
    const values = await this.withRetry(() => this.client.mGet(keys));
    const result: Record<string, Favorite> = {};
    keys.forEach((fullKey: string, idx: number) => {
      const raw = values[idx];
      if (raw) {
        const fav = JSON.parse(raw) as Favorite;
        const keyPart = ensureString(fullKey.replace(`u:${userName}:fav:`, ''));
        result[keyPart] = fav;
      }
    });
    return result;
  }

  async deleteFavorite(userName: string, key: string): Promise<void> {
    await this.withRetry(() => this.client.del(this.favKey(userName, key)));
  }

  // ---------- 用戶註冊 / 登錄 ----------
  private userPwdKey(user: string) {
    return `u:${user}:pwd`;
  }

  async registerUser(userName: string, password: string): Promise<void> {
    const hashedPassword = await normalizePasswordForStorage(password);
    await this.withRetry(() =>
      this.client.set(this.userPwdKey(userName), hashedPassword)
    );
  }

  async verifyUser(userName: string, password: string): Promise<boolean> {
    const stored = await this.withRetry(() =>
      this.client.get(this.userPwdKey(userName))
    );
    if (stored === null) return false;
    const storedPassword = ensureString(stored);
    const { valid, upgradedHash } = await verifyPassword(
      password,
      storedPassword
    );
    if (valid && upgradedHash) {
      await this.withRetry(() =>
        this.client.set(this.userPwdKey(userName), upgradedHash)
      );
    }
    return valid;
  }

  // 檢查用戶是否存在
  async checkUserExist(userName: string): Promise<boolean> {
    // 使用 EXISTS 判斷 key 是否存在
    const exists = await this.withRetry(() =>
      this.client.exists(this.userPwdKey(userName))
    );
    return exists === 1;
  }

  // 修改用戶密碼
  async changePassword(userName: string, newPassword: string): Promise<void> {
    const hashedPassword = await normalizePasswordForStorage(newPassword);
    await this.withRetry(() =>
      this.client.set(this.userPwdKey(userName), hashedPassword)
    );
  }

  // 刪除用戶及其所有數據
  async deleteUser(userName: string): Promise<void> {
    // 刪除用戶密碼
    await this.withRetry(() => this.client.del(this.userPwdKey(userName)));

    // 刪除搜索歷史
    await this.withRetry(() => this.client.del(this.shKey(userName)));

    // 刪除播放記錄
    const playRecordPattern = `u:${userName}:pr:*`;
    const playRecordKeys = await this.withRetry(() =>
      this.client.keys(playRecordPattern)
    );
    if (playRecordKeys.length > 0) {
      await this.withRetry(() => this.client.del(playRecordKeys));
    }

    // 刪除收藏夾
    const favoritePattern = `u:${userName}:fav:*`;
    const favoriteKeys = await this.withRetry(() =>
      this.client.keys(favoritePattern)
    );
    if (favoriteKeys.length > 0) {
      await this.withRetry(() => this.client.del(favoriteKeys));
    }

    // 刪除跳過片頭片尾配置
    const skipConfigPattern = `u:${userName}:skip:*`;
    const skipConfigKeys = await this.withRetry(() =>
      this.client.keys(skipConfigPattern)
    );
    if (skipConfigKeys.length > 0) {
      await this.withRetry(() => this.client.del(skipConfigKeys));
    }
  }

  // ---------- 搜索歷史 ----------
  private shKey(user: string) {
    return `u:${user}:sh`; // u:username:sh
  }

  async getSearchHistory(userName: string): Promise<string[]> {
    const result = await this.withRetry(() =>
      this.client.lRange(this.shKey(userName), 0, -1)
    );
    // 確保返回的都是字符串類型
    return ensureStringArray(result as any[]);
  }

  async addSearchHistory(userName: string, keyword: string): Promise<void> {
    const key = this.shKey(userName);
    // 先去重
    await this.withRetry(() => this.client.lRem(key, 0, ensureString(keyword)));
    // 插入到最前
    await this.withRetry(() => this.client.lPush(key, ensureString(keyword)));
    // 限制最大長度
    await this.withRetry(() => this.client.lTrim(key, 0, SEARCH_HISTORY_LIMIT - 1));
  }

  async deleteSearchHistory(userName: string, keyword?: string): Promise<void> {
    const key = this.shKey(userName);
    if (keyword) {
      await this.withRetry(() => this.client.lRem(key, 0, ensureString(keyword)));
    } else {
      await this.withRetry(() => this.client.del(key));
    }
  }

  // ---------- 獲取全部用戶 ----------
  async getAllUsers(): Promise<string[]> {
    const keys = await this.withRetry(() => this.client.keys('u:*:pwd'));
    return keys
      .map((k) => {
        const match = k.match(/^u:(.+?):pwd$/);
        return match ? ensureString(match[1]) : undefined;
      })
      .filter((u): u is string => typeof u === 'string');
  }

  // ---------- 管理員配置 ----------
  private adminConfigKey() {
    return 'admin:config';
  }

  async getAdminConfig(): Promise<AdminConfig | null> {
    const val = await this.withRetry(() => this.client.get(this.adminConfigKey()));
    return val ? (JSON.parse(val) as AdminConfig) : null;
  }

  async setAdminConfig(config: AdminConfig): Promise<void> {
    await this.withRetry(() =>
      this.client.set(this.adminConfigKey(), JSON.stringify(config))
    );
  }

  // ---------- 跳過片頭片尾配置 ----------
  private skipConfigKey(user: string, source: string, id: string) {
    return `u:${user}:skip:${source}+${id}`;
  }

  async getSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<SkipConfig | null> {
    const val = await this.withRetry(() =>
      this.client.get(this.skipConfigKey(userName, source, id))
    );
    return val ? (JSON.parse(val) as SkipConfig) : null;
  }

  async setSkipConfig(
    userName: string,
    source: string,
    id: string,
    config: SkipConfig
  ): Promise<void> {
    await this.withRetry(() =>
      this.client.set(
        this.skipConfigKey(userName, source, id),
        JSON.stringify(config)
      )
    );
  }

  async deleteSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<void> {
    await this.withRetry(() =>
      this.client.del(this.skipConfigKey(userName, source, id))
    );
  }

  async getAllSkipConfigs(
    userName: string
  ): Promise<{ [key: string]: SkipConfig }> {
    const pattern = `u:${userName}:skip:*`;
    const keys = await this.withRetry(() => this.client.keys(pattern));

    if (keys.length === 0) {
      return {};
    }

    const configs: { [key: string]: SkipConfig } = {};

    // 批量獲取所有配置
    const values = await this.withRetry(() => this.client.mGet(keys));

    keys.forEach((key, index) => {
      const value = values[index];
      if (value) {
        // 從key中提取source+id
        const match = key.match(/^u:.+?:skip:(.+)$/);
        if (match) {
          const sourceAndId = match[1];
          configs[sourceAndId] = JSON.parse(value as string) as SkipConfig;
        }
      }
    });

    return configs;
  }

  // 清空所有數據
  async clearAllData(): Promise<void> {
    try {
      // 獲取所有用戶
      const allUsers = await this.getAllUsers();

      // 刪除所有用戶及其數據
      for (const username of allUsers) {
        await this.deleteUser(username);
      }

      // 刪除管理員配置
      await this.withRetry(() => this.client.del(this.adminConfigKey()));

      console.log('所有數據已清空');
    } catch (error) {
      console.error('清空數據失敗:', error);
      throw new Error('清空數據失敗');
    }
  }
}