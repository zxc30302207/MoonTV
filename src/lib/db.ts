/* eslint-disable no-console, @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */

import { AdminConfig } from './admin.types';
import {
  MutationNamespace,
  NamespaceMutation,
  NamespaceMutationResult,
  NamespaceSnapshot,
} from './mutation-protocol';
import { SupabaseStorage } from './supabase.db';
import {
  Favorite,
  Following,
  IStorage,
  PlayRecord,
  SkipConfig,
  TodayUpdatedRecord,
} from './types';

type StorageType = 'localstorage' | 'supabase';

function getStorageType(): StorageType {
  return process.env.NEXT_PUBLIC_STORAGE_TYPE === 'supabase'
    ? 'supabase'
    : 'localstorage';
}

// 創建存儲實例
function createStorage(): IStorage {
  switch (getStorageType()) {
    case 'supabase':
      return new SupabaseStorage();
    case 'localstorage':
    default:
      return null as unknown as IStorage;
  }
}

// 單例存儲實例
let storageInstance: IStorage | null = null;

export function getStorage(): IStorage {
  if (!storageInstance) {
    storageInstance = createStorage();
  }
  return storageInstance;
}

// 工具函數：生成存儲key
export function generateStorageKey(source: string, id: string): string {
  return `${source}+${id}`;
}

// 導出便捷方法
export class DbManager {
  private storage: IStorage;

  constructor() {
    this.storage = getStorage();
  }

  async readNamespace(
    userName: string,
    namespace: MutationNamespace
  ): Promise<NamespaceSnapshot> {
    return (this.storage as SupabaseStorage).readNamespace(userName, namespace);
  }

  async mutateNamespace(
    userName: string,
    namespace: MutationNamespace,
    mutation: NamespaceMutation
  ): Promise<NamespaceMutationResult> {
    return (this.storage as SupabaseStorage).mutateNamespace(
      userName,
      namespace,
      mutation
    );
  }

  // 播放記錄相關方法
  async getPlayRecord(
    userName: string,
    source: string,
    id: string
  ): Promise<PlayRecord | null> {
    const key = generateStorageKey(source, id);
    return this.storage.getPlayRecord(userName, key);
  }

  async savePlayRecord(
    userName: string,
    source: string,
    id: string,
    record: PlayRecord
  ): Promise<void> {
    const key = generateStorageKey(source, id);
    await this.storage.setPlayRecord(userName, key, record);
  }

  async getAllPlayRecords(userName: string): Promise<{
    [key: string]: PlayRecord;
  }> {
    return this.storage.getAllPlayRecords(userName);
  }

  async deletePlayRecord(
    userName: string,
    source: string,
    id: string
  ): Promise<void> {
    const key = generateStorageKey(source, id);
    await this.storage.deletePlayRecord(userName, key);
  }

  // 收藏相關方法
  async getFavorite(
    userName: string,
    source: string,
    id: string
  ): Promise<Favorite | null> {
    const key = generateStorageKey(source, id);
    return this.storage.getFavorite(userName, key);
  }

  async saveFavorite(
    userName: string,
    source: string,
    id: string,
    favorite: Favorite
  ): Promise<void> {
    const key = generateStorageKey(source, id);
    await this.storage.setFavorite(userName, key, favorite);
  }

  async getAllFavorites(
    userName: string
  ): Promise<{ [key: string]: Favorite }> {
    return this.storage.getAllFavorites(userName);
  }

  async deleteFavorite(
    userName: string,
    source: string,
    id: string
  ): Promise<void> {
    const key = generateStorageKey(source, id);
    await this.storage.deleteFavorite(userName, key);
  }

  async isFavorited(
    userName: string,
    source: string,
    id: string
  ): Promise<boolean> {
    const favorite = await this.getFavorite(userName, source, id);
    return favorite !== null;
  }

  // 追更相关方法
  async getFollowing(
    userName: string,
    source: string,
    id: string
  ): Promise<Following | null> {
    const key = generateStorageKey(source, id);
    return this.storage.getFollowing(userName, key);
  }

  async saveFollowing(
    userName: string,
    source: string,
    id: string,
    following: Following
  ): Promise<void> {
    const key = generateStorageKey(source, id);
    await this.storage.setFollowing(userName, key, following);
  }

  async updateFollowingIfUnchanged(
    userName: string,
    source: string,
    id: string,
    previous: Following,
    following: Following
  ): Promise<boolean> {
    return this.storage.updateFollowingIfUnchanged(
      userName,
      generateStorageKey(source, id),
      previous,
      following
    );
  }

  async getAllFollowings(
    userName: string
  ): Promise<{ [key: string]: Following }> {
    return this.storage.getAllFollowings(userName);
  }

  async deleteFollowing(
    userName: string,
    source: string,
    id: string
  ): Promise<void> {
    const key = generateStorageKey(source, id);
    await this.storage.deleteFollowing(userName, key);
  }

  // ---------- 用户相关 ----------
  async registerUser(userName: string, password: string): Promise<void> {
    await this.storage.registerUser(userName, password);
  }

  async verifyUser(userName: string, password: string): Promise<boolean> {
    return this.storage.verifyUser(userName, password);
  }

  async getUserPassword(userName: string): Promise<string | null> {
    if (typeof (this.storage as any).getUserPassword === 'function') {
      return (this.storage as any).getUserPassword(userName);
    }
    return null;
  }

  // 檢查用戶是否已存在
  async checkUserExist(userName: string): Promise<boolean> {
    return this.storage.checkUserExist(userName);
  }

  // ---------- 搜索歷史 ----------
  async getSearchHistory(userName: string): Promise<string[]> {
    return this.storage.getSearchHistory(userName);
  }

  async addSearchHistory(userName: string, keyword: string): Promise<void> {
    await this.storage.addSearchHistory(userName, keyword);
  }

  async deleteSearchHistory(userName: string, keyword?: string): Promise<void> {
    await this.storage.deleteSearchHistory(userName, keyword);
  }

  // 獲取全部用戶名
  async getAllUsers(): Promise<string[]> {
    if (typeof (this.storage as any).getAllUsers === 'function') {
      return (this.storage as any).getAllUsers();
    }
    return [];
  }

  // ---------- 管理員配置 ----------
  async getAdminConfig(): Promise<AdminConfig | null> {
    if (typeof (this.storage as any).getAdminConfig === 'function') {
      return (this.storage as any).getAdminConfig();
    }
    return null;
  }

  async saveAdminConfig(config: AdminConfig): Promise<void> {
    if (typeof (this.storage as any).setAdminConfig === 'function') {
      await (this.storage as any).setAdminConfig(config);
    }
  }

  // ---------- 跳過片頭片尾配置 ----------
  async getSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<SkipConfig | null> {
    if (typeof (this.storage as any).getSkipConfig === 'function') {
      return (this.storage as any).getSkipConfig(userName, source, id);
    }
    return null;
  }

  async setSkipConfig(
    userName: string,
    source: string,
    id: string,
    config: SkipConfig
  ): Promise<void> {
    if (typeof (this.storage as any).setSkipConfig === 'function') {
      await (this.storage as any).setSkipConfig(userName, source, id, config);
    }
  }

  async deleteSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<void> {
    if (typeof (this.storage as any).deleteSkipConfig === 'function') {
      await (this.storage as any).deleteSkipConfig(userName, source, id);
    }
  }

  async getAllSkipConfigs(
    userName: string
  ): Promise<{ [key: string]: SkipConfig }> {
    if (typeof (this.storage as any).getAllSkipConfigs === 'function') {
      return (this.storage as any).getAllSkipConfigs(userName);
    }
    return {};
  }

  // ---------- “今日新更” ----------
  async getTodayUpdated(userName: string): Promise<TodayUpdatedRecord | null> {
    if (typeof (this.storage as any).getTodayUpdated === 'function') {
      return (this.storage as any).getTodayUpdated(userName);
    }
    return null;
  }

  async setTodayUpdated(
    userName: string,
    record: TodayUpdatedRecord
  ): Promise<void> {
    if (typeof (this.storage as any).setTodayUpdated === 'function') {
      await (this.storage as any).setTodayUpdated(userName, record);
    }
  }

  // ---------- 数据清理 ----------
  async clearAllData(): Promise<void> {
    if (typeof (this.storage as any).clearAllData === 'function') {
      await (this.storage as any).clearAllData();
    } else {
      throw new Error('存儲類型不支持清空數據操作');
    }
  }

  // ---------- 批量导入（数据迁移专用） ----------
  // Supabase supports batch upserts. Fall back to individual writes for other stores.
  async batchImportPlayRecords(
    username: string,
    entries: Array<[string, PlayRecord]>,
    onProgress?: (done: number, total: number) => void
  ): Promise<boolean> {
    if (typeof (this.storage as any).batchImportPlayRecords === 'function') {
      await (this.storage as any).batchImportPlayRecords(
        username,
        entries,
        onProgress
      );
      return true;
    }
    return false;
  }

  async batchImportFavorites(
    username: string,
    entries: Array<[string, Favorite]>,
    onProgress?: (done: number, total: number) => void
  ): Promise<boolean> {
    if (typeof (this.storage as any).batchImportFavorites === 'function') {
      await (this.storage as any).batchImportFavorites(
        username,
        entries,
        onProgress
      );
      return true;
    }
    return false;
  }

  async batchImportFollowings(
    username: string,
    entries: Array<[string, Following]>,
    onProgress?: (done: number, total: number) => void
  ): Promise<boolean> {
    if (typeof (this.storage as any).batchImportFollowings === 'function') {
      await (this.storage as any).batchImportFollowings(
        username,
        entries,
        onProgress
      );
      return true;
    }
    return false;
  }

  async batchImportSkipConfigs(
    username: string,
    entries: Array<[string, SkipConfig]>,
    onProgress?: (done: number, total: number) => void
  ): Promise<boolean> {
    if (typeof (this.storage as any).batchImportSkipConfigs === 'function') {
      await (this.storage as any).batchImportSkipConfigs(
        username,
        entries,
        onProgress
      );
      return true;
    }
    return false;
  }

  async batchImportSearchHistory(
    username: string,
    keywords: string[],
    onProgress?: (done: number, total: number) => void
  ): Promise<boolean> {
    if (typeof (this.storage as any).batchImportSearchHistory === 'function') {
      await (this.storage as any).batchImportSearchHistory(
        username,
        keywords,
        onProgress
      );
      return true;
    }
    return false;
  }

  async batchImportTodayUpdated(
    username: string,
    record: TodayUpdatedRecord
  ): Promise<boolean> {
    if (typeof (this.storage as any).batchImportTodayUpdated === 'function') {
      await (this.storage as any).batchImportTodayUpdated(username, record);
      return true;
    }
    return false;
  }
}

// 導出默認實例
export const db = new DbManager();
