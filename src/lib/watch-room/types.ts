/**
 * 共同觀影室：客戶端與服務端共享的协议类型與常量。
 *
 * 本文件不依赖任何运行時 API（瀏覽器 / Node / Edge 均可安全引入）。
 */

/** 房間號為 6 位大寫字母數字，方便口頭傳達與手動输入 */
export const ROOM_ID_LENGTH = 6;

/** 臨時觀影室最長保留 6 小時；持久房間不設定過期時間 */
export const ROOM_TTL_SECONDS = 6 * 60 * 60;

/** 成員超過 20 秒未 sync 视為離開 */
export const MEMBER_TIMEOUT_MS = 20_000;

/** 每個房間最多保留的事件條數（聊天 + 系統提示） */
export const EVENT_LIMIT = 100;

/** 單條聊天訊息最大長度 */
export const MAX_MESSAGE_LENGTH = 200;

/** 暱稱最大長度 */
export const MAX_NAME_LENGTH = 20;

/** 客戶端轮询間隔（毫秒）。調大可降低 Upstash 命令消耗 */
export const POLL_INTERVAL_MS = 1500;

/** 成員空闲時的轮询間隔（毫秒）。非房主在房間無新事件時逐步退避到這裡 */
export const POLL_IDLE_INTERVAL_MS = 3000;

/** 標簽頁隐藏 / 面板不可见時的轮询間隔（毫秒） */
export const POLL_HIDDEN_INTERVAL_MS = 15_000;

/** 轮询抖動比例：把同一房間 N 個客戶端的請求打散，避免整點惊群 */
export const POLL_JITTER = 0.25;

/**
 * 單次響應最多携帶的成員明細條數。
 * 大房間只回傳這個上限的預覽名單 + 精確總人數，不再把整份名單推给每個人。
 */
export const MEMBER_PREVIEW_LIMIT = 20;

/** 同一成員的聊天冷却（毫秒），防止大房間訊息风暴打爆事件流 */
export const CHAT_COOLDOWN_MS = 900;

/** 成員元數據 / 在線標記的兜底 TTL（秒），略大于離線判定窗口即可 */
export const MEMBER_META_TTL_SECONDS = 60;

/** 事件批量寫入時單次響應的上限 */
export const EVENT_RESPONSE_LIMIT = EVENT_LIMIT;

/** 创建观影室时允许设置的最小 / 最大 / 默认人数上限 */
export const MIN_ROOM_CAPACITY = 1;
export const MAX_ROOM_CAPACITY = 100;
export const DEFAULT_ROOM_CAPACITY = 20;

/**
 * 读取 / 校验口径：把房间对象里存的 maxMembers 转成有效上限。
 *
 * 返回 undefined 表示「不限制」。这个语义必须保留：升级前创建的房间没有
 * maxMembers 字段，若把它也解释成默认上限，历史房间会被凭空限流。
 * 列表展示、容量校验都用这个函数。
 */
export function normalizeCapacity(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const rounded = Math.floor(n);
  if (rounded < MIN_ROOM_CAPACITY) return undefined;
  return Math.min(rounded, MAX_ROOM_CAPACITY);
}

/**
 * 创建口径：输入框留空 / 0 / 非数字一律落到默认上限，填了有效数字则
 * 收敛到 [MIN, MAX]。始终返回具体数字，保证新建房间一定带 maxMembers。
 *
 * 与 normalizeCapacity 分开是为了让「历史房间不限制」和「新房间默认 20 人」
 * 两件事互不干扰：前者是读旧数据，后者是写新数据。
 */
export function resolveCreateCapacity(value: unknown): number {
  return normalizeCapacity(value) ?? DEFAULT_ROOM_CAPACITY;
}

export interface RoomMember {
  /** Server-only account binding, never included in public member views. */
  account?: string;
  id: string;
  name: string;
  joinedAt: number;
  lastSeen: number;
  syncMode: RoomSyncMode;
  /** 内部字段：上次發言時間，用于服務端聊天限流；不參與 UI 展示 */
  lastChatAt?: number;
}

/** 由房主持續上报的權威播放狀態 */
export interface RoomPlayState {
  playing: boolean;
  /** 秒 */
  time: number;
  /** 该狀態對應的服務端時間戳 */
  updatedAt: number;
}

export interface WatchRoom {
  id: string;
  hostId: string;
  hostName: string;
  /** 建立者帳號；存在時房間不会因成員離開或 TTL 自動刪除 */
  owner?: string;
  persistent?: boolean;
  /** 是否啟用，關閉後不再接收心跳；重新打開後繼續使用 */
  enabled?: boolean;
  /**
   * 是否公開：公開後房間会出现在「觀影室」頁面的公開列表裡，
   * 任何登錄用戶都能看到並加入。
   */
  isPublic?: boolean;
  /** 首次公開的時間，用于公開列表排序與展示 */
  publicizedAt?: number;
  /** 自定義房間名，顯示在导航與房間列表頭；默認為影片名 */
  title: string;
  /** 是否用戶顯式自定義了房間名稱；如果是，則不隨影片切換而改寫 */
  customName?: boolean;
  /** 目前播放影片標题，用于展示與切集提示，不覆盖房間名 */
  videoTitle?: string;
  /**
   * 房主目前播放頁路径（含 source / id / ep 等查询參數，不含 room）。
   * 邀請鏈接基于它生成，保證成員與房主處于同一片源、同一集。
   */
  playPath: string;
  /** 1 基集數 */
  episode: number;
  /** 房主設定的默認同步模式；成員可自行覆盖自己的同步模式 */
  defaultSyncMode: RoomSyncMode;
  state: RoomPlayState;
  /**
   * 成員明細預覽（最多 MEMBER_PREVIEW_LIMIT 條）。
   * 大房間下持久化层不再保存全量名單，真實名單由 presence 层按成員粒度维护。
   */
  members: RoomMember[];
  /** 活跃成員精確總數，由 presence 层實時統計 */
  memberCount?: number;
  /**
   * 房主创建时设置的在线人数上限。新建房间必定带此字段（默认 20 人）；
   * 字段缺失表示升级前创建的历史房间，按「不限制」处理。
   */
  maxMembers?: number;
  /** 最近一次事件序号，仅作参考；客户端以收到的事件 seq 为准 */
  seq: number;
  /**
   * 房間核心版本號，僅在核心狀態（播放狀態 / 影片 / 房主 / 配置）變化時遞增。
   * 客戶端帶上它後可以跳過無變化的心跳響應。
   */
  rev?: number;
  createdAt: number;
  lastActiveAt: number;
}

export type RoomEventType = 'system' | 'chat' | 'control';

export interface RoomEvent {
  seq: number;
  type: RoomEventType;
  actorId: string;
  actorName: string;
  text: string;
  at: number;
}

/** 待寫入事件：seq 由儲存层批量、原子分配 */
export type EventDraft = Omit<RoomEvent, 'seq'>;

export type ControlKind = 'play' | 'pause' | 'seek' | 'episode';
export type RoomSyncMode = 'auto' | 'manual';

export type RoomRequest =
  | {
      action: 'create';
      name: string;
      title: string;
      roomName?: string;
      playPath: string;
      episode: number;
      persistent?: boolean;
      /** 建立時直接公開到觀影室頁面 */
      isPublic?: boolean;
      /** 在线人数上限；留空 / 0 由服务端落到默认 20 人，最大 100 */
      maxMembers?: number;
    }
  /**
   * 我的房間列表。
   * fresh=true 時跳過服務端列表緩存，並按實時在線狀態重新統計人數，
   * 供「觀影室」頁面的刷新按钮使用。
   */
  | { action: 'myRooms'; fresh?: boolean }
  /** 公開列表：所有已公開且未關閉的房間，任何人可加入 */
  | { action: 'publicRooms'; fresh?: boolean }
  | { action: 'setPublic'; roomId: string; public: boolean }
  | { action: 'close'; roomId: string }
  | { action: 'delete'; roomId: string }
  | { action: 'enterOwned'; roomId: string; name: string }
  | { action: 'activateOwned'; roomId: string }
  | { action: 'hasPersistentRoom' }
  | { action: 'join'; roomId: string; name: string }
  | {
      action: 'sync';
      roomId: string;
      memberId: string;
      since: number;
      /** 用于房間重啟後自愈重入 */
      name?: string;
      /** 房主上报目前播放頁，成員據此判斷是否需要換集 */
      playPath?: string;
      /** 房主目前播放影片名稱 */
      title?: string;
      episode?: number;
      /** 房主上报本地播放狀態作為心跳 */
      local?: { time: number; playing: boolean };
      /** 客戶端已持有的核心版本號，用于跳過無變化響應 */
      rev?: number;
      /** 客戶端已持有的在線人數，用于判斷名單是否需要刷新 */
      memberCount?: number;
    }
  | {
      action: 'setSyncMode';
      roomId: string;
      memberId: string;
      syncMode: RoomSyncMode;
    }
  | {
      action: 'control';
      roomId: string;
      memberId: string;
      kind: ControlKind;
      time: number;
      playing: boolean;
    }
  | { action: 'chat'; roomId: string; memberId: string; text: string }
  | { action: 'leave'; roomId: string; memberId: string };

export interface RoomResponse {
  ok: boolean;
  rooms?: WatchRoom[];
  error?: string;
  room?: WatchRoom;
  events?: RoomEvent[];
  /** 服務端確認 / 重新分配的成員 id */
  memberId?: string;
  /** 目前調用者是否為房主，由服務端判定 */
  isHost?: boolean;
  serverTime?: number;
  /** 'upstash' / 'd1' 表示狀態跨實例共享；'memory' 表示僅目前進程可用 */
  storeKind?: 'supabase' | 'memory';
  /** 活跃成員精確總數 */
  memberCount?: number;
  /** 調用者自己的同步模式（即使名單被裁剪也能拿到） */
  mySyncMode?: RoomSyncMode;
  /** 目前房間核心版本號 */
  rev?: number;
  /** 為 true 時 room 省略，客戶端可完全跳過狀態更新 */
  unchanged?: boolean;
}

export function isRoomId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    new RegExp(`^[A-Z0-9]{${ROOM_ID_LENGTH}}$`).test(value)
  );
}

/** 清洗用戶可控文本：去掉控制字符、压缩空白、限長 */
export function cleanText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  // 避免 no-control-regex：通過字符码過滤控制字符
  const sanitized = Array.from(value)
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code >= 0x20 && code !== 0x7f;
    })
    .join('');
  return sanitized.trim().slice(0, maxLength);
}

export function currentPlayPath(): string {
  if (typeof window === 'undefined') return '/play';
  const url = new URL(window.location.href);
  url.searchParams.delete('room');
  return `${url.pathname}${url.search}`;
}
