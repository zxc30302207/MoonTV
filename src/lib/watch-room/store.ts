import {
  EVENT_LIMIT,
  EventDraft,
  MEMBER_TIMEOUT_MS,
  ROOM_TTL_SECONDS,
  RoomEvent,
  RoomMember,
  WatchRoom,
} from './types';
export interface PresenceView {
  /** 活跃成员精确总数（已剔除超时成员） */
  count: number;
  /** 成员明细预览，最多 limit 条；preferIds 中仍在线的成员一定在其中 */
  members: RoomMember[];
  /** 活跃成员中最早加入者，用于房主移交 */
  earliest: RoomMember | null;
  /** 本次清扫移除的超时成员数，用于聚合「N 人离开」提示 */
  removed: number;
}

export interface RoomStore {
  // ---- 房间核心 ----
  getRoom(roomId: string): Promise<WatchRoom | null>;
  listRooms(): Promise<WatchRoom[]>;
  saveRoom(room: WatchRoom): Promise<void>;
  deleteRoom(roomId: string): Promise<void>;

  // ---- 事件流 ----
  /** 当前事件序号；无新事件时可据此跳过 listEvents */
  getSeq(roomId: string): Promise<number>;
  /** 批量写入事件，连续 seq 由存储层原子分配 */
  appendEvents(
    roomId: string,
    drafts: EventDraft[],
    roomTtlSeconds: number
  ): Promise<RoomEvent[]>;
  /** 只取 since 之后的 limit 条，避免每次心跳都反序列化 100 条旧事件 */
  listEvents(
    roomId: string,
    since: number,
    limit: number
  ): Promise<RoomEvent[]>;

  // ---- 成员存在（presence）----
  /** 新建 / 更新成员元数据并刷新在线标记；roomTtlSeconds>0 时同时续期房间 key */
  putMember(
    roomId: string,
    member: RoomMember,
    roomTtlSeconds: number
  ): Promise<void>;
  /** 读取单个成员；lastSeen 来自在线标记，调用方据此判断是否已超时 */
  getMember(roomId: string, memberId: string): Promise<RoomMember | null>;
  /** 读取在线视图并顺带清扫超时成员（原子、廉价） */
  getPresence(
    roomId: string,
    timeoutMs: number,
    limit: number,
    preferIds?: string[]
  ): Promise<PresenceView>;
  removeMember(roomId: string, memberId: string): Promise<void>;
  /** 选出最早加入且仍在线的成员；仅在房主移交时调用 */
  pickOldestActiveMember(
    roomId: string,
    timeoutMs: number
  ): Promise<RoomMember | null>;
}

function cloneMember(member: RoomMember): RoomMember {
  return { ...member };
}
export interface MemoryEntry {
  room: WatchRoom;
  events: RoomEvent[];
  seq: number;
  updatedAt: number;
  members: Map<string, RoomMember>;
}

/** 挂在 globalThis 上，热更新 / 多模块实例之间仍能共享同一份状态 */
function memoryMap(): Map<string, MemoryEntry> {
  const g = globalThis as typeof globalThis & {
    __moontvWatchRoomMemory?: Map<string, MemoryEntry>;
  };
  if (!g.__moontvWatchRoomMemory) {
    g.__moontvWatchRoomMemory = new Map<string, MemoryEntry>();
  }
  return g.__moontvWatchRoomMemory as Map<string, MemoryEntry>;
}

function sweepExpired(map: Map<string, MemoryEntry>): void {
  const now = Date.now();
  map.forEach((entry, id) => {
    if (
      !entry.room.persistent &&
      now - entry.updatedAt > ROOM_TTL_SECONDS * 1000
    ) {
      map.delete(id);
    }
  });
}

export class MemoryRoomStore implements RoomStore {
  constructor(private readonly data: Map<string, MemoryEntry> = memoryMap()) {}
  snapshot(): [
    string,
    Omit<MemoryEntry, 'members'> & { members: [string, RoomMember][] }
  ][] {
    sweepExpired(this.data);
    return Array.from(this.data, ([id, entry]) => [
      id,
      { ...entry, members: Array.from(entry.members) },
    ]);
  }
  replace(snapshot: ReturnType<MemoryRoomStore['snapshot']>): void {
    this.data.clear();
    for (const [id, entry] of snapshot) {
      this.data.set(id, { ...entry, members: new Map(entry.members) });
    }
  }
  async getRoom(roomId: string): Promise<WatchRoom | null> {
    const map = this.data;
    sweepExpired(map);
    const entry = map.get(roomId);
    return entry ? structuredCloneRoom(entry.room) : null;
  }

  async listRooms(): Promise<WatchRoom[]> {
    const map = this.data;
    sweepExpired(map);
    return Array.from(map.values())
      .map((entry) => structuredCloneRoom(entry.room))
      .filter((room) => room.persistent);
  }

  async saveRoom(room: WatchRoom): Promise<void> {
    const map = this.data;
    const entry = map.get(room.id);
    if (!entry && map.size >= 100) throw new Error('觀影室數量已達上限');
    if (entry) {
      entry.room = structuredCloneRoom(room);
      entry.updatedAt = Date.now();
    } else {
      map.set(room.id, {
        room: structuredCloneRoom(room),
        events: [],
        seq: 0,
        members: new Map<string, RoomMember>(),
        updatedAt: Date.now(),
      });
    }
  }

  async deleteRoom(roomId: string): Promise<void> {
    this.data.delete(roomId);
  }

  async getSeq(roomId: string): Promise<number> {
    return this.data.get(roomId)?.seq || 0;
  }

  async appendEvents(
    roomId: string,
    drafts: EventDraft[],
    _roomTtlSeconds: number
  ): Promise<RoomEvent[]> {
    if (!drafts.length) return [];
    const entry = this.data.get(roomId);
    if (!entry) return [];
    const start = entry.seq + 1;
    const events = drafts.map((draft, i) => ({ ...draft, seq: start + i }));
    entry.seq += drafts.length;
    entry.events.unshift(...events.slice().reverse());
    if (entry.events.length > EVENT_LIMIT) entry.events.length = EVENT_LIMIT;
    entry.updatedAt = Date.now();
    return events;
  }

  async listEvents(
    roomId: string,
    since: number,
    limit: number
  ): Promise<RoomEvent[]> {
    const entry = this.data.get(roomId);
    if (!entry) return [];
    const size = Math.max(1, Math.min(EVENT_LIMIT, Math.floor(limit)));
    return entry.events
      .filter((item) => item.seq > since)
      .slice()
      .reverse()
      .slice(0, size);
  }

  async putMember(
    roomId: string,
    member: RoomMember,
    _roomTtlSeconds: number
  ): Promise<void> {
    const map = this.data;
    sweepExpired(map);
    const entry = map.get(roomId);
    if (!entry) return;
    for (const [id, stored] of Array.from(entry.members)) {
      if (stored.lastSeen < Date.now() - MEMBER_TIMEOUT_MS)
        entry.members.delete(id);
    }
    if (!entry.members.has(member.id) && entry.members.size >= 100)
      throw new Error('觀影室成員數量已達上限');
    entry.members.set(member.id, cloneMember(member));
    entry.updatedAt = Date.now();
  }

  async getMember(
    roomId: string,
    memberId: string
  ): Promise<RoomMember | null> {
    const entry = this.data.get(roomId);
    const member = entry?.members.get(memberId);
    return member ? cloneMember(member) : null;
  }

  async getPresence(
    roomId: string,
    timeoutMs: number,
    limit: number,
    preferIds: string[] = []
  ): Promise<PresenceView> {
    const map = this.data;
    sweepExpired(map);
    const entry = map.get(roomId);
    if (!entry) {
      return { count: 0, members: [], earliest: null, removed: 0 };
    }
    const cutoff = Date.now() - timeoutMs;
    let removed = 0;
    // Array.from 生成快照：兼容低 target，且遍历中 delete 不影响快照
    for (const [id, member] of Array.from(entry.members.entries())) {
      if (member.lastSeen < cutoff) {
        entry.members.delete(id);
        removed += 1;
      }
    }
    const all = Array.from(entry.members.values()).sort(
      (a, b) => a.joinedAt - b.joinedAt
    );
    const size = Math.max(0, Math.floor(limit));
    const chosen = new Set<string>();
    for (const id of preferIds) {
      if (entry.members.has(id)) chosen.add(id);
      if (chosen.size >= size) break;
    }
    for (const member of all) {
      if (chosen.size >= size) break;
      chosen.add(member.id);
    }
    const members = all
      .filter((member) => chosen.has(member.id))
      .slice(0, size)
      .map(cloneMember);
    return {
      count: all.length,
      members,
      earliest: all.length ? cloneMember(all[0]) : null,
      removed,
    };
  }

  async removeMember(roomId: string, memberId: string): Promise<void> {
    this.data.get(roomId)?.members.delete(memberId);
  }

  async pickOldestActiveMember(
    roomId: string,
    timeoutMs: number
  ): Promise<RoomMember | null> {
    const view = await this.getPresence(roomId, timeoutMs, 1);
    return view.earliest;
  }
}

function structuredCloneRoom(room: WatchRoom): WatchRoom {
  return JSON.parse(JSON.stringify(room)) as WatchRoom;
}

export function getStoreKind(): 'supabase' | 'memory' {
  return process.env.NEXT_PUBLIC_STORAGE_TYPE === 'supabase'
    ? 'supabase'
    : 'memory';
}
export function getRoomStore(): RoomStore {
  return new MemoryRoomStore();
}
