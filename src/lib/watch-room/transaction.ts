import { createClient } from '@supabase/supabase-js';

import { MemoryEntry, MemoryRoomStore, RoomStore } from './store';

type Snapshot = ReturnType<MemoryRoomStore['snapshot']>;
interface State {
  revision: number;
  rooms: Snapshot;
}
const STATE_KEY = 'watch-room:state:v1';
const MAX_STATE_BYTES = 4 * 1024 * 1024;
let localQueue: Promise<unknown> = Promise.resolve();

/** One compare-and-swap covers the entire action, including events and presence.
 * Uses the existing server-only KV table; never falls back to process-local data
 * when Supabase is configured. Bounded for small private deployments.
 */
export async function roomTransaction<T>(
  action: (store: RoomStore) => Promise<T>
): Promise<T> {
  if (process.env.NEXT_PUBLIC_STORAGE_TYPE !== 'supabase') {
    const pending = localQueue.then(async () => {
      const shared = new MemoryRoomStore();
      const isolated = new MemoryRoomStore(new Map());
      isolated.replace(JSON.parse(JSON.stringify(shared.snapshot())));
      const result = await action(isolated);
      const snapshot = isolated.snapshot();
      if (
        new TextEncoder().encode(JSON.stringify(snapshot)).byteLength >
        MAX_STATE_BYTES
      )
        throw new Error('觀影室儲存已達上限');
      shared.replace(snapshot);
      return result;
    });
    localQueue = pending.catch(() => undefined);
    return pending;
  }
  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('Supabase 未設定');
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const table = process.env.SUPABASE_KV_TABLE || 'moontv_kv';
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await client
      .from(table)
      .select('value')
      .eq('key', STATE_KEY)
      .maybeSingle();
    if (error) throw new Error('無法讀取觀影室');
    const previous = (data?.value ?? null) as State | null;
    if (
      previous &&
      (!Array.isArray(previous.rooms) ||
        !Number.isSafeInteger(previous.revision))
    )
      throw new Error('觀影室資料無效');
    const snapshot: Snapshot = JSON.parse(
      JSON.stringify(previous?.rooms || [])
    );
    const entries = new Map<string, MemoryEntry>(
      snapshot.map(([id, entry]) => [
        id,
        { ...entry, members: new Map(entry.members) },
      ])
    );
    const store = new MemoryRoomStore(entries);
    const result = await action(store);
    const rooms = store.snapshot();
    if (previous && JSON.stringify(rooms) === JSON.stringify(previous.rooms))
      return result;
    const next: State = { revision: (previous?.revision || 0) + 1, rooms };
    if (
      new TextEncoder().encode(JSON.stringify(next)).byteLength >
      MAX_STATE_BYTES
    )
      throw new Error('觀影室儲存已達上限');
    const row = {
      key: STATE_KEY,
      value: next,
      updated_at: new Date().toISOString(),
    };
    if (!previous) {
      const { error: insertError } = await client.from(table).insert(row);
      if (!insertError) return result;
      if (insertError.code !== '23505') throw new Error('無法儲存觀影室');
    } else {
      const { data: updated, error: updateError } = await client
        .from(table)
        .update(row)
        .eq('key', STATE_KEY)
        .eq('value->>revision', String(previous.revision))
        .select('key');
      if (updateError) throw new Error('無法儲存觀影室');
      if (updated?.length) return result;
    }
  }
  throw new Error('觀影室忙碌，請重試');
}
