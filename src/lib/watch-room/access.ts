import { RoomStore } from './store';

export function validPlayPath(path: string): boolean {
  if (!path.startsWith('/play?') && path !== '/play') return false;
  try {
    const url = new URL(path, 'https://moontv.invalid');
    return (
      url.origin === 'https://moontv.invalid' &&
      url.pathname === '/play' &&
      !url.hash
    );
  } catch {
    return false;
  }
}

/** Filter both the lobby and direct room access using current account permissions. */
export function accessibleStore(
  store: RoomStore,
  canAccess: (path: string, title: string) => boolean
): RoomStore {
  return new Proxy(store, {
    get(target, key) {
      if (key === 'getRoom')
        return async (id: string) => {
          const room = await target.getRoom(id);
          return room && canAccess(room.playPath, room.videoTitle || room.title)
            ? room
            : null;
        };
      if (key === 'listRooms')
        return async () =>
          (await target.listRooms()).filter((room) =>
            canAccess(room.playPath, room.videoTitle || room.title)
          );
      if (key === 'saveRoom')
        return async (room: Parameters<RoomStore['saveRoom']>[0]) => {
          if (!canAccess(room.playPath, room.videoTitle || room.title))
            throw new Error('播放來源未授權');
          return target.saveRoom(room);
        };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
