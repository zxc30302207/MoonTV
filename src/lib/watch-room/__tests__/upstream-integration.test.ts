/** @jest-environment node */
import { handleRoomAction } from '../service';
import { MemoryRoomStore } from '../store';
import {
  DEFAULT_ROOM_CAPACITY,
  MAX_ROOM_CAPACITY,
  MEMBER_TIMEOUT_MS,
  normalizeCapacity,
  resolveCreateCapacity,
} from '../types';

const owner = { name: 'Owner', owner: 'owner' };
const guest = { name: 'Guest', owner: 'guest' };
const create = {
  action: 'create' as const,
  name: 'Owner',
  title: 'Film',
  playPath: '/play?source=normal&id=1',
  episode: 1,
  persistent: true,
  isPublic: true,
};

describe('watch room upstream capacity and host continuity', () => {
  let store: MemoryRoomStore;
  let now: number;
  beforeEach(() => {
    store = new MemoryRoomStore(new Map());
    now = 1_800_000_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
  });
  afterEach(() => jest.restoreAllMocks());

  async function room(maxMembers?: number) {
    const response = await handleRoomAction(
      { ...create, maxMembers },
      owner,
      store
    );
    expect(response.ok).toBe(true);
    if (!response.room) throw new Error('Expected created room');
    return response.room.id;
  }
  async function sync(roomId: string, memberId = '', identity = owner) {
    return handleRoomAction(
      { action: 'sync', roomId, memberId, since: 0 },
      identity,
      store
    );
  }

  it.each([undefined, null, '', 0, -1, NaN, Infinity, 'bad'])(
    'defaults new capacity for %p but leaves legacy capacity unset',
    (value) => {
      expect(normalizeCapacity(value)).toBeUndefined();
      expect(resolveCreateCapacity(value)).toBe(DEFAULT_ROOM_CAPACITY);
    }
  );
  it('rounds and clamps valid capacities', () => {
    expect(resolveCreateCapacity('3.9')).toBe(3);
    expect(resolveCreateCapacity(1)).toBe(1);
    expect(resolveCreateCapacity(1000)).toBe(MAX_ROOM_CAPACITY);
  });
  it.each([undefined, 0, 3, 999])(
    'stores normalized creation capacity %p and exposes it in public lists',
    async (input) => {
      const id = await room(input);
      expect((await store.getRoom(id))?.maxMembers).toBe(
        resolveCreateCapacity(input)
      );
      const listed = await handleRoomAction(
        { action: 'publicRooms' },
        guest,
        store
      );
      expect(listed.rooms?.[0].maxMembers).toBe(resolveCreateCapacity(input));
    }
  );
  it('rejects both direct join and repeated invite sync when full without adding presence', async () => {
    const id = await room(1);
    await sync(id);
    const before = store.snapshot()[0][1].members.length;
    const joined = await handleRoomAction(
      { action: 'join', roomId: id, name: 'Guest' },
      guest,
      store
    );
    expect(joined.ok).toBe(false);
    expect(joined.error).toContain('已滿');
    for (let i = 0; i < 2; i++)
      expect((await sync(id, '', guest)).ok).toBe(false);
    expect(store.snapshot()[0][1].members).toHaveLength(before);
  });
  it('allows an existing member to sync at capacity', async () => {
    const id = await room(1);
    const joined = await handleRoomAction(
      { action: 'join', roomId: id, name: 'Guest' },
      guest,
      store
    );
    expect((await sync(id, joined.memberId, guest)).ok).toBe(true);
    expect((await store.getPresence(id, MEMBER_TIMEOUT_MS, 10)).count).toBe(1);
  });
  it('does not revive a stale guest into an already full room', async () => {
    const id = await room(1);
    const joined = await handleRoomAction(
      { action: 'join', roomId: id, name: 'Guest' },
      guest,
      store
    );
    now += MEMBER_TIMEOUT_MS + 1;
    // Simulate a backend retaining expired member metadata while another seat is active.
    const stale = await store.getMember(id, joined.memberId || '');
    if (!stale) throw new Error('Expected stale member metadata');
    const fresh = {
      ...stale,
      id: 'fresh-member',
      account: 'fresh',
      lastSeen: now,
    };
    const snapshot = store.snapshot();
    snapshot[0][1].members.push([fresh.id, fresh]);
    store.replace(snapshot);
    expect((await sync(id, joined.memberId, guest)).ok).toBe(false);
    expect((await store.getPresence(id, MEMBER_TIMEOUT_MS, 10)).count).toBe(1);
  });
  it('allows owners to return to full rooms and reuses their seat on repeated joins', async () => {
    const id = await room(1);
    await handleRoomAction(
      { action: 'join', roomId: id, name: 'Guest' },
      guest,
      store
    );
    const first = await handleRoomAction(
      { action: 'join', roomId: id, name: 'Owner' },
      owner,
      store
    );
    const second = await handleRoomAction(
      { action: 'join', roomId: id, name: 'Owner' },
      owner,
      store
    );
    expect(first.isHost).toBe(true);
    expect(second.memberId).toBe(first.memberId);
    expect(second.memberCount).toBe(2);
    expect((await sync(id)).memberId).toBe(first.memberId);
  });
  it.each(['activateOwned', 'enterOwned'] as const)(
    'exempts %s from room capacity',
    async (action) => {
      const id = await room(1);
      await handleRoomAction(
        { action: 'join', roomId: id, name: 'Guest' },
        guest,
        store
      );
      const result = await handleRoomAction(
        { action, roomId: id, name: owner.name },
        owner,
        store
      );
      expect(result.ok).toBe(true);
      expect(result.isHost).toBe(true);
    }
  );
  it('does not impose the new default on legacy rooms', async () => {
    const id = await room();
    const legacy = await store.getRoom(id);
    if (!legacy) throw new Error('Expected legacy room');
    delete legacy.maxMembers;
    await store.saveRoom(legacy);
    for (let i = 0; i <= DEFAULT_ROOM_CAPACITY; i++) {
      const identity = { name: `Guest ${i}`, owner: `guest-${i}` };
      expect(
        (
          await handleRoomAction(
            { action: 'join', roomId: id, name: identity.name },
            identity,
            store
          )
        ).ok
      ).toBe(true);
    }
    expect((await store.getRoom(id))?.maxMembers).toBeUndefined();
  });
  it.each([100, undefined])(
    'reserves an offline owner seat at the storage bound for capacity %p',
    async (capacity) => {
      const id = await room(100);
      if (capacity === undefined) {
        const legacy = await store.getRoom(id);
        if (!legacy) throw new Error('Expected legacy room');
        delete legacy.maxMembers;
        await store.saveRoom(legacy);
      }
      for (let i = 0; i < 99; i++) {
        await store.putMember(
          id,
          {
            id: `guest-${i}`,
            account: `guest-${i}`,
            name: `Guest ${i}`,
            joinedAt: now,
            lastSeen: now,
            syncMode: 'auto',
          },
          0
        );
      }
      const blocked = await handleRoomAction(
        { action: 'join', roomId: id, name: 'Guest' },
        guest,
        store
      );
      expect(blocked.ok).toBe(false);
      expect((await sync(id, '', guest)).ok).toBe(false);
      const returned = await sync(id);
      expect(returned.ok).toBe(true);
      expect(returned.isHost).toBe(true);
      expect(returned.memberCount).toBe(100);
      expect((await store.getPresence(id, MEMBER_TIMEOUT_MS, 100)).count).toBe(
        100
      );
    }
  );
  it('shares an online host seat across tabs without takeover events', async () => {
    const id = await room();
    const first = await sync(id);
    const seq = await store.getSeq(id);
    const second = await sync(id);
    const third = await sync(id, first.memberId);
    expect(second.memberId).toBe(first.memberId);
    expect(third.memberId).toBe(first.memberId);
    expect(third.memberCount).toBe(1);
    expect(await store.getSeq(id)).toBe(seq);
    expect((await store.getMember(id, first.memberId || ''))?.account).toBe(
      owner.owner
    );
  });
  it('persists offline host takeover without a player report even when count is unchanged', async () => {
    const id = await room();
    const first = await sync(id);
    now += MEMBER_TIMEOUT_MS * 3;
    const second = await sync(id);
    expect(second.memberId).not.toBe(first.memberId);
    expect((await store.getRoom(id))?.hostId).toBe(second.memberId);
    expect((await store.getMember(id, second.memberId || ''))?.account).toBe(
      owner.owner
    );
    const seq = await store.getSeq(id);
    expect((await sync(id, second.memberId)).memberId).toBe(second.memberId);
    expect(await store.getSeq(id)).toBe(seq);
  });
  it('leaves a shared host seat alive when another tab leaves', async () => {
    const id = await room();
    const first = await sync(id);
    const result = await handleRoomAction(
      { action: 'leave', roomId: id, memberId: first.memberId || '' },
      owner,
      store
    );
    expect(result.ok).toBe(true);
    expect(await store.getMember(id, first.memberId || '')).not.toBeNull();
    expect((await sync(id, first.memberId)).memberId).toBe(first.memberId);
  });
  it('counts saved-room presence live without activating the owner', async () => {
    const id = await room();
    const first = await sync(id);
    expect((await store.getRoom(id))?.memberCount).toBe(1);
    now += MEMBER_TIMEOUT_MS + 1;
    const response = await handleRoomAction(
      { action: 'hasPersistentRoom' },
      owner,
      store
    );
    expect(response.room?.memberCount).toBe(0);
    expect(await store.getMember(id, first.memberId || '')).toBeNull();
  });
  it('rejects account impersonation and never removes another account while reclaiming a host seat', async () => {
    const id = await room();
    const first = await sync(id);
    const joined = await handleRoomAction(
      { action: 'join', roomId: id, name: 'Guest' },
      guest,
      store
    );
    expect((await sync(id, first.memberId, guest)).ok).toBe(false);
    expect((await sync(id, joined.memberId, owner)).ok).toBe(false);
    expect((await store.getMember(id, joined.memberId || ''))?.account).toBe(
      guest.owner
    );
    expect((await store.getRoom(id))?.hostId).toBe(first.memberId);
  });
});
