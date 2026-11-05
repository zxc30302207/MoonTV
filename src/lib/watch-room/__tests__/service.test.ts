/** @jest-environment node */
import { accessibleStore, validPlayPath } from '../access';
import { handleRoomAction } from '../service';
import { MemoryRoomStore } from '../store';

const alice = { name: 'Alice', owner: 'alice' };
const bob = { name: 'Bob', owner: 'bob' };
const create = {
  action: 'create' as const,
  name: 'spoof',
  title: 'Film',
  playPath: '/play?source=normal&id=1',
  episode: 1,
  persistent: true,
  isPublic: true,
};

describe('watch room account isolation', () => {
  let store: MemoryRoomStore;
  beforeEach(() => {
    store = new MemoryRoomStore(new Map());
  });
  it('rejects anonymous callers and binds names to verified account', async () => {
    expect((await handleRoomAction(create, { name: '' }, store)).ok).toBe(
      false
    );
    const room = await handleRoomAction(create, alice, store);
    expect(room.room?.hostName).toBe('Alice');
  });
  it('rejects stolen host member IDs for all member mutations', async () => {
    const created = await handleRoomAction(create, alice, store);
    const roomId = created.room?.id || '';
    const synced = await handleRoomAction(
      { action: 'sync', roomId, memberId: created.memberId || '', since: 0 },
      alice,
      store
    );
    const memberId = synced.memberId || '';
    expect(synced.isHost).toBe(true);
    expect(synced.room?.members[0]).not.toHaveProperty('account');
    for (const request of [
      { action: 'sync' as const, roomId, memberId, since: 0 },
      {
        action: 'control' as const,
        roomId,
        memberId,
        kind: 'play' as const,
        time: 2,
        playing: true,
      },
      {
        action: 'setSyncMode' as const,
        roomId,
        memberId,
        syncMode: 'manual' as const,
      },
      { action: 'chat' as const, roomId, memberId, text: 'spoof' },
      { action: 'leave' as const, roomId, memberId },
    ])
      expect((await handleRoomAction(request, bob, store)).ok).toBe(false);
    expect((await store.getRoom(roomId))?.state.playing).toBe(false);
  });
  it('filters restricted rooms from lobby, direct join and writes', async () => {
    const created = await handleRoomAction(create, alice, store);
    const restricted = accessibleStore(store, () => false);
    expect(
      (await handleRoomAction({ action: 'publicRooms' }, bob, restricted)).rooms
    ).toEqual([]);
    expect(
      (
        await handleRoomAction(
          { action: 'join', roomId: created.room?.id || '', name: 'Bob' },
          bob,
          restricted
        )
      ).ok
    ).toBe(false);
    await expect(handleRoomAction(create, bob, restricted)).rejects.toThrow(
      '播放來源未授權'
    );
  });
  it('allows guest chat but prevents ownership actions', async () => {
    const created = await handleRoomAction(create, alice, store);
    const roomId = created.room?.id || '';
    const guest = await handleRoomAction(
      { action: 'join', roomId, name: 'Fake' },
      bob,
      store
    );
    expect(
      (
        await handleRoomAction(
          {
            action: 'chat',
            roomId,
            memberId: guest.memberId || '',
            text: 'hello',
          },
          bob,
          store
        )
      ).ok
    ).toBe(true);
    expect(
      (await handleRoomAction({ action: 'delete', roomId }, bob, store)).ok
    ).toBe(false);
    const lobby = await handleRoomAction({ action: 'publicRooms' }, bob, store);
    expect(lobby.rooms?.[0]).not.toHaveProperty('owner');
    expect(lobby.rooms?.[0].members).toEqual([]);
  });
  it('allows a new member after a full room becomes stale', async () => {
    const created = await handleRoomAction(create, alice, store);
    const roomId = created.room?.id || '';
    for (let i = 0; i < 100; i++)
      await store.putMember(
        roomId,
        {
          id: `member-${i}`,
          account: 'old',
          name: 'Old',
          joinedAt: Date.now(),
          lastSeen: Date.now(),
          syncMode: 'auto',
        },
        0
      );
    const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 30_000);
    try {
      const joined = await handleRoomAction(
        { action: 'join', roomId, name: 'Bob' },
        bob,
        store
      );
      expect(joined.ok).toBe(true);
      expect(joined.memberCount).toBe(1);
    } finally {
      clock.mockRestore();
    }
  });
  it('only permits an exact local playback route', () => {
    for (const path of ['/play', '/play?source=a&id=1'])
      expect(validPlayPath(path)).toBe(true);
    for (const path of [
      '//evil.test/play',
      '/playevil',
      '/play/../admin',
      '/play#x',
      'https://evil.test/play',
    ])
      expect(validPlayPath(path)).toBe(false);
  });
});
