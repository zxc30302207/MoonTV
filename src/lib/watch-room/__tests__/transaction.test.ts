/** @jest-environment node */
import { createClient } from '@supabase/supabase-js';

import { handleRoomAction } from '../service';
import { roomTransaction } from '../transaction';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));
const mockedCreateClient = createClient as jest.Mock;

describe('Supabase room transaction', () => {
  const env = process.env;
  beforeEach(() => {
    process.env = {
      ...env,
      NEXT_PUBLIC_STORAGE_TYPE: 'supabase',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-only',
    };
  });
  afterEach(() => {
    process.env = env;
    jest.clearAllMocks();
  });
  function client(conflicts = 0) {
    let state: unknown = null;
    const filters: [string, unknown][] = [];
    const from = jest.fn(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: state ? { value: JSON.parse(JSON.stringify(state)) } : null,
            error: null,
          }),
        }),
      }),
      insert: async (row: { value: unknown }) => {
        state = row.value;
        return { error: null };
      },
      update: (row: { value: unknown }) => {
        const query = {
          eq: (key: string, value: unknown) => {
            filters.push([key, value]);
            return query;
          },
          select: async () => {
            if (conflicts-- > 0) return { data: [], error: null };
            state = row.value;
            return { data: [{ key: 'watch-room:state:v1' }], error: null };
          },
        };
        return query;
      },
    }));
    mockedCreateClient.mockReturnValue({ from });
    return { filters, from };
  }
  const create = () =>
    roomTransaction((store) =>
      handleRoomAction(
        {
          action: 'create',
          title: 'Film',
          name: 'Alice',
          playPath: '/play',
          episode: 1,
          persistent: true,
        },
        { name: 'Alice', owner: 'alice' },
        store
      )
    );
  it('uses scalar revision CAS and retries conflicts without exposing uncommitted results', async () => {
    const mock = client(1);
    const created = await create();
    const action = jest.fn((store) =>
      handleRoomAction(
        { action: 'join', roomId: created.room?.id || '', name: 'Bob' },
        { name: 'Bob', owner: 'bob' },
        store
      )
    );
    const joined = await roomTransaction(action);
    expect(joined.ok).toBe(true);
    expect(action).toHaveBeenCalledTimes(2);
    expect(mock.filters).toContainEqual(['value->>revision', '1']);
    expect(mock.filters.some(([key]) => key === 'value')).toBe(false);
    const rooms = await roomTransaction((store) => store.listRooms());
    expect(rooms[0].memberCount).toBe(1);
  });
  it('does not persist partial changes when an action fails', async () => {
    client();
    const created = await create();
    await expect(
      roomTransaction(async (store) => {
        await store.deleteRoom(created.room?.id || '');
        throw new Error('stop');
      })
    ).rejects.toThrow('stop');
    expect(
      await roomTransaction((store) => store.getRoom(created.room?.id || ''))
    ).not.toBeNull();
  });
  it('rolls back failed local memory actions too', async () => {
    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'localstorage';
    const created = await create();
    await expect(
      roomTransaction(async (store) => {
        await store.deleteRoom(created.room?.id || '');
        throw new Error('stop');
      })
    ).rejects.toThrow('stop');
    expect(
      await roomTransaction((store) => store.getRoom(created.room?.id || ''))
    ).not.toBeNull();
  });
  it('fails closed when configuration is missing', async () => {
    delete process.env.SUPABASE_URL;
    await expect(create()).rejects.toThrow('Supabase 未設定');
  });
});
