/* eslint-disable @typescript-eslint/no-explicit-any */

import { validPlayPath } from './access';
import { getRoomStore, getStoreKind, PresenceView, RoomStore } from './store';
import {
  CHAT_COOLDOWN_MS,
  cleanText,
  EVENT_LIMIT,
  EventDraft,
  isRoomId,
  MAX_MESSAGE_LENGTH,
  MAX_NAME_LENGTH,
  MEMBER_PREVIEW_LIMIT,
  MEMBER_TIMEOUT_MS,
  normalizeCapacity,
  resolveCreateCapacity,
  ROOM_TTL_SECONDS,
  RoomEvent,
  RoomMember,
  RoomRequest,
  RoomResponse,
  RoomSyncMode,
  WatchRoom,
} from './types';

const ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Do not cache permission-filtered room lists across accounts or transactions. */
function invalidateRoomsCache(): void {
  /* transaction owns its snapshot */
}
async function cachedListRooms(store: RoomStore): Promise<WatchRoom[]> {
  return store.listRooms();
}
async function freshListRooms(
  store: RoomStore,
  _now: number
): Promise<WatchRoom[]> {
  return store.listRooms();
}

/** Presence count throttling is only an optimization; authoritative lists count live members. */
function allowCountRefresh(_roomId: string, _now: number): boolean {
  return true;
}

/**
 * 按 presence 层實時統計每個房間「已進入且保持心跳連接」的人數。
 *
 * 房間核心裡的 memberCount 是房主心跳異步回寫的快照，加上列表緩存後，
 * 觀眾離開 / 加入時大厅頁面可能長期顯示舊值。這裡改用成員在線標記
 * （超過 MEMBER_TIMEOUT_MS 未 sync 即视為斷開）逐個房間精確計數。
 * limit=0 只取人數、不拉成員明細，避免刷新列表放大儲存讀取。
 */
async function liveCountsFor(
  store: RoomStore,
  rooms: WatchRoom[]
): Promise<number[]> {
  if (!rooms.length) return [];
  return Promise.all(
    rooms.map(async (room) => {
      const presence = await store.getPresence(room.id, MEMBER_TIMEOUT_MS, 0);
      return Math.max(0, Number(presence.count) || 0);
    })
  );
}

/**
 * 校验房间是否还能再进人。
 *
 * 人数以 presence 层的实时活跃数为准（与列表展示口径一致），而不是核心里
 * 异步回写的 memberCount 快照。selfId 是调用者自己持有的成员 id：若他本来
 * 就算在线，重连时不应把自己当成新占用一个名额，否则满员房间里的在线成员
 * 刷新一下页面就会被自己挤出去。
 *
 * 返回 null 表示可进入，否则返回可直接下发的错误响应。
 */
async function capacityBlock(
  store: RoomStore,
  room: WatchRoom,
  now: number,
  selfId?: string
): Promise<RoomResponse | null> {
  const cap = normalizeCapacity(room.maxMembers);
  const presence = await store.getPresence(room.id, MEMBER_TIMEOUT_MS, 0);
  let occupied = Math.max(0, Number(presence.count) || 0);
  if (selfId) {
    const self = await store.getMember(room.id, selfId);
    const lastSeen = Number(self?.lastSeen) || 0;
    if (lastSeen > 0 && now - lastSeen <= MEMBER_TIMEOUT_MS) {
      occupied = Math.max(0, occupied - 1);
    }
  }
  // Keep one slot within the custom 100-member storage bound for an offline
  // persistent owner. Do not evict guests or weaken the storage safety limit.
  if (room.persistent && room.owner && occupied >= 99) {
    const host = await store.getMember(room.id, room.hostId);
    if (!host || now - host.lastSeen > MEMBER_TIMEOUT_MS) {
      return fail('觀影室人數已滿（保留房主席位）');
    }
  }
  if (cap && occupied >= cap) {
    return fail(`觀影室人數已滿（上限 ${cap} 人）`);
  }
  return null;
}

function normalizeSyncMode(value: unknown): RoomSyncMode {
  return value === 'manual' ? 'manual' : 'auto';
}

function randomString(length: number, alphabet = ID_ALPHABET): string {
  const bytes = new Uint8Array(length);
  const cryptoApi =
    globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function'
      ? globalThis.crypto
      : null;

  if (cryptoApi) {
    cryptoApi.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

function makeMemberId(): string {
  return `m_${randomString(12, '0123456789abcdef')}`;
}

function safeTime(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, 7 * 24 * 3600);
}

function fail(error: string): RoomResponse {
  return { ok: false, error, storeKind: getStoreKind() };
}

function ttlOf(room: WatchRoom): number {
  return room.persistent ? 0 : ROOM_TTL_SECONDS;
}

async function makeRoomId(store: RoomStore): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const id = randomString(6);
    if (!(await store.getRoom(id))) return id;
  }
  // 極小機率碰撞，追加一位便于排查
  throw new Error('暫時無法分配房間號');
}

function resolveName(identityName: string, fallback: unknown): string {
  return (
    cleanText(identityName, MAX_NAME_LENGTH) ||
    cleanText(fallback, MAX_NAME_LENGTH) ||
    '觀眾'
  );
}

function makeDraft(
  type: RoomEvent['type'],
  actorId: string,
  actorName: string,
  text: string
): EventDraft {
  return { type, actorId, actorName, text, at: Date.now() };
}

/** 所有房間核心寫入統一走這裡：遞增版本號，供客戶端判斷是否需要刷新 */
async function saveCore(store: RoomStore, room: WatchRoom): Promise<void> {
  room.rev = (Number.isFinite(room.rev) ? Number(room.rev) : 0) + 1;
  room.lastActiveAt = Date.now();
  await store.saveRoom(room);
}

/** 響應裡永遠只帶裁剪後的名單預覽 + 精確人數，不再推全量成員 */
function toView(
  room: WatchRoom,
  presence: PresenceView,
  seq: number
): WatchRoom {
  return {
    ...room,
    members: presence.members.map((member) => ({
      id: member.id,
      name: member.name,
      joinedAt: member.joinedAt,
      lastSeen: member.lastSeen,
      syncMode: member.syncMode,
    })),
    memberCount: presence.count,
    seq,
  };
}

async function readEvents(
  store: RoomStore,
  roomId: string,
  since: number
): Promise<{ events: RoomEvent[]; latest: number }> {
  const latest = await store.getSeq(roomId);
  // 绝大多數心跳没有新事件：一次輕量 GET/SELECT 即可完全跳過列表讀取
  if (latest <= since) return { events: [], latest };
  const limit = Math.min(EVENT_LIMIT, Math.max(1, latest - since));
  const events = await store.listEvents(roomId, since, limit);
  return { events, latest };
}

function presenceFor(
  store: RoomStore,
  room: WatchRoom,
  extraIds: string[] = []
): Promise<PresenceView> {
  return store.getPresence(room.id, MEMBER_TIMEOUT_MS, MEMBER_PREVIEW_LIMIT, [
    room.hostId,
    ...extraIds,
  ]);
}

/** 批量、原子分配 seq，一次寫完所有事件；大房間批量離線不再逐條往返 */
async function emitDrafts(
  store: RoomStore,
  room: WatchRoom,
  drafts: EventDraft[]
): Promise<void> {
  if (!drafts.length) return;
  await store.appendEvents(room.id, drafts, ttlOf(room));
}

/** 臨時房間房主離線時，把控制權交给最早加入的活跃成員 */
async function transferHostIfNeeded(
  store: RoomStore,
  room: WatchRoom,
  presence: PresenceView,
  drafts: EventDraft[]
): Promise<boolean> {
  if (room.persistent) return false;
  // presenceFor 会把 hostId 放進 preferIds，仍在線就一定出现在預覽裡
  if (presence.members.some((m) => m.id === room.hostId)) return false;
  const next = await store.pickOldestActiveMember(room.id, MEMBER_TIMEOUT_MS);
  if (!next) return false;
  room.hostId = next.id;
  room.hostName = next.name;
  drafts.push(
    makeDraft('system', next.id, next.name, `${next.name} 成為新房主`)
  );
  return true;
}

export async function handleRoomAction(
  input: RoomRequest,
  identity: { name: string; owner?: string },
  selectedStore?: RoomStore
): Promise<RoomResponse> {
  const store = selectedStore || getRoomStore();
  const storeKind = getStoreKind();
  const now = Date.now();
  const action = input?.action;
  const common = { serverTime: now, storeKind };

  if (!identity.owner) return fail('請先登入');
  if (!action) return fail('缺少 action');

  // ---------------------------------------------------------------- create
  if (action === 'create') {
    const name = resolveName(identity.name, input.name);
    if (input.persistent && !identity.owner) {
      return fail('請登入後建立長期觀影室');
    }
    if (input.persistent && identity.owner) {
      const existing = (await cachedListRooms(store)).find(
        (item) => item.owner === identity.owner
      );
      if (existing) {
        return fail('你已經建立過觀影室了，不能重複建立');
      }
    }
    const playPath = cleanText(input.playPath, 1000);
    if (!validPlayPath(playPath)) return fail('播放頁地址無效');

    const id = await makeRoomId(store);
    const memberId = makeMemberId();
    const videoTitle = cleanText(input.title, 100) || '一起看影片';
    const customNameValue = cleanText(input.roomName, 100);
    const roomName = customNameValue || videoTitle;
    // 只有登錄建立的持久房間才可以公開（臨時房間無法在列表中持久展示）
    const publicAtCreate = input.persistent === true && input.isPublic === true;
    // 建立房間只落核心狀態，不預置在線成員：房主 / 成員真正打開播放頁並完成
    // 第一次 sync 心跳後才計入在線人數，避免「房間刚建好、没人連接」却顯示 1 人。
    const room: WatchRoom = {
      id,
      hostId: memberId,
      hostName: name,
      owner: input.persistent ? identity.owner : undefined,
      persistent: input.persistent === true,
      enabled: true,
      isPublic: publicAtCreate,
      publicizedAt: publicAtCreate ? now : undefined,
      title: roomName,
      customName: !!customNameValue,
      videoTitle,
      playPath,
      episode: Number.isFinite(input.episode) ? Number(input.episode) : 1,
      defaultSyncMode: 'auto',
      state: { playing: false, time: 0, updatedAt: now },
      members: [],
      memberCount: 0,
      // 老客户端不传 maxMembers 时由服务端兜底，保证新房间默认就有上限
      maxMembers: resolveCreateCapacity(input.maxMembers),
      seq: 0,
      rev: 1,
      createdAt: now,
      lastActiveAt: now,
    };

    await store.saveRoom(room);
    await emitDrafts(store, room, [
      makeDraft('system', memberId, name, `${name} 建立了房間，等待夥伴加入`),
    ]);
    invalidateRoomsCache();

    const presence = await presenceFor(store, room);
    const { events, latest } = await readEvents(store, id, 0);
    return {
      ok: true,
      room: toView(room, presence, latest),
      events,
      memberId,
      isHost: true,
      memberCount: presence.count,
      mySyncMode: 'auto',
      rev: room.rev,
      ...common,
    };
  }

  if (action === 'hasPersistentRoom') {
    if (!identity.owner) return { ok: true, ...common };
    const rooms = await cachedListRooms(store);
    const room = rooms.find((item) => item.owner === identity.owner);
    if (!room) return { ok: true, ...common };
    // 房间核心里的 memberCount 只是房主心跳异步回写的快照：上次连接断开后
    // 没人再心跳，它不会自动归零，可能永远停在 1。播放页的「我的观影室」
    // 卡片只读这个接口，若直接透传快照就会出现「没加入却显示 1 人在线」。
    // 这里按 presence 实时统计覆盖，口径与 myRooms / publicRooms 一致。
    const [count] = await liveCountsFor(store, [room]);
    return {
      ok: true,
      room: { ...room, memberCount: count },
      ...common,
    };
  }

  if (action === 'myRooms') {
    if (!identity.owner) return fail('請登入後查看自己的觀影室');
    const source =
      input.fresh === true
        ? await freshListRooms(store, now)
        : await cachedListRooms(store);
    const rooms = source.filter((room) => room.owner === identity.owner);
    const counts = await liveCountsFor(store, rooms);
    return {
      ok: true,
      rooms: rooms.map((room, index) => ({
        ...room,
        memberCount: counts[index],
      })),
      ...common,
    };
  }

  // 公開大厅：只回傳展示所需字段，不暴露 owner、事件序號、成員明細。
  // 在線人數按 presence 實時統計（已進入房間且心跳未超時的連接數），
  // 不再依赖核心裡由房主心跳異步回寫的快照，保證刷新後拿到真實人數。
  if (action === 'publicRooms') {
    const source =
      input.fresh === true
        ? await freshListRooms(store, now)
        : await cachedListRooms(store);
    const listed = source
      .filter((room) => room.isPublic === true && room.enabled !== false)
      .sort((a, b) => (b.publicizedAt || 0) - (a.publicizedAt || 0));
    const counts = await liveCountsFor(store, listed);
    const rooms = listed.map(
      (room, index): WatchRoom => ({
        id: room.id,
        hostId: '',
        hostName: room.hostName,
        persistent: true,
        enabled: true,
        isPublic: true,
        publicizedAt: room.publicizedAt,
        title: room.title,
        customName: room.customName,
        videoTitle: room.videoTitle,
        playPath: room.playPath,
        episode: room.episode,
        defaultSyncMode: room.defaultSyncMode,
        state: {
          playing: false,
          time: 0,
          updatedAt: room.state?.updatedAt || now,
        },
        members: [],
        memberCount: counts[index],
        maxMembers: normalizeCapacity(room.maxMembers),
        seq: 0,
        rev: room.rev,
        createdAt: room.createdAt,
        lastActiveAt: room.lastActiveAt,
      })
    );
    return { ok: true, rooms, ...common };
  }

  // 公開 / 取消公開：僅建立者可以操作，且僅限持久觀影室。
  if (action === 'setPublic') {
    if (!identity.owner) return fail('請登入後設定觀影室公開狀態');
    if (!isRoomId(input.roomId)) return fail('房間號無效');
    const room = await store.getRoom(input.roomId);
    if (!room) return fail('房間不存在或已刪除');
    if (!room.persistent || room.owner !== identity.owner) {
      return fail('只有建立者可以設定此觀影室');
    }
    const nextPublic = input.public === true;
    if (nextPublic && room.enabled === false) {
      return fail('請先開啟觀影室再公開');
    }
    room.isPublic = nextPublic;
    room.publicizedAt = nextPublic ? now : undefined;
    await saveCore(store, room);
    invalidateRoomsCache();

    const presence = await presenceFor(store, room);
    const latest = await store.getSeq(room.id);
    return {
      ok: true,
      room: toView(room, presence, latest),
      memberCount: presence.count,
      rev: room.rev,
      ...common,
    };
  }

  if (action === 'close') {
    if (!identity.owner) return fail('請登入後關閉觀影室');
    if (!isRoomId(input.roomId)) return fail('房間號無效');
    const room = await store.getRoom(input.roomId);
    if (!room) return fail('房間不存在或已刪除');
    if (!room.persistent || room.owner !== identity.owner) {
      return fail('只有建立者可以關閉此觀影室');
    }
    room.enabled = false;
    room.isPublic = false;
    room.publicizedAt = undefined;
    await saveCore(store, room);
    invalidateRoomsCache();
    return { ok: true, room, ...common };
  }

  if (action === 'delete') {
    if (!identity.owner) return fail('請登入後刪除觀影室');
    if (!isRoomId(input.roomId)) return fail('房間號無效');
    const room = await store.getRoom(input.roomId);
    if (!room) return fail('房間不存在或已刪除');
    if (!room.persistent || room.owner !== identity.owner) {
      return fail('只有建立者可以刪除此觀影室');
    }
    invalidateRoomsCache();
    await store.deleteRoom(room.id);
    return { ok: true, ...common };
  }

  if (action === 'enterOwned' || action === 'activateOwned') {
    if (!identity.owner) return fail('請登入後進入自己的觀影室');
    if (!isRoomId(input.roomId)) return fail('房間號無效');
    const room = await store.getRoom(input.roomId);
    if (!room?.persistent || room.owner !== identity.owner) {
      return fail('觀影室不存在或不屬於目前帳號');
    }
    const name = resolveName(
      identity.name,
      action === 'enterOwned' ? input.name : room.hostName
    );
    // 房主回到自己的房间不受人数上限限制：满员时也应能重新接管，
    // 否则房主会被自己设置的容量挡在门外。
    let member = await store.getMember(room.id, room.hostId);
    let memberId: string;
    const drafts: EventDraft[] = [];

    if (!member) {
      memberId = makeMemberId();
      member = {
        id: memberId,
        account: identity.owner,
        name,
        joinedAt: now,
        lastSeen: now,
        syncMode: normalizeSyncMode(room.defaultSyncMode || 'auto'),
      };
      room.hostId = memberId;
      room.hostName = name;
      drafts.push(
        makeDraft('system', memberId, name, `${name} 作為房主重新進入觀影室`)
      );
    } else {
      memberId = member.id;
      member.name = name;
      member.lastSeen = now;
      member.syncMode = normalizeSyncMode(
        member.syncMode ?? room.defaultSyncMode ?? 'auto'
      );
      room.hostName = name;
    }
    await store.putMember(room.id, member, ttlOf(room));
    room.enabled = true;
    await saveCore(store, room);
    await emitDrafts(store, room, drafts);
    invalidateRoomsCache();

    const presence = await presenceFor(store, room, [memberId]);
    const { events, latest } = await readEvents(store, room.id, 0);
    return {
      ok: true,
      room: toView(room, presence, latest),
      events,
      memberId,
      isHost: true,
      memberCount: presence.count,
      mySyncMode: member.syncMode,
      rev: room.rev,
      ...common,
    };
  }

  // ------------------------------------------------------------------ join
  if (action === 'join') {
    if (!isRoomId(input.roomId)) return fail('房間號無效');
    const room = await store.getRoom(input.roomId);
    if (!room) return fail('房間不存在或已解散');
    if (room.enabled === false) {
      return fail('觀影室已關閉，重新開啟後才可繼續使用');
    }
    // 房主手动输自己的房间号也会走 join。以前这里一律新建普通成员：既会
    // 被人数上限挡在门外，又会在下一轮 sync 触发重接管、留下占名额的僵尸记录。
    // 现在识别创建者账号，直接复用 hostId 并豁免容量校验。
    const isOwner = !!(
      room.persistent &&
      room.owner &&
      identity.owner === room.owner
    );
    if (!isOwner) {
      // 新建成员前先按实时在线人数卡上限，满了直接拒绝，不写入任何 presence
      const blocked = await capacityBlock(store, room, now);
      if (blocked) return blocked;
    }

    const name = resolveName(identity.name, input.name);
    const memberId = isOwner && room.hostId ? room.hostId : makeMemberId();
    // 正常房间创建时 hostId 一定非空；这里只为异常/迁移数据兜底，避免
    // 房主进房后 isHost 判定与后续 sync 的 hostId 对不上。
    if (isOwner && !room.hostId) {
      room.hostId = memberId;
      room.hostName = name;
    }
    const existing = isOwner ? await store.getMember(room.id, memberId) : null;
    const member: RoomMember = {
      id: memberId,
      account: identity.owner,
      name,
      joinedAt: Number(existing?.joinedAt) || now,
      lastSeen: now,
      syncMode: normalizeSyncMode(
        existing?.syncMode ?? room.defaultSyncMode ?? 'auto'
      ),
    };
    await store.putMember(room.id, member, ttlOf(room));
    await emitDrafts(store, room, [
      makeDraft(
        'system',
        memberId,
        name,
        isOwner ? `${name} 作為房主進入觀影室` : `${name} 加入了房間`
      ),
    ]);
    const presence = await presenceFor(store, room, [memberId]);
    room.memberCount = presence.count;
    await saveCore(store, room);
    invalidateRoomsCache();

    const { events, latest } = await readEvents(store, room.id, 0);
    return {
      ok: true,
      room: toView(room, presence, latest),
      events,
      memberId,
      isHost: isOwner,
      memberCount: presence.count,
      mySyncMode: member.syncMode,
      rev: room.rev,
      ...common,
    };
  }

  // -------------------------------------------------------------- 公共校驗
  if (!isRoomId((input as any).roomId)) return fail('房間號無效');
  const roomId = (input as any).roomId as string;
  const room = await store.getRoom(roomId);
  if (!room) return fail('房間不存在或已解散');
  // 關閉 / 刪除 / 重新開啟 / 公開設定均在前面的分支處理並直接 return，
  // 走到這裡的只可能是成員側動作，因此關閉的房間一律拒绝。
  if (room.enabled === false) {
    return fail('觀影室已關閉，重新開啟後才可繼續使用');
  }

  // ---------------------------------------------------------------- sync
  if (action === 'sync') {
    const drafts: EventDraft[] = [];
    let memberId = cleanText(input.memberId, 64);
    let member = memberId ? await store.getMember(roomId, memberId) : null;
    if (member && member.account !== identity.owner)
      return fail('成員身分不符');
    // 元數據 key 的 TTL 比離線判定宽，在線標記已清掉時要当作未入房處理
    if (member && now - (member.lastSeen || 0) > MEMBER_TIMEOUT_MS) {
      member = null;
    }
    let rejoined = false;
    // 提前声明：房主重接管会改 hostId / hostName，必须能在这里标脏。否则刚进
    // 播放页、播放器尚未 ready（无 local 上报）且人数没变的前几轮根本不落盘，
    // 下一轮读到的还是旧 hostId，于是每轮都重接管、事件刷屏。
    let coreChanged = false;

    // 持久房间创建者重新接管房主身份。
    // 同一账号的多标签页 / 多设备互相读不到对方的 memberId（sessionStorage
    // 按标签页隔离），若一上来就无条件抢占 hostId，两个连接会按轮询节奏
    // 交替互踢。因此只有「旧房主确认离线」才真正接管；仍在线时直接复用
    // 当前 hostId，让多个连接共用同一房主席位。
    if (room.persistent && room.owner && identity.owner === room.owner) {
      if (!member || member.id !== room.hostId) {
        const hostMember = room.hostId
          ? await store.getMember(roomId, room.hostId)
          : null;
        const hostLastSeen = Number(hostMember?.lastSeen) || 0;
        const hostOnline =
          !!hostMember &&
          hostMember.account === identity.owner &&
          hostLastSeen > 0 &&
          now - hostLastSeen <= MEMBER_TIMEOUT_MS;

        if (hostOnline && room.hostId && hostMember) {
          // 复用房主席位：不删在线记录、不改 hostId、不刷「加入了房間」。
          // 两个连接共用同一 memberId 时 presence 只算 1 人，任一方心跳续期。
          const staleId = cleanText(input.memberId, 64);
          if (staleId && staleId !== room.hostId) {
            // 本次连接已放弃这个旧 id，直接清掉，避免它白占一个名额 20 秒。
            // 共用同一旧 id 的其他连接下一轮同样会复用 hostId，删除是安全的。
            await store.removeMember(roomId, staleId);
          }
          memberId = room.hostId;
          member = hostMember;
          member.name = resolveName(identity.name, input.name);
        } else {
          // 旧房主确认离线（或记录已失效）才接管
          const oldHostId = room.hostId;
          memberId = makeMemberId();
          member = {
            id: memberId,
            account: identity.owner,
            name: resolveName(identity.name, input.name),
            joinedAt: now,
            lastSeen: now,
            syncMode: normalizeSyncMode(room.defaultSyncMode ?? 'auto'),
          };
          if (oldHostId && oldHostId !== memberId) {
            await store.removeMember(roomId, oldHostId);
          }
          room.hostId = memberId;
          room.hostName = member.name;
          coreChanged = true;
          rejoined = true;
        }
      }
    } else if (room.persistent && room.owner) {
      // 只能由持久房間建立帳號掌控房主身份，普通成員不能繼承離線房主權限。
      if (memberId === room.hostId && !member) memberId = '';
    }

    // 自愈：房间重启 / 存储换实例后，旧的 memberId 可能已失效。
    // 邀请链接自动入房走的也是这条路径，所以必须在重新分配成员 id 之前
    // 卡一次容量，否则被拒绝的用户下一轮心跳又会悄悄挤进房间。
    // 前面「持久房间创建者重新接管房主身份」的分支不受此限制，房主永远
    // 能回到自己的房间。
    if (!member) {
      const blocked = await capacityBlock(
        store,
        room,
        now,
        memberId || undefined
      );
      if (blocked) return blocked;
      memberId = makeMemberId();
      member = {
        id: memberId,
        account: identity.owner,
        name: resolveName(identity.name, input.name),
        joinedAt: now,
        lastSeen: now,
        syncMode: normalizeSyncMode(room.defaultSyncMode ?? 'auto'),
      };
      rejoined = true;
    }

    member.lastSeen = now;
    member.syncMode = normalizeSyncMode(
      member.syncMode ?? room.defaultSyncMode ?? 'auto'
    );
    // 每個成員只寫自己那一條小記錄，不再重寫整份房間對象
    await store.putMember(roomId, member, ttlOf(room));

    // 一次讀取完成：超時清掃 + 精確人數 + 裁剪後的名單預覽
    const presence = await presenceFor(store, room, [memberId]);

    const normalizedDefault = normalizeSyncMode(room.defaultSyncMode ?? 'auto');
    if (room.defaultSyncMode !== normalizedDefault) {
      room.defaultSyncMode = normalizedDefault;
      coreChanged = true;
    }

    // 臨時房間房主離線時移交控制權
    if (await transferHostIfNeeded(store, room, presence, drafts)) {
      coreChanged = true;
    }
    const isHost = room.hostId === memberId;

    // 人數變化主要由房主心跳持久化，其他實例低頻兜底，避免 N 個成員同時抢寫核心
    if (
      presence.count !== (Number(room.memberCount) || 0) &&
      (isHost || allowCountRefresh(room.id, now))
    ) {
      room.memberCount = presence.count;
      coreChanged = true;
    }

    if (rejoined) {
      drafts.push(
        makeDraft('system', memberId, member.name, `${member.name} 加入了房間`)
      );
    }

    // 超時離開聚合為一條系統提示；大房間散场時不会生成 N 條事件。
    // 只讓房主上报，避免多實例並發清掃產生重複提示。
    if (presence.removed > 0 && isHost) {
      drafts.push(
        makeDraft(
          'system',
          '',
          '',
          presence.removed === 1
            ? '有 1 位觀眾離開了房間'
            : `有 ${presence.removed} 位觀眾離開了房間`
        )
      );
    }

    if (isHost) {
      // 房主心跳：以房主播放器為准，成員不做權威上报
      if (input.local) {
        room.state = {
          time: safeTime(input.local.time),
          playing: !!input.local.playing,
          updatedAt: now,
        };
        coreChanged = true;
      }
      const playPath = cleanText(input.playPath, 1000);
      const nextVideoTitle = cleanText(input.title, 100);
      const pathChanged = validPlayPath(playPath) && playPath !== room.playPath;
      if (pathChanged) {
        room.playPath = playPath;
        coreChanged = true;
      }
      if (nextVideoTitle && nextVideoTitle !== room.videoTitle) {
        room.videoTitle = nextVideoTitle;
        if (room.customName !== true) room.title = nextVideoTitle;
        coreChanged = true;
      }
      if (pathChanged && Number.isFinite(input.episode)) {
        room.episode = Number(input.episode);
        drafts.push(
          makeDraft(
            'control',
            memberId,
            member.name,
            `房主切換了影片《${room.videoTitle || room.title}》第 ${
              room.episode
            } 集`
          )
        );
      }
    }

    if (coreChanged) await saveCore(store, room);
    await emitDrafts(store, room, drafts);

    const since = Number.isFinite(input.since)
      ? Math.max(0, Math.floor(input.since))
      : 0;
    const { events, latest } = await readEvents(store, roomId, since);

    const currentRev = Number.isFinite(room.rev) ? Number(room.rev) : 0;
    // 用 typeof 收窄成 number（Number.isFinite 不做类型收窄），既避免非空斷言，
    // 也顺手挡掉字符串等非法输入。
    const rawRev = input.rev;
    const rawCount = input.memberCount;
    const clientRev =
      typeof rawRev === 'number' && Number.isFinite(rawRev)
        ? Math.max(0, Math.floor(rawRev))
        : -1;
    const clientCount =
      typeof rawCount === 'number' && Number.isFinite(rawCount)
        ? Math.max(0, Math.floor(rawCount))
        : -1;
    // 老客戶端不帶 rev / memberCount，一律回傳完整（但仍是裁剪過的）快照
    const unchanged =
      clientRev >= 0 &&
      clientRev === currentRev &&
      clientCount === presence.count &&
      events.length === 0;

    if (unchanged) {
      return {
        ok: true,
        events: [],
        memberId,
        isHost,
        memberCount: presence.count,
        mySyncMode: member.syncMode,
        rev: currentRev,
        unchanged: true,
        ...common,
      };
    }

    return {
      ok: true,
      room: toView(room, presence, latest),
      events,
      memberId,
      isHost,
      memberCount: presence.count,
      mySyncMode: member.syncMode,
      rev: currentRev,
      ...common,
    };
  }

  // -------------------------------------------------------------- setSyncMode
  if (action === 'setSyncMode') {
    const member = await store.getMember(roomId, cleanText(input.memberId, 64));
    if (!member || member.account !== identity.owner)
      return fail('請先加入房間');

    const nextMode = normalizeSyncMode(input.syncMode);
    member.syncMode = nextMode;
    member.lastSeen = now;
    await store.putMember(roomId, member, ttlOf(room));

    const drafts: EventDraft[] = [];
    let coreChanged = false;
    if (room.hostId === member.id) {
      if (room.defaultSyncMode !== nextMode) {
        room.defaultSyncMode = nextMode;
        coreChanged = true;
      }
      drafts.push(
        makeDraft(
          'control',
          member.id,
          member.name,
          `房主將默認同步模式切換為${
            nextMode === 'manual' ? '手動同步' : '自動同步'
          }`
        )
      );
    } else {
      drafts.push(
        makeDraft(
          'control',
          member.id,
          member.name,
          `${member.name} 將自己的同步模式切換為${
            nextMode === 'manual' ? '手動同步' : '自動同步'
          }`
        )
      );
    }
    if (coreChanged) await saveCore(store, room);
    await emitDrafts(store, room, drafts);

    const presence = await presenceFor(store, room, [member.id]);
    const latest = await store.getSeq(roomId);
    return {
      ok: true,
      room: toView(room, presence, latest),
      events: [],
      isHost: room.hostId === member.id,
      memberCount: presence.count,
      mySyncMode: nextMode,
      rev: Number(room.rev) || 0,
      ...common,
    };
  }

  // --------------------------------------------------------------- control
  if (action === 'control') {
    const member = await store.getMember(roomId, cleanText(input.memberId, 64));
    if (!member || member.account !== identity.owner)
      return fail('請先加入房間');
    if (room.hostId !== member.id) return fail('僅房主可以控制播放');

    room.state = {
      time: safeTime(input.time),
      playing: !!input.playing,
      updatedAt: now,
    };
    await saveCore(store, room);

    const verb: Record<string, string> = {
      play: '開始播放',
      pause: '暫停了播放',
      seek: '拖動了進度',
      episode: '切換了劇集',
    };
    await emitDrafts(store, room, [
      makeDraft(
        'control',
        member.id,
        member.name,
        `${member.name} ${verb[input.kind] || '調整了播放'}`
      ),
    ]);

    // 控制動作不需要回傳房間快照，下一次 sync 自然会帶上最新狀態
    return {
      ok: true,
      events: [],
      isHost: true,
      rev: Number(room.rev) || 0,
      ...common,
    };
  }

  // ------------------------------------------------------------------ chat
  if (action === 'chat') {
    const member = await store.getMember(roomId, cleanText(input.memberId, 64));
    if (!member || member.account !== identity.owner)
      return fail('請先加入房間');
    const text = cleanText(input.text, MAX_MESSAGE_LENGTH);
    if (!text) return fail('訊息不能為空');
    // 大房間的訊息风暴保护：同一成員短時間内只允许一條
    if (member.lastChatAt && now - member.lastChatAt < CHAT_COOLDOWN_MS) {
      return fail('發送太快了，請稍後再試');
    }

    member.lastChatAt = now;
    member.lastSeen = now;
    await store.putMember(roomId, member, ttlOf(room));
    await emitDrafts(store, room, [
      makeDraft('chat', member.id, member.name, text),
    ]);

    return {
      ok: true,
      events: [],
      isHost: room.hostId === member.id,
      ...common,
    };
  }

  // ----------------------------------------------------------------- leave
  if (action === 'leave') {
    const member = await store.getMember(roomId, cleanText(input.memberId, 64));
    if (!member) return { ok: true, ...common };
    if (member.account !== identity.owner) return fail('成員身分不符');

    // 房主可能与同一账号的其他标签页 / 设备共用 hostId（见 sync 的席位复用）。
    // 服务端无从判断还有几个连接在用这个 id，因此房主主动离开时保留在线记录，
    // 让它随心跳超时自然清扫，避免关掉一个标签页把其他连接一起注销。
    if (room.persistent && member.id === room.hostId) {
      const presence = await presenceFor(store, room);
      room.memberCount = presence.count;
      await saveCore(store, room);
      return { ok: true, ...common };
    }

    await store.removeMember(roomId, member.id);
    const presence = await presenceFor(store, room);

    if (presence.count === 0) {
      if (room.persistent) {
        room.memberCount = 0;
        await saveCore(store, room);
      } else {
        invalidateRoomsCache();
        await store.deleteRoom(roomId);
      }
      return { ok: true, ...common };
    }

    const drafts: EventDraft[] = [
      makeDraft('system', member.id, member.name, `${member.name} 離開了房間`),
    ];
    await transferHostIfNeeded(store, room, presence, drafts);
    room.memberCount = presence.count;
    await emitDrafts(store, room, drafts);
    await saveCore(store, room);

    return { ok: true, ...common };
  }

  return fail('未知的 action');
}
