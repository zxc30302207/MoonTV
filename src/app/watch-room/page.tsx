'use client';

import {
  Check,
  Clapperboard,
  Copy,
  DoorOpen,
  Globe,
  LoaderCircle,
  Lock,
  Plus,
  RefreshCw,
  Trash2,
  UsersRound,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import Swal from 'sweetalert2';

import { getCachedAuthInfo, refreshAuthInfo } from '@/lib/auth-client';
import { roomRequest } from '@/lib/watch-room/client';
import { WatchRoom } from '@/lib/watch-room/types';

import PageLayout from '@/components/PageLayout';

function readDisplayName(): string {
  return getCachedAuthInfo()?.username?.slice(0, 20) || '觀眾';
}

function inviteUrl(room: WatchRoom): string {
  try {
    const url = new URL(room.playPath || '/play', window.location.origin);
    if (url.origin !== window.location.origin || url.pathname !== '/play')
      return '';
    url.searchParams.set('room', room.id);
    return url.toString();
  } catch {
    return '';
  }
}

/** 房間當前播放內容的展示文案，公開列表與我的房間共用 */
function describeRoom(room: WatchRoom): string {
  const video =
    room.playPath === '/play'
      ? '尚未開始播放'
      : room.videoTitle || room.title || '共同觀影室';
  const episode = room.episode > 1 ? ` · 第 ${room.episode} 集` : '';
  // 只認服務端按 presence 實時統計的人數；members 是裁剪過的預覽名單，
  // 不能用它的長度冒充在線人數。
  const count = Math.max(0, Number(room.memberCount) || 0);
  return `${video}${episode} · ${count} 人在線`;
}

export default function WatchRoomPage() {
  const [rooms, setRooms] = useState<WatchRoom[]>([]);
  const [publicRooms, setPublicRooms] = useState<WatchRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [publicLoading, setPublicLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const generationRef = useRef(0);
  const myLoadRef = useRef(0);
  const publicLoadRef = useRef(0);
  const [roomNameInput, setRoomNameInput] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // fresh=true：跳過服務端列表緩存，並按 presence 重新統計每個房間的
  // 真實在線人數，保證點刷新後拿到的是「已進入且仍保持連接」的人數。
  const loadPublicRooms = useCallback(async () => {
    const generation = generationRef.current;
    const request = ++publicLoadRef.current;
    setPublicLoading(true);
    const res = await roomRequest({ action: 'publicRooms', fresh: true });
    if (
      generation !== generationRef.current ||
      request !== publicLoadRef.current
    )
      return;
    setPublicLoading(false);
    if (!res.ok) return;
    setPublicRooms(res.rooms || []);
  }, []);

  const loadRooms = useCallback(async () => {
    if (getCachedAuthInfo()?.mode === 'localstorage') {
      setLoading(false);
      setError('觀影室需要 Supabase 帳號登入，本機儲存模式不支援。');
      return;
    }
    const generation = generationRef.current;
    const request = ++myLoadRef.current;
    setLoading(true);
    const res = await roomRequest({ action: 'myRooms', fresh: true });
    if (generation !== generationRef.current || request !== myLoadRef.current)
      return;
    setLoading(false);
    if (!res.ok) {
      setError(res.error || '讀取觀影室失敗');
      return;
    }
    setError('');
    setRooms(res.rooms || []);
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadRooms(), loadPublicRooms()]);
  }, [loadRooms, loadPublicRooms]);

  useEffect(() => {
    void refreshAuthInfo();
    void refreshAll();
    const onLogout = () => {
      generationRef.current += 1;
      busyRef.current = false;
      setBusy(false);
      setRooms([]);
      setPublicRooms([]);
      setError('');
      setNotice('');
    };
    window.addEventListener('moontv:logout', onLogout);
    return () => {
      generationRef.current += 1;
      window.removeEventListener('moontv:logout', onLogout);
    };
  }, [refreshAll]);

  const createRoom = async () => {
    const generation = generationRef.current;
    if (getCachedAuthInfo()?.mode === 'localstorage') {
      setError('觀影室需要 Supabase 帳號登入，本機儲存模式不支援。');
      return;
    }
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);

    const existing = await roomRequest({ action: 'hasPersistentRoom' });
    if (generation !== generationRef.current) return;
    if (!existing.ok || existing.room) {
      busyRef.current = false;
      setBusy(false);
      setError(existing.error || '你已經創建過觀影室了，不能重復創建');
      return;
    }

    const nextRoomName = roomNameInput.trim() || '共同觀影室';

    setBusy(true);
    setError('');
    const res = await roomRequest({
      action: 'create',
      name: readDisplayName(),
      title: '共同觀影室',
      roomName: nextRoomName,
      playPath: '/play',
      episode: 1,
      persistent: true,
      // 默認不公開：需要房主手動點「公開」才會出現在公開列表
      isPublic: false,
    });
    if (generation !== generationRef.current) return;
    busyRef.current = false;
    setBusy(false);
    if (!res.ok) {
      setError(res.error || '創建觀影室失敗');
      return;
    }
    setRoomNameInput('');
    setNotice('觀影室已創建（未公開），點「公開」後其他人才能在觀影室頁面看到');
    await refreshAll();
  };

  /** 切換公開狀態：公開後房間會出現在本頁面的公開列表裡 */
  const togglePublic = async (room: WatchRoom) => {
    const generation = generationRef.current;
    const nextPublic = room.isPublic !== true;
    if (nextPublic && room.enabled === false) {
      setError('請先開啟觀影室再公開');
      return;
    }
    if (getCachedAuthInfo()?.mode === 'localstorage') {
      setError('觀影室需要 Supabase 帳號登入，本機儲存模式不支援。');
      return;
    }
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    const res = await roomRequest({
      action: 'setPublic',
      roomId: room.id,
      public: nextPublic,
    });
    if (generation !== generationRef.current) return;
    busyRef.current = false;
    setBusy(false);
    if (!res.ok) {
      setError(res.error || (nextPublic ? '公開觀影室失敗' : '取消公開失敗'));
      return;
    }
    setNotice(nextPublic ? '觀影室已公開' : '觀影室已取消公開');
    await refreshAll();
  };

  const toggleRoom = async (room: WatchRoom) => {
    const generation = generationRef.current;
    const roomIsClosed = room.enabled === false;
    const result = await Swal.fire({
      title: roomIsClosed ? '確認開啟觀影室？' : '確認關閉觀影室？',
      text: roomIsClosed
        ? '開啟後房間將重新接收心跳並繼續同步。'
        : '關閉後房間將暫停接收心跳，邀請鏈接也會失效，並從公開列表中移除。',
      icon: roomIsClosed ? 'question' : 'warning',
      showCancelButton: true,
      confirmButtonText: roomIsClosed ? '確認開啟' : '確認關閉',
      cancelButtonText: '取消',
      confirmButtonColor: roomIsClosed ? '#16a34a' : '#dc2626',
    });
    if (!result.isConfirmed || generation !== generationRef.current) return;
    if (getCachedAuthInfo()?.mode === 'localstorage') {
      setError('觀影室需要 Supabase 帳號登入，本機儲存模式不支援。');
      return;
    }
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const res = await roomRequest({
      action: roomIsClosed ? 'activateOwned' : 'close',
      roomId: room.id,
    });
    if (generation !== generationRef.current) return;
    busyRef.current = false;
    setBusy(false);
    if (!res.ok) {
      setError(
        res.error || (roomIsClosed ? '開啟觀影室失敗' : '關閉觀影室失敗')
      );
      return;
    }
    await refreshAll();
  };

  const deleteRoom = async (roomId: string) => {
    const generation = generationRef.current;
    const result = await Swal.fire({
      title: '確認刪除觀影室？',
      text: '刪除後該房間會從數據庫中徹底移除，無法恢復。',
      icon: 'error',
      showCancelButton: true,
      confirmButtonText: '確認刪除',
      cancelButtonText: '取消',
      confirmButtonColor: '#dc2626',
    });
    if (!result.isConfirmed || generation !== generationRef.current) return;
    if (getCachedAuthInfo()?.mode === 'localstorage') {
      setError('觀影室需要 Supabase 帳號登入，本機儲存模式不支援。');
      return;
    }
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const res = await roomRequest({ action: 'delete', roomId });
    if (generation !== generationRef.current) return;
    busyRef.current = false;
    setBusy(false);
    if (!res.ok) {
      setError(res.error || '刪除觀影室失敗');
      return;
    }
    setRooms((current) => current.filter((room) => room.id !== roomId));
    setPublicRooms((current) => current.filter((room) => room.id !== roomId));
  };

  const enterRoom = async (room: WatchRoom) => {
    const generation = generationRef.current;
    if (getCachedAuthInfo()?.mode === 'localstorage') {
      setError('觀影室需要 Supabase 帳號登入，本機儲存模式不支援。');
      return;
    }
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    const res = await roomRequest({
      action: 'enterOwned',
      roomId: room.id,
      name: readDisplayName(),
    });
    if (generation !== generationRef.current) return;
    busyRef.current = false;
    setBusy(false);
    if (!res.ok) {
      setError(res.error || '進入觀影室失敗');
      return;
    }
    const url = inviteUrl(res.room || room);
    if (url) window.location.assign(url);
  };

  /** 公開房間：非創建者直接通過邀請鏈接入房 */
  const joinPublicRoom = (room: WatchRoom) => {
    const url = inviteUrl(room);
    if (url) window.location.assign(url);
  };

  const copyInvite = async (room: WatchRoom) => {
    const url = inviteUrl(room);
    if (!url) {
      setError('無效的播放連結');
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setNotice(`觀影室 ${room.id} 邀請鏈接已復制`);
    } catch {
      window.prompt('復制邀請鏈接：', url);
    }
  };

  return (
    <PageLayout>
      <main className='mx-auto w-full max-w-5xl px-4 pb-24 pt-6 md:px-6 md:pt-10'>
        {/* 窄屏：標題獨佔一行，控件區兩行鋪滿（輸入整行 / 刷新+創建並排），
            避免 flex-wrap 把三個控件逐個擠到下一行形成參差的三行。
            sm 及以上恢復原來的單行橫排布局。 */}
        <header className='mb-6 flex flex-col gap-3 border-b border-gray-200 pb-4 dark:border-gray-700 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between'>
          <div className='flex min-w-0 items-center gap-3'>
            <Clapperboard className='h-6 w-6 shrink-0 text-green-600 dark:text-green-400' />
            <div className='min-w-0'>
              <h1 className='text-xl font-semibold text-gray-900 dark:text-white'>
                觀影室
              </h1>
              <p className='mt-1 text-sm text-gray-500 dark:text-gray-400'>
                你的房間由你管理，公開後會出現在下方列表供其他人加入
              </p>
            </div>
          </div>
          <div className='flex w-full min-w-0 flex-col gap-2 sm:flex-1 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end'>
            <input
              value={roomNameInput}
              onChange={(e) => setRoomNameInput(e.target.value.slice(0, 20))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !busy && rooms.length === 0)
                  void createRoom();
              }}
              aria-label='房間名稱'
              placeholder='共同觀影室'
              className='h-10 w-full min-w-0 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-green-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:placeholder:text-gray-500 sm:w-auto sm:min-w-[180px] sm:max-w-[280px] sm:flex-1'
            />
            <div className='flex min-w-0 gap-2 sm:shrink-0'>
              <button
                type='button'
                onClick={() => void refreshAll()}
                disabled={loading || publicLoading}
                title='刷新列表'
                aria-label='刷新列表'
                className='inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
              >
                <RefreshCw
                  className={`h-4 w-4 ${
                    loading || publicLoading ? 'animate-spin' : ''
                  }`}
                />
              </button>
              <button
                type='button'
                onClick={() => void createRoom()}
                disabled={busy || rooms.length > 0}
                className='inline-flex h-10 min-w-0 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-green-600 px-4 text-sm font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none'
              >
                {busy ? (
                  <LoaderCircle className='h-4 w-4 shrink-0 animate-spin' />
                ) : (
                  <Plus className='h-4 w-4 shrink-0' />
                )}
                創建觀影室
              </button>
            </div>
          </div>
        </header>

        {error && (
          <p
            role='alert'
            className='mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300'
          >
            {error}
          </p>
        )}
        {notice && (
          <p className='mb-4 flex items-center gap-2 text-sm text-green-700 dark:text-green-400'>
            <Check className='h-4 w-4' />
            {notice}
          </p>
        )}

        <section className='mb-10'>
          <h2 className='mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white'>
            <UsersRound className='h-4 w-4 text-green-600 dark:text-green-400' />
            我的觀影室
          </h2>
          {loading ? (
            <div className='flex items-center gap-2 py-12 text-sm text-gray-500'>
              <LoaderCircle className='h-4 w-4 animate-spin' />
              正在加載觀影室
            </div>
          ) : rooms.length === 0 ? (
            <section className='border-y border-gray-200 py-12 text-center dark:border-gray-700'>
              <Clapperboard className='mx-auto h-8 w-8 text-gray-400' />
              <h3 className='mt-3 text-base font-medium text-gray-900 dark:text-white'>
                還沒有觀影室
              </h3>
              <p className='mt-1 text-sm text-gray-500 dark:text-gray-400'>
                創建後可分享房間號；之後播放的影片都會繼續使用這個房間。
              </p>
            </section>
          ) : (
            <ul className='divide-y divide-gray-200 border-y border-gray-200 dark:divide-gray-700 dark:border-gray-700'>
              {rooms.map((room) => (
                <li
                  key={room.id}
                  className='flex flex-col gap-4 py-5 sm:flex-row sm:items-center sm:justify-between'
                >
                  <div className='min-w-0'>
                    <div className='flex flex-wrap items-center gap-x-3 gap-y-1'>
                      <h3 className='text-base font-semibold text-gray-900 dark:text-white'>
                        {room.title || '共同觀影室'}
                      </h3>
                      <span className='font-mono text-sm font-semibold tracking-wider text-green-700 dark:text-green-400'>
                        {room.id}
                      </span>
                      <span className='text-xs text-gray-500 dark:text-gray-400'>
                        房主：{room.hostName}
                      </span>
                      {room.isPublic && (
                        <span className='inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-[11px] font-medium text-green-700 dark:text-green-400'>
                          <Globe className='h-3 w-3' />
                          已公開
                        </span>
                      )}
                      {room.enabled === false && (
                        <span className='rounded-full bg-gray-500/10 px-2 py-0.5 text-[11px] text-gray-600 dark:text-gray-300'>
                          已關閉
                        </span>
                      )}
                    </div>
                    <p className='mt-1 truncate text-sm text-gray-500 dark:text-gray-400'>
                      當前影片：{describeRoom(room)}
                    </p>
                    <p className='mt-1 text-xs text-gray-400'>
                      創建於 {new Date(room.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <div className='flex shrink-0 flex-wrap gap-2'>
                    <button
                      type='button'
                      onClick={() => void enterRoom(room)}
                      disabled={busy}
                      className='inline-flex h-9 items-center gap-2 rounded-md bg-green-600 px-3 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50'
                    >
                      <DoorOpen className='h-4 w-4' />
                      {room.enabled === false ? '恢復播放' : '播放此房間'}
                    </button>
                    <button
                      type='button'
                      onClick={() => void copyInvite(room)}
                      className='inline-flex h-9 items-center gap-2 rounded-md border border-gray-300 px-3 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800'
                    >
                      <Copy className='h-4 w-4' />
                      邀請
                    </button>
                    <button
                      type='button'
                      onClick={() => void togglePublic(room)}
                      disabled={busy}
                      title={room.isPublic ? '取消公開' : '公開到觀影室列表'}
                      className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm disabled:opacity-50 ${
                        room.isPublic
                          ? 'border-green-300 text-green-700 hover:bg-green-50 dark:border-green-800 dark:text-green-400 dark:hover:bg-green-950/40'
                          : 'border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800'
                      }`}
                    >
                      {room.isPublic ? (
                        <Globe className='h-4 w-4' />
                      ) : (
                        <Lock className='h-4 w-4' />
                      )}
                      {room.isPublic ? '公開中' : '公開'}
                    </button>
                    <button
                      type='button'
                      onClick={() => void toggleRoom(room)}
                      disabled={busy}
                      title={
                        room.enabled === false ? '開啟觀影室' : '關閉觀影室'
                      }
                      className='inline-flex h-9 items-center gap-2 rounded-md border border-gray-300 px-3 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800'
                    >
                      {room.enabled === false ? '開啟' : '關閉'}
                    </button>
                    <button
                      type='button'
                      onClick={() => void deleteRoom(room.id)}
                      disabled={busy}
                      title='刪除觀影室'
                      className='inline-flex h-9 w-9 items-center justify-center rounded-md border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:hover:bg-red-950/40'
                    >
                      <Trash2 className='h-4 w-4' />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <div className='mb-3 flex items-center justify-between gap-2'>
            <h2 className='flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white'>
              <Globe className='h-4 w-4 text-green-600 dark:text-green-400' />
              公開觀影室
            </h2>
            <span className='text-xs text-gray-400'>
              {publicRooms.length} 個房間
            </span>
          </div>
          {publicLoading ? (
            <div className='flex items-center gap-2 py-10 text-sm text-gray-500'>
              <LoaderCircle className='h-4 w-4 animate-spin' />
              正在加載公開觀影室
            </div>
          ) : publicRooms.length === 0 ? (
            <section className='border-y border-gray-200 py-10 text-center dark:border-gray-700'>
              <Globe className='mx-auto h-7 w-7 text-gray-400' />
              <p className='mt-2 text-sm text-gray-500 dark:text-gray-400'>
                還沒有公開的觀影室，創建一個並點「公開」即可出現在這裡。
              </p>
            </section>
          ) : (
            <ul className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
              {publicRooms.map((room) => (
                <li
                  key={room.id}
                  className='flex flex-col gap-3 rounded-xl border border-gray-200 p-4 transition hover:border-green-400 dark:border-gray-700 dark:hover:border-green-600'
                >
                  <div className='flex items-start justify-between gap-2'>
                    <div className='min-w-0'>
                      <h3 className='truncate text-base font-semibold text-gray-900 dark:text-white'>
                        {room.title || '共同觀影室'}
                      </h3>
                      <p className='mt-0.5 text-xs text-gray-500 dark:text-gray-400'>
                        房主：{room.hostName} · 房間{' '}
                        <span className='font-mono tracking-wider'>
                          {room.id}
                        </span>
                      </p>
                    </div>
                    <span className='inline-flex shrink-0 items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-[11px] font-medium text-green-700 dark:text-green-400'>
                      <Globe className='h-3 w-3' />
                      公開
                    </span>
                  </div>
                  <p className='truncate text-sm text-gray-500 dark:text-gray-400'>
                    {describeRoom(room)}
                  </p>
                  <div className='flex gap-2'>
                    <button
                      type='button'
                      onClick={() => joinPublicRoom(room)}
                      className='inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-md bg-green-600 px-3 text-sm font-medium text-white hover:bg-green-700'
                    >
                      <DoorOpen className='h-4 w-4' />
                      進入房間
                    </button>
                    <button
                      type='button'
                      onClick={() => void copyInvite(room)}
                      className='inline-flex h-9 items-center justify-center gap-2 rounded-md border border-gray-300 px-3 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800'
                    >
                      <Copy className='h-4 w-4' />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </PageLayout>
  );
}
