import { AdminConfig } from './admin.types';

// 播放記錄數據結構
export interface PlayRecord {
  title: string;
  source_name: string;
  cover: string;
  year: string;
  index: number; // 第幾集
  total_episodes: number; // 總集數
  play_time: number; // 播放進度（秒）
  total_time: number; // 總進度（秒）
  save_time: number; // 記錄保存時間（時間戳）
  search_title: string; // 搜索時使用的標題
}

// 收藏數據結構
export interface Favorite {
  source_name: string;
  total_episodes: number; // 總集數
  title: string;
  year: string;
  cover: string;
  save_time: number; // 記錄保存時間（時間戳）
  search_title: string; // 搜索時使用的標題
}

// 追更数据结构
export interface Following {
  source_name: string;
  total_episodes: number;
  watched_episodes: number;
  title: string;
  year: string;
  cover: string;
  save_time: number;
  search_title: string;
  source?: string;
  id?: string;
}

// 存储接口
export interface IStorage {
  verifyUserSession(
    userName: string,
    password: string
  ): Promise<{ valid: boolean; sessionVersion?: string }>;
  getUserSessionState(
    userName: string
  ): Promise<{ exists: boolean; notBefore: number; sessionVersion?: string }>;
  getUserCredentialSnapshot(userName: string): Promise<unknown>;
  deleteUserAtomic(
    userName: string,
    previous: AdminConfig,
    expectedCredential: unknown
  ): Promise<void>;
  updatePlayRecordIfUnchanged(
    userName: string,
    key: string,
    previous: PlayRecord,
    next: PlayRecord
  ): Promise<boolean>;
  updateFavoriteIfUnchanged(
    userName: string,
    key: string,
    previous: Favorite,
    next: Favorite
  ): Promise<boolean>;
  acquireLease(
    name: string,
    ttlMs: number
  ): Promise<(() => Promise<void>) | null>;
  getUserSessionNotBefore(userName: string): Promise<number>;
  registerUserAtomic(
    userName: string,
    password: string,
    previous: AdminConfig,
    next: AdminConfig
  ): Promise<string>;
  snapshotAllData(): Promise<Array<{ key: string; value: unknown }>>;
  restoreAllData(rows: Array<{ key: string; value: unknown }>): Promise<void>;
  // 播放記錄相關
  getPlayRecord(userName: string, key: string): Promise<PlayRecord | null>;
  setPlayRecord(
    userName: string,
    key: string,
    record: PlayRecord
  ): Promise<void>;
  getAllPlayRecords(userName: string): Promise<{ [key: string]: PlayRecord }>;
  deletePlayRecord(userName: string, key: string): Promise<void>;

  // 收藏相關
  getFavorite(userName: string, key: string): Promise<Favorite | null>;
  setFavorite(userName: string, key: string, favorite: Favorite): Promise<void>;
  getAllFavorites(userName: string): Promise<{ [key: string]: Favorite }>;
  deleteFavorite(userName: string, key: string): Promise<void>;

  // 追更相关
  getFollowing(userName: string, key: string): Promise<Following | null>;
  setFollowing(
    userName: string,
    key: string,
    following: Following
  ): Promise<void>;
  updateFollowingIfUnchanged(
    userName: string,
    key: string,
    previous: Following,
    following: Following
  ): Promise<boolean>;
  getAllFollowings(userName: string): Promise<{ [key: string]: Following }>;
  deleteFollowing(userName: string, key: string): Promise<void>;

  // 用户相关
  registerUser(userName: string, password: string): Promise<void>;
  appendRegisteredUser(userName: string): Promise<AdminConfig>;
  verifyUser(userName: string, password: string): Promise<boolean>;
  getUserPassword(userName: string): Promise<string | null>;
  // 檢查用戶是否存在（無需密碼）
  checkUserExist(userName: string): Promise<boolean>;
  // 修改用戶密碼
  changePassword(
    userName: string,
    newPassword: string,
    currentPassword?: string
  ): Promise<void>;
  // 刪除用戶（包括密碼、搜索歷史、播放記錄、收藏夾）
  deleteUser(userName: string): Promise<void>;

  // 搜索歷史相關
  getSearchHistory(userName: string): Promise<string[]>;
  addSearchHistory(userName: string, keyword: string): Promise<void>;
  deleteSearchHistory(userName: string, keyword?: string): Promise<void>;

  // 用戶列表
  getAllUsers(): Promise<string[]>;

  // 管理員配置相關
  getAdminConfig(): Promise<AdminConfig | null>;
  setAdminConfig(config: AdminConfig): Promise<void>;
  updateUserLastOnline(userName: string, timestamp: number): Promise<boolean>;

  // 跳過片頭片尾配置相關
  getSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<SkipConfig | null>;
  setSkipConfig(
    userName: string,
    source: string,
    id: string,
    config: SkipConfig
  ): Promise<void>;
  deleteSkipConfig(userName: string, source: string, id: string): Promise<void>;
  getAllSkipConfigs(userName: string): Promise<{ [key: string]: SkipConfig }>;

  // “今日新更”相关（保留一天、跟随账号跨设备）
  getTodayUpdated(userName: string): Promise<TodayUpdatedRecord | null>;
  setTodayUpdated(userName: string, record: TodayUpdatedRecord): Promise<void>;

  // 数据清理
  clearAllData(): Promise<void>;
}

// 搜索結果數據結構
export interface SearchResult {
  id: string;
  title: string;
  poster: string;
  episodes: string[];
  episodes_titles: string[];
  source: string;
  source_name: string;
  class?: string;
  year: string;
  desc?: string;
  type_name?: string;
  douban_id?: number;
}

// 豆瓣數據結構
export interface DoubanItem {
  id: string;
  title: string;
  poster: string;
  rate: string;
  year: string;
}

export interface DoubanResult {
  code: number;
  message: string;
  list: DoubanItem[];
}

// 跳過片頭片尾配置數據結構
export interface SkipConfig {
  enable: boolean; // 是否啟用跳過片頭片尾
  intro_time: number; // 片頭時間（秒）
  outro_time: number; // 片尾時間（秒）
}

// “今日新更”条目数据结构（追更页当天检测到有新集数更新的影片）
export interface TodayUpdatedItem {
  source: string;
  id: string;
  title: string;
  poster: string;
  episodes: number;
  watchedEpisodes: number;
  unwatchedEpisodes: number;
  source_name: string;
  year: string;
  save_time: number;
  oldEpisodes: number;
  newEpisodes: number;
}

// “今日新更”记录：按日期（YYYY-MM-DD）保存当天条目，跨天自动清空
export interface TodayUpdatedRecord {
  date: string; // YYYY-MM-DD
  items: TodayUpdatedItem[];
}

// 弹幕数据结构
export interface DanmakuItem {
  time: number; // 彈幕出現時間（秒）
  type: number; // 彈幕類型：1-滾動，2-頂部，3-底部
  color: number; // 彈幕顏色（十進制）
  text: string; // 彈幕文本
  size?: number; // 字體大小（可選）
  pool?: number; // 彈幕池（可選）
}

// 彈幕 API 響應數據結構（實際格式）
export interface DanmakuComment {
  cid: number;
  p: string; // 屬性字符串，格式: "時間,類型,顏色,作者"
  m: string; // 彈幕文本內容
  t: number; // 時間（秒）
}

export interface DanmakuResponse {
  count?: number;
  comments?: DanmakuComment[]; // 實際的彈幕數組
  // 兼容其他格式
  code?: number;
  message?: string;
  data?: DanmakuItem[];
}
