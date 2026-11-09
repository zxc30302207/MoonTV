/* eslint-disable react-hooks/exhaustive-deps, @typescript-eslint/no-explicit-any, no-console */

'use client';

import { LoaderCircle, RefreshCw } from 'lucide-react';
import {
  type MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import { getCachedAuthInfo, refreshAuthInfo } from '@/lib/auth-client';
import {
  cachedMemberId,
  cacheMemberId,
  clearCachedMemberId,
  roomRequest,
} from '@/lib/watch-room/client';
import {
  ControlKind,
  currentPlayPath,
  DEFAULT_ROOM_CAPACITY,
  MAX_MESSAGE_LENGTH,
  MAX_ROOM_CAPACITY,
  MEMBER_PREVIEW_LIMIT,
  normalizeCapacity,
  POLL_HIDDEN_INTERVAL_MS,
  POLL_IDLE_INTERVAL_MS,
  POLL_INTERVAL_MS,
  POLL_JITTER,
  resolveCreateCapacity,
  RoomEvent,
  RoomResponse,
  WatchRoom,
} from '@/lib/watch-room/types';

interface WatchRoomPanelProps {
  /** usePlayEngine 裡的 ArtPlayer 實例 ref（新增導出） */
  artPlayerRef: MutableRefObject<any>;
  videoTitle: string;
  currentSource: string;
  currentId: string;
  currentEpisodeIndex: number;
  videoUrl: string;
  /**
   * 緊湊模式：嵌入播放頁右側欄的「一起看」Tab 時使用。
   * 去掉獨立卡片外框與「收起」按鈕，內容按窄欄單列縱向鋪滿。
   */
  compact?: boolean;
}

const ROOM_ID_PATTERN = /^[A-Z0-9]{6,7}$/;

/** 輪詢尚未掛載時的佔位喚醒函數（函數體有返回值，不會觸發 no-empty-function） */
const noopWake: () => void = () => undefined;

function readRoomFromUrl(): string | null {
  const raw = new URLSearchParams(window.location.search).get('room');
  if (!raw) return null;
  const id = raw.toUpperCase();
  return ROOM_ID_PATTERN.test(id) ? id : null;
}

function writeRoomToUrl(id: string | null): void {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set('room', id);
  else url.searchParams.delete('room');
  window.history.replaceState(window.history.state, '', url.toString());
}

/** Display labels only; authorization remains server-side with HttpOnly auth. */
function readUsername(): string {
  return getCachedAuthInfo()?.username?.slice(0, 20) || '';
}

function displayName(): string {
  const username = readUsername();
  if (username) return username;
  try {
    const saved = localStorage.getItem('moontv:watchroom:name');
    if (saved) return saved;
    const generated = `觀眾${Math.random()
      .toString(36)
      .slice(2, 6)
      .toUpperCase()}`;
    localStorage.setItem('moontv:watchroom:name', generated);
    return generated;
  } catch {
    return '觀眾';
  }
}

function buildInviteUrl(room: WatchRoom): string {
  if (typeof window === 'undefined') return '';
  try {
    const url = new URL(room.playPath, window.location.origin);
    if (url.origin !== window.location.origin || url.pathname !== '/play')
      return '';
    url.searchParams.set('room', room.id);
    return url.toString();
  } catch {
    return '';
  }
}

/** 氣泡上的 HH:mm。用本地時區手動補零，避免 toLocaleTimeString 的 SSR 差異 */
function formatClock(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
  const date = new Date(timestamp);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return [hours, minutes, secs]
      .map((v) => String(v).padStart(2, '0'))
      .join(':');
  }
  return [minutes, secs].map((v) => String(v).padStart(2, '0')).join(':');
}

export default function WatchRoomPanel({
  artPlayerRef,
  videoTitle,
  currentEpisodeIndex,
  compact = false,
}: WatchRoomPanelProps) {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [room, setRoom] = useState<WatchRoom | null>(null);
  /** 精確在線人數：大房間下名單被裁剪，人數單獨維護 */
  const [memberCount, setMemberCount] = useState(0);
  const [events, setEvents] = useState<RoomEvent[]>([]);
  const [isHost, setIsHost] = useState(false);
  const [myId, setMyId] = useState('');
  const [connected, setConnected] = useState<
    'idle' | 'connecting' | 'online' | 'error'
  >('idle');
  const [expanded, setExpanded] = useState(compact);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [roomNameInput, setRoomNameInput] = useState('');
  // 創建房間時的人數上限，留空 = 採用默認上限（20 人）
  const [capacityInput, setCapacityInput] = useState('');
  /**
   * 帳號已創建的持久觀影室。只作展示，不自動激活：換影片進播放頁時不再
   * 把用戶直接拉回自己的房間，需要用戶主動點「加入我的觀影室」。
   */
  const [savedRoom, setSavedRoom] = useState<WatchRoom | null>(null);
  const [joiningSaved, setJoiningSaved] = useState(false);
  /** 查詢「我的觀影室」的加載態與錯誤態：失敗必須顯式報錯並允許手動重試 */
  const [savedRoomLoading, setSavedRoomLoading] = useState(false);
  const [savedRoomError, setSavedRoomError] = useState('');
  /** 丟棄過期的 hasPersistentRoom 響應，避免卸載 / 快速切換時覆蓋狀態 */
  const savedRoomReqRef = useRef(0);
  const [errorText, setErrorText] = useState('');
  const [hint, setHint] = useState('');
  const [storeKind, setStoreKind] = useState('');
  const [episodeMismatch, setEpisodeMismatch] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [optimisticSyncMode, setOptimisticSyncMode] = useState<
    'auto' | 'manual' | null
  >(null);

  const sessionGenerationRef = useRef(0);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const memberIdRef = useRef('');
  /**
   * 服務端在實例重啟後會重新分配 memberId。把歷次自己的 id 都記下來，
   * 這樣重連前的歷史消息仍會被渲染在右側，不會突然變成「別人的消息」。
   */
  const myIdsRef = useRef<Set<string>>(new Set());
  const sinceRef = useRef(0);
  /** 客戶端已持有的房間核心版本 / 人數，用於跳過無變化的心跳響應 */
  const revRef = useRef(-1);
  const countRef = useRef(-1);
  /** 即使名單被裁剪，也能拿到自己的同步模式 */
  const mySyncModeRef = useRef<'auto' | 'manual' | null>(null);
  /** 連續無新事件的輪詢次數，用於非房主退避 */
  const idlePollsRef = useRef(0);
  /** 面板是否可見（側欄 Tab 收起 / 標簽頁隱藏時暫停高頻輪詢） */
  const visibleRef = useRef(true);
  const rootRef = useRef<HTMLDivElement | null>(null);
  /** 用戶主動操作後立即喚醒一次輪詢 */
  const wakeRef = useRef<() => void>(noopWake);
  const isHostRef = useRef(false);
  const roomIdRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);
  const applyingUntilRef = useRef(0);
  const lastCorrectRef = useRef(0);
  const alignedRef = useRef(false);
  const broadcastAfterRef = useRef(0);
  const artBoundRef = useRef<any>(null);
  const handlersRef = useRef<{
    play: () => void;
    pause: () => void;
    seeked: () => void;
  } | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showHint = useCallback((text: string) => {
    if (!mountedRef.current) return;
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    setHint(text);
    hintTimerRef.current = setTimeout(() => setHint(''), 3000);
  }, []);

  const resolveMemberSyncMode = useCallback(
    (nextRoom: WatchRoom | null) => {
      const memberId = memberIdRef.current || myId;
      if (!nextRoom || !memberId) return mySyncModeRef.current || 'auto';
      const member = nextRoom.members.find((item) => item.id === memberId);
      return (
        member?.syncMode ??
        nextRoom.defaultSyncMode ??
        mySyncModeRef.current ??
        'auto'
      );
    },
    [myId]
  );

  /** 接收服務端快照後，把房主的播放狀態靜默應用到本地播放器 */
  const applyRoomState = useCallback(
    (nextRoom: WatchRoom, host: boolean, forceApply = false) => {
      if (nextRoom.playPath !== currentPlayPath()) return;
      if (host) return; // 房主是權威，絕不被自己的心跳回拉
      const syncMode = resolveMemberSyncMode(nextRoom);
      if (syncMode === 'manual' && !forceApply) return;

      const art = artPlayerRef.current;
      if (!art || typeof art.currentTime !== 'number') return;
      if (Date.now() < applyingUntilRef.current) return;

      const force = forceApply || !alignedRef.current;
      const video = art.video as HTMLVideoElement | undefined;
      // 緩沖中先別 seek，避免拖到未加載位置反復卡頓
      if (!force && video && video.readyState < 2) return;
      alignedRef.current = true;

      const applyRemote = (fn: () => void) => {
        applyingUntilRef.current = Date.now() + 900;
        fn();
      };

      const state = nextRoom.state;
      const localPlaying = !art.paused;
      if (localPlaying !== state.playing) {
        applyRemote(() => {
          if (state.playing) {
            const result = art.play?.();
            if (result && typeof result.catch === 'function') {
              result.catch(() =>
                showHint('瀏覽器阻止了自動播放，請點擊一下畫面以繼續同步')
              );
            }
          } else {
            art.pause?.();
          }
        });
      }

      const drift = Math.abs((art.currentTime || 0) - state.time);
      const cooled = Date.now() - lastCorrectRef.current > 3000;
      if (force || (drift > 2 && cooled)) {
        applyRemote(() => {
          try {
            art.currentTime = state.time;
          } catch {
            /* 播放器尚未就緒，下一輪重試 */
          }
        });
        lastCorrectRef.current = Date.now();
      }
    },
    [artPlayerRef, resolveMemberSyncMode, showHint]
  );

  /** 統一處理 create / join 的響應（URL 自動入房由輪詢自身完成） */
  const activate = useCallback((res: RoomResponse) => {
    if (!mountedRef.current) return;
    sessionGenerationRef.current += 1;
    const nextRoom = res.room;
    if (!nextRoom || !res.memberId) return;
    const host = res.isHost === true;
    const newEvents = res.events || [];

    sinceRef.current = newEvents.reduce((max, e) => Math.max(max, e.seq), 0);
    memberIdRef.current = res.memberId;
    myIdsRef.current.add(res.memberId);
    revRef.current = res.rev ?? -1;
    mySyncModeRef.current = res.mySyncMode || null;
    const count =
      res.memberCount ?? nextRoom.memberCount ?? nextRoom.members.length;
    countRef.current = count;
    setMemberCount(count);
    idlePollsRef.current = 0;
    isHostRef.current = host;
    // 房主無需對齊，成員需要按房主進度強制對齊一次
    alignedRef.current = host;
    broadcastAfterRef.current = Date.now() + 1500;
    roomIdRef.current = nextRoom.id;
    cacheMemberId(nextRoom.id, res.memberId);

    setRoom(nextRoom);
    setRoomId(nextRoom.id);
    setMyId(res.memberId);
    setIsHost(host);
    setEvents(newEvents);
    setConnected('online');
    setErrorText('');
    setExpanded(true);
    setStoreKind(res.storeKind || '');
    savedRoomReqRef.current += 1;
    setSavedRoom(null);
    setSavedRoomError('');
    setSavedRoomLoading(false);
    writeRoomToUrl(nextRoom.id);
  }, []);

  const resetLocal = useCallback(() => {
    sessionGenerationRef.current += 1;
    savedRoomReqRef.current += 1;
    setSavedRoom(null);
    setSavedRoomError('');
    setSavedRoomLoading(false);
    setJoiningSaved(false);
    busyRef.current = false;
    setBusy(false);
    const id = roomIdRef.current;
    if (id) clearCachedMemberId(id);
    roomIdRef.current = null;
    memberIdRef.current = '';
    myIdsRef.current.clear();
    sinceRef.current = 0;
    revRef.current = -1;
    countRef.current = -1;
    mySyncModeRef.current = null;
    idlePollsRef.current = 0;
    isHostRef.current = false;
    alignedRef.current = false;
    setRoomId(null);
    setRoom(null);
    setMemberCount(0);
    setEvents([]);
    setIsHost(false);
    setMyId('');
    setConnected('idle');
    setErrorText('');
    setOptimisticSyncMode(null);
    setSettingsOpen(false);
    writeRoomToUrl(null);
  }, []);

  /**
   * 只查詢帳號已創建的房間用於展示；不發心跳、不 activateOwned。
   *
   * 失敗不再靜默回落到創建表單（用戶已創建過時點創建只會報「不能重復創建」），
   * 而是顯式報錯並提供重試按鈕。查詢期間保留上一次的卡片，避免界面閃空。
   */
  const loadSavedRoom = useCallback(async () => {
    const reqId = ++savedRoomReqRef.current;
    const generation = sessionGenerationRef.current;
    // 重試期間故意保留上一條錯誤：錯誤塊裡的按鈕才能顯示「正在重試…」，
    // 而不是整塊消失、讓用戶以為點擊沒生效。成功後在下面清空。
    setSavedRoomLoading(true);

    let res: RoomResponse | null = null;
    try {
      res = await roomRequest({ action: 'hasPersistentRoom' });
    } catch {
      /* roomRequest 內部已兜底，這裡只防意外拋出 */
    }
    if (
      !mountedRef.current ||
      generation !== sessionGenerationRef.current ||
      reqId !== savedRoomReqRef.current
    )
      return;
    setSavedRoomLoading(false);

    if (!res || !res.ok) {
      // roomRequest 超時文案寫的是「正在重試」，但本查詢本身沒有自動重試，
      // 這裡換成準確描述，避免誤導用戶等著一個不會發生的重試。
      const raw = res?.error || '讀取我的觀影室失敗';
      setSavedRoomError(
        /正在重[試试]/.test(raw) ? '讀取觀影室超時，請點擊重試' : raw
      );
      return;
    }
    // ok=true 且沒有 room 是正常結果（帳號確實沒創建過房間），不是錯誤
    setSavedRoomError('');
    setSavedRoom(res.room || null);
  }, []);

  /** 用戶主動點「加入我的觀影室」後才真正建立連接 */
  const joinSavedRoom = useCallback(async () => {
    if (!savedRoom || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const generation = sessionGenerationRef.current;
    setJoiningSaved(true);
    setErrorText('');
    const res = await roomRequest({
      action: 'activateOwned',
      roomId: savedRoom.id,
    });
    if (!mountedRef.current || generation !== sessionGenerationRef.current)
      return;
    busyRef.current = false;
    setBusy(false);
    setJoiningSaved(false);
    if (!res.ok || !res.room || !res.memberId) {
      setErrorText(res.error || '加入觀影室失敗');
      // 房間可能已在別處被刪除：刷新一次，讓卡片回落到創建表單
      void loadSavedRoom();
      return;
    }
    activate(res);
  }, [savedRoom, joiningSaved, busy, activate, loadSavedRoom]);

  const createRoom = useCallback(async () => {
    if (getCachedAuthInfo()?.mode === 'localstorage') {
      setErrorText('觀影室需要 Supabase 帳號登入，本機儲存模式不支援。');
      return;
    }
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const generation = sessionGenerationRef.current;

    const existing = await roomRequest({ action: 'hasPersistentRoom' });
    if (!mountedRef.current || generation !== sessionGenerationRef.current)
      return;
    if (!existing.ok || existing.room) {
      busyRef.current = false;
      setBusy(false);
      setErrorText(existing.error || '你已經創建過觀影室了，不能重復創建');
      return;
    }

    const nextRoomName = roomNameInput.trim() || '共同觀影室';

    setBusy(true);
    setErrorText('');
    const res = await roomRequest({
      action: 'create',
      name: displayName(),
      title: videoTitle,
      roomName: nextRoomName,
      playPath: currentPlayPath(),
      episode: currentEpisodeIndex + 1,
      persistent: true,
      // 默認不公開：由房主在設置裡主動公開
      isPublic: false,
      maxMembers: resolveCreateCapacity(capacityInput),
    });
    if (!mountedRef.current || generation !== sessionGenerationRef.current)
      return;
    busyRef.current = false;
    setBusy(false);
    if (!res.ok || !res.room || !res.memberId) {
      setErrorText(res.error || '創建房間失敗');
      return;
    }
    setRoomNameInput('');
    setCapacityInput('');
    activate(res);
  }, [
    busy,
    roomNameInput,
    capacityInput,
    videoTitle,
    currentEpisodeIndex,
    activate,
  ]);

  const joinRoom = useCallback(
    async (code: string) => {
      const id = code.trim().toUpperCase();
      if (!ROOM_ID_PATTERN.test(id)) {
        setErrorText('請輸入 6 至 7 位房間號');
        return;
      }
      if (getCachedAuthInfo()?.mode === 'localstorage') {
        setErrorText('觀影室需要 Supabase 帳號登入，本機儲存模式不支援。');
        return;
      }
      if (busyRef.current) return;
      busyRef.current = true;
      const generation = sessionGenerationRef.current;
      setBusy(true);
      setErrorText('');
      const res = await roomRequest({
        action: 'join',
        roomId: id,
        name: displayName(),
      });
      if (!mountedRef.current || generation !== sessionGenerationRef.current)
        return;
      busyRef.current = false;
      setBusy(false);
      if (!res.ok || !res.room || !res.memberId) {
        setErrorText(res.error || '加入房間失敗');
        return;
      }
      activate(res);
    },
    [busy, activate]
  );

  const leaveRoom = useCallback(async () => {
    const id = roomIdRef.current;
    if (id && memberIdRef.current) {
      void roomRequest({
        action: 'leave',
        roomId: id,
        memberId: memberIdRef.current,
      });
    }
    resetLocal();
    // 離開後回到「我的觀影室」卡片，可再次手動加入
    void loadSavedRoom();
    // 緊湊模式下 Tab 本身就是開關，離開後仍停留在面板上便於重新建房
    if (!compact) setExpanded(false);
  }, [resetLocal, loadSavedRoom, compact]);

  useEffect(() => {
    mountedRef.current = true;
    void refreshAuthInfo();
    const onLogout = () => resetLocal();
    window.addEventListener('moontv:logout', onLogout);
    return () => {
      mountedRef.current = false;
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
      sessionGenerationRef.current += 1;
      window.removeEventListener('moontv:logout', onLogout);
    };
  }, [resetLocal]);

  // 邀請鏈接（URL 帶 ?room=）仍按顯式意圖自動入房；沒有邀請鏈接時只查詢
  // 帳號已創建的房間並展示卡片，由用戶手動點「加入我的觀影室」，避免換影片
  // 進入播放頁就被自動拉回自己的房間。
  useEffect(() => {
    const initRoomState = () => {
      if (getCachedAuthInfo()?.mode === 'localstorage') {
        setErrorText('觀影室需要 Supabase 帳號登入，本機儲存模式不支援。');
        return;
      }
      const inviteId = readRoomFromUrl();
      if (inviteId) {
        roomIdRef.current = inviteId;
        memberIdRef.current = cachedMemberId(inviteId);
        broadcastAfterRef.current = Date.now() + 1500;
        setRoomId(inviteId);
        setConnected('connecting');
        setExpanded(true);
        return;
      }
      void loadSavedRoom();
    };
    initRoomState();
    // 卸載後丟棄在途響應，避免對已卸載組件 setState
    return () => {
      savedRoomReqRef.current += 1;
    };
  }, [loadSavedRoom]);

  // 可見性感知：側欄 Tab 被隱藏 / 標簽頁切到後台時，不再高頻輪詢
  useEffect(() => {
    const node = rootRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((entry) => entry.isIntersecting);
        const wasVisible = visibleRef.current;
        visibleRef.current = visible;
        if (visible && !wasVisible) wakeRef.current();
      },
      { threshold: 0 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // 輪詢：一次請求同時完成心跳、增量事件拉取與狀態同步。
  // 自適應間隔 + 抖動，把同一房間 N 個客戶端的請求打散，避免整點驚群。
  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (inFlightRef.current || cancelled) return;
      inFlightRef.current = true;
      const art = artPlayerRef.current;
      const host = isHostRef.current;
      const local =
        host && art && typeof art.currentTime === 'number'
          ? { time: art.currentTime || 0, playing: !art.paused }
          : undefined;

      const generation = sessionGenerationRef.current;
      const res = await roomRequest({
        action: 'sync',
        roomId,
        memberId: memberIdRef.current,
        since: sinceRef.current,
        name: displayName(),
        playPath: host ? currentPlayPath() : undefined,
        title: host ? videoTitle : undefined,
        episode: host ? currentEpisodeIndex + 1 : undefined,
        local,
        rev: revRef.current >= 0 ? revRef.current : undefined,
        memberCount: countRef.current >= 0 ? countRef.current : undefined,
      });
      inFlightRef.current = false;
      if (cancelled || generation !== sessionGenerationRef.current) return;

      if (res.storeKind) setStoreKind(res.storeKind);

      if (!res.ok) {
        setConnected('error');
        const message = res.error || '連接異常，正在重試';
        setErrorText(message);
        if (
          /不存在|已解散|房[間间][號号][無无]效|人[數数]已[滿满]/.test(message)
        ) {
          // 房間滿了不要繼續反復心跳重試；退出本地房間狀態，
          // 並把滿員提示留在面板上（resetLocal 會清空錯誤文案）。
          resetLocal();
          void loadSavedRoom();
          if (/人[數数]已[滿满]/.test(message)) setErrorText(message);
        }
        return;
      }

      setConnected('online');
      setErrorText('');
      const hasEvents = !!(res.events && res.events.length);
      idlePollsRef.current = hasEvents
        ? 0
        : Math.min(idlePollsRef.current + 1, 100);

      if (res.rev !== undefined) revRef.current = res.rev;
      if (res.memberCount !== undefined) {
        countRef.current = res.memberCount;
        setMemberCount(res.memberCount);
      }
      if (res.mySyncMode) mySyncModeRef.current = res.mySyncMode;

      if (res.memberId && res.memberId !== memberIdRef.current) {
        memberIdRef.current = res.memberId;
        cacheMemberId(roomId, res.memberId);
        alignedRef.current = false; // 重新入房後重新對齊
      }
      setMyId(res.memberId || memberIdRef.current);
      if (res.memberId) myIdsRef.current.add(res.memberId);
      if (res.isHost !== undefined) {
        const changed = isHostRef.current !== res.isHost;
        isHostRef.current = res.isHost;
        setIsHost(res.isHost);
        if (res.isHost) alignedRef.current = true;
        else if (changed) alignedRef.current = false;
      }

      // 服務端確認核心、人數、事件都沒變：連 room 都不下發，直接跳過渲染
      if (res.unchanged) return;

      if (res.room) {
        setRoom(res.room);
        applyRoomState(res.room, res.isHost === true);
      }
      if (hasEvents) {
        sinceRef.current = Math.max(
          sinceRef.current,
          ...(res.events || []).map((e) => e.seq)
        );
        setEvents((prev) => [...prev, ...(res.events || [])].slice(-100));
      }
    };

    const schedule = (delay?: number) => {
      if (cancelled) return;
      if (timer) clearTimeout(timer);
      let base = POLL_INTERVAL_MS;
      if (
        !visibleRef.current ||
        (typeof document !== 'undefined' && document.hidden)
      ) {
        base = POLL_HIDDEN_INTERVAL_MS;
      } else if (!isHostRef.current) {
        base =
          idlePollsRef.current >= 3 ? POLL_IDLE_INTERVAL_MS : POLL_INTERVAL_MS;
        if (idlePollsRef.current >= 12) base = 4000;
      }
      const jitter = 1 + (Math.random() * 2 - 1) * POLL_JITTER;
      const wait = delay ?? Math.max(600, Math.round(base * jitter));
      timer = setTimeout(async () => {
        if (cancelled) return;
        await tick();
        schedule();
      }, wait);
    };

    const wake = () => {
      idlePollsRef.current = 0;
      schedule(50);
    };
    wakeRef.current = wake;

    const onVisibility = () => {
      if (!document.hidden && visibleRef.current) wake();
    };
    document.addEventListener('visibilitychange', onVisibility);

    schedule(50);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      wakeRef.current = noopWake;
    };
  }, [
    roomId,
    artPlayerRef,
    currentEpisodeIndex,
    videoTitle,
    applyRoomState,
    resetLocal,
    loadSavedRoom,
  ]);

  // 綁定播放器事件：房主的播放 / 暫停 / 拖動立即廣播，不等下一輪心跳
  useEffect(() => {
    if (!roomId) return;
    let timer: ReturnType<typeof setInterval> | null = null;

    const unbind = () => {
      const art = artBoundRef.current;
      const handlers = handlersRef.current;
      if (art && handlers && typeof art.off === 'function') {
        try {
          art.off('play', handlers.play);
          art.off('pause', handlers.pause);
          art.off('video:seeked', handlers.seeked);
        } catch {
          // 播放器實例可能已被切源 / 切集銷毀
        }
      }
      artBoundRef.current = null;
      handlersRef.current = null;
    };

    const bind = () => {
      const art = artPlayerRef.current;
      if (!art || typeof art.on !== 'function') return;
      if (artBoundRef.current === art) return;
      unbind();

      const send = (kind: ControlKind) => {
        if (
          !isHostRef.current ||
          !roomIdRef.current ||
          !memberIdRef.current ||
          !alignedRef.current ||
          Date.now() < broadcastAfterRef.current ||
          Date.now() < applyingUntilRef.current // 屏蔽遠端應用產生的回聲
        ) {
          return;
        }
        const player = artPlayerRef.current;
        if (!player) return;
        void roomRequest({
          action: 'control',
          roomId: roomIdRef.current,
          memberId: memberIdRef.current,
          kind,
          time: player.currentTime || 0,
          playing: !player.paused,
        });
        wakeRef.current();
      };

      const handlers = {
        play: () => send('play'),
        pause: () => send('pause'),
        seeked: () => send('seek'),
      };
      art.on('play', handlers.play);
      art.on('pause', handlers.pause);
      art.on('video:seeked', handlers.seeked);
      handlersRef.current = handlers;
      artBoundRef.current = art;
    };

    bind();
    // ArtPlayer 為動態 import，且切源 / 切集可能重建實例
    timer = setInterval(bind, 500);
    return () => {
      if (timer) clearInterval(timer);
      unbind();
    };
  }, [roomId, artPlayerRef]);

  // 成員與房主不在同一集時給出提示（不自動跳轉，避免打斷用戶）
  useEffect(() => {
    if (!room || isHost) {
      setEpisodeMismatch(false);
      return;
    }
    setEpisodeMismatch(!!room.playPath && room.playPath !== currentPlayPath());
  }, [room, isHost, currentEpisodeIndex]);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [events]);

  const sendChat = useCallback(async () => {
    const text = input.trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!text || !roomIdRef.current || !memberIdRef.current) return;
    setInput('');
    const generation = sessionGenerationRef.current;
    const res = await roomRequest({
      action: 'chat',
      roomId: roomIdRef.current,
      memberId: memberIdRef.current,
      text,
    });
    if (!mountedRef.current || generation !== sessionGenerationRef.current)
      return;
    if (!res.ok) {
      setInput(text);
      setErrorText(res.error || '發送失敗');
    } else {
      wakeRef.current();
    }
  }, [input]);

  const copyInvite = useCallback(async () => {
    if (!room) return;
    const url = buildInviteUrl(room);
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      showHint('邀請鏈接已復制，發給伙伴即可一起看');
    } catch {
      window.prompt('復制這個鏈接發給伙伴：', url);
    }
  }, [room, showHint]);

  const followHost = useCallback(() => {
    if (!room) return;
    const url = buildInviteUrl(room);
    if (url) window.location.href = url;
  }, [room]);

  /** 房主快速公開 / 取消公開：公開後會出現在「觀影室」頁面的公開列表 */
  const togglePublic = useCallback(async () => {
    if (!room || !roomIdRef.current) return;
    const nextPublic = room.isPublic !== true;
    setBusy(true);
    setErrorText('');
    const generation = sessionGenerationRef.current;
    const res = await roomRequest({
      action: 'setPublic',
      roomId: roomIdRef.current,
      public: nextPublic,
    });
    if (!mountedRef.current || generation !== sessionGenerationRef.current)
      return;
    setBusy(false);
    if (!res.ok || !res.room) {
      setErrorText(res.error || '設置公開狀態失敗');
      return;
    }
    setRoom(res.room);
    if (res.rev !== undefined) revRef.current = res.rev;
    if (res.memberCount !== undefined) {
      countRef.current = res.memberCount;
      setMemberCount(res.memberCount);
    }
    showHint(
      nextPublic ? '房間已公開，其他人可在觀影室頁面加入' : '房間已取消公開'
    );
  }, [room, showHint]);

  const setSyncMode = useCallback(async (nextMode: 'auto' | 'manual') => {
    if (!roomIdRef.current || !memberIdRef.current) return;
    const requestId = ++latestSyncModeRequestRef.current;
    setOptimisticSyncMode(nextMode);
    const generation = sessionGenerationRef.current;
    const res = await roomRequest({
      action: 'setSyncMode',
      roomId: roomIdRef.current,
      memberId: memberIdRef.current,
      syncMode: nextMode,
    });
    if (!mountedRef.current || generation !== sessionGenerationRef.current)
      return;
    if (requestId !== latestSyncModeRequestRef.current) {
      return;
    }
    if (!res.ok || !res.room) {
      setOptimisticSyncMode(null);
      setErrorText(res.error || '切換同步模式失敗');
      return;
    }
    setOptimisticSyncMode(null);
    setRoom(res.room);
    if (res.rev !== undefined) revRef.current = res.rev;
    if (res.memberCount !== undefined) {
      countRef.current = res.memberCount;
      setMemberCount(res.memberCount);
    }
    if (res.mySyncMode) mySyncModeRef.current = res.mySyncMode;
    if (!isHostRef.current) {
      alignedRef.current = false;
    }
    wakeRef.current();
  }, []);

  const syncProgressOnce = useCallback(async () => {
    if (!roomIdRef.current || !memberIdRef.current) return;
    const generation = sessionGenerationRef.current;
    const res = await roomRequest({
      action: 'sync',
      roomId: roomIdRef.current,
      memberId: memberIdRef.current,
      since: sinceRef.current,
      name: displayName(),
      playPath: isHostRef.current ? currentPlayPath() : undefined,
      title: isHostRef.current ? videoTitle : undefined,
      episode: isHostRef.current ? currentEpisodeIndex + 1 : undefined,
      local:
        isHostRef.current && artPlayerRef.current
          ? {
              time: artPlayerRef.current.currentTime || 0,
              playing: !artPlayerRef.current.paused,
            }
          : undefined,
    });
    if (!mountedRef.current || generation !== sessionGenerationRef.current)
      return;

    if (!res.ok || !res.room) {
      setErrorText(res.error || '同步失敗');
      showHint('同步失敗，請稍後重試');
      return;
    }

    setRoom(res.room);
    if (res.rev !== undefined) revRef.current = res.rev;
    if (res.memberCount !== undefined) {
      countRef.current = res.memberCount;
      setMemberCount(res.memberCount);
    }
    if (res.mySyncMode) mySyncModeRef.current = res.mySyncMode;
    alignedRef.current = false;
    applyRoomState(res.room, res.isHost === true, true);
    const nextEvents = res.events ?? [];
    if (nextEvents.length) {
      sinceRef.current = Math.max(
        sinceRef.current,
        ...nextEvents.map((e) => e.seq)
      );
      setEvents((prev) => [...prev, ...nextEvents].slice(-100));
    }
    showHint('同步成功');
  }, [artPlayerRef, currentEpisodeIndex, videoTitle, applyRoomState, showHint]);

  const myCurrentSyncMode = room ? resolveMemberSyncMode(room) : 'auto';
  const effectiveSyncMode = optimisticSyncMode ?? myCurrentSyncMode;
  const latestSyncModeRequestRef = useRef(0);

  const statusText =
    connected === 'online'
      ? '已連接'
      : connected === 'error'
      ? '重連中'
      : connected === 'connecting'
      ? '連接中'
      : '未連接';

  /** 「我的觀影室」卡片的人數：服務端已按 presence 實時統計，0 就明確顯示無人 */
  const savedRoomCount = Math.max(0, Number(savedRoom?.memberCount) || 0);
  const savedRoomCap = normalizeCapacity(savedRoom?.maxMembers);
  const savedRoomCountText = savedRoomCount
    ? `當前 ${savedRoomCount}${savedRoomCap ? ` / ${savedRoomCap}` : ''} 人在線`
    : savedRoomCap
    ? `當前無人在線 · 上限 ${savedRoomCap} 人`
    : '當前無人在線';

  return (
    <div
      ref={rootRef}
      className={
        compact
          ? 'flex h-full min-h-0 flex-col'
          : 'rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5 md:p-6 dark:bg-white/[0.03] dark:ring-white/10'
      }
    >
      <div className='flex shrink-0 items-center justify-between gap-2'>
        <div className='flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5'>
          <span
            className={`font-semibold ${compact ? 'text-sm' : 'text-base'}`}
          >
            {room?.title || room?.videoTitle || '🎬 共同觀影室'}
          </span>
          {room && (
            <span className='truncate text-xs text-gray-500 dark:text-gray-400'>
              房間 {room.id} · {isHost ? '房主' : '成員'} · {statusText} ·{' '}
              {memberCount}
              {normalizeCapacity(room.maxMembers)
                ? ` / ${normalizeCapacity(room.maxMembers)}`
                : ''}{' '}
              人
            </span>
          )}
        </div>
        {!compact && (
          <button
            type='button'
            onClick={() => setExpanded((v) => !v)}
            className='shrink-0 rounded-lg px-3 py-1.5 text-sm text-gray-600 ring-1 ring-black/10 transition hover:bg-black/5 dark:text-gray-300 dark:ring-white/15 dark:hover:bg-white/10'
          >
            {expanded ? '收起' : room ? '打開面板' : '一起看'}
          </button>
        )}
      </div>

      {errorText && (
        <p className='mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400'>
          {errorText}
        </p>
      )}
      {hint && (
        <p className='mt-3 rounded-lg bg-green-500/10 px-3 py-2 text-sm text-green-700 dark:text-green-400'>
          {hint}
        </p>
      )}

      {expanded && !room && (
        <div
          className={compact ? 'mt-3 min-h-0 flex-1 overflow-y-auto' : 'mt-4'}
        >
          {/* 查詢「我的觀影室」失敗：顯式報錯 + 手動重試，不靜默回落到創建表單 */}
          {savedRoomError && (
            <div className='mb-4 rounded-xl border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/30'>
              <p className='text-sm font-medium text-red-700 dark:text-red-300'>
                讀取我的觀影室失敗
              </p>
              <p className='mt-1 break-words text-xs leading-relaxed text-red-600 dark:text-red-400'>
                {savedRoomError}
              </p>
              <button
                type='button'
                onClick={() => void loadSavedRoom()}
                disabled={savedRoomLoading}
                className='mt-3 inline-flex items-center gap-2 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:bg-white/5 dark:text-red-300 dark:hover:bg-red-950/60'
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${
                    savedRoomLoading ? 'animate-spin' : ''
                  }`}
                />
                {savedRoomLoading ? '正在重試…' : '重試'}
              </button>
            </div>
          )}

          {savedRoomLoading && !savedRoomError && (
            <p className='mb-4 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400'>
              <LoaderCircle className='h-3.5 w-3.5 animate-spin' />
              正在讀取我的觀影室…
            </p>
          )}

          {/* 已創建房間：只展示，不自動連接，由用戶手動點按鈕加入 */}
          {savedRoom && (
            <div className='mb-4 rounded-xl border border-green-500/30 bg-green-500/5 p-3 dark:border-green-500/25 dark:bg-green-500/10'>
              <div className='mb-2 flex items-start justify-between gap-2'>
                <div className='min-w-0'>
                  <p className='text-xs font-medium text-green-700 dark:text-green-400'>
                    我的觀影室
                  </p>
                  <p className='mt-0.5 truncate text-sm font-semibold text-gray-900 dark:text-white'>
                    {savedRoom.title || savedRoom.videoTitle || '共同觀影室'}
                  </p>
                </div>
                <span className='shrink-0 rounded-md bg-white/60 px-2 py-0.5 font-mono text-xs tracking-wider text-green-700 ring-1 ring-green-500/20 dark:bg-white/5 dark:text-green-400'>
                  {savedRoom.id}
                </span>
              </div>
              <p className='truncate text-xs text-gray-500 dark:text-gray-400'>
                當前影片：
                {savedRoom.playPath === '/play'
                  ? '尚未開始播放'
                  : savedRoom.videoTitle || savedRoom.title || '共同觀影室'}
                {savedRoom.episode > 1 ? ` · 第 ${savedRoom.episode} 集` : ''}
              </p>
              <div className='mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500 dark:text-gray-400'>
                <span>{savedRoomCountText}</span>
                {savedRoom.isPublic && <span>· 已公開</span>}
                {savedRoom.enabled === false && (
                  <span className='rounded-full bg-gray-500/10 px-1.5 py-0.5 text-gray-600 dark:text-gray-300'>
                    已關閉（加入後重新開啟）
                  </span>
                )}
              </div>
              <button
                type='button'
                onClick={() => void joinSavedRoom()}
                disabled={joiningSaved || busy}
                className='mt-3 w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50'
              >
                {joiningSaved ? '正在加入…' : '加入我的觀影室'}
              </button>
              <p className='mt-2 text-xs leading-relaxed text-gray-500 dark:text-gray-400'>
                進入其它影片時不會自動連回房間，點上方按鈕才會連接並同步。
              </p>
            </div>
          )}

          {/* 一個帳號只能有一個持久房間：已有房間時收起創建表單 */}
          {!savedRoom && !savedRoomError && !savedRoomLoading && (
            <>
              <div className='mb-3'>
                <label className='mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400'>
                  房間名稱
                </label>
                <input
                  value={roomNameInput}
                  onChange={(e) =>
                    setRoomNameInput(e.target.value.slice(0, 20))
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !busy) void createRoom();
                  }}
                  aria-label='房間名稱'
                  placeholder='共同觀影室'
                  className='w-full rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-gray-400 focus:border-blue-500 dark:border-white/15 dark:placeholder:text-gray-500'
                />
              </div>
              <div className='mb-3'>
                <label className='mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400'>
                  人數上限（默認 {DEFAULT_ROOM_CAPACITY} 人）
                </label>
                <input
                  value={capacityInput}
                  onChange={(e) =>
                    setCapacityInput(
                      e.target.value.replace(/[^\d]/g, '').slice(0, 3)
                    )
                  }
                  onBlur={() => {
                    const cap = normalizeCapacity(capacityInput);
                    setCapacityInput(cap ? String(cap) : '');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !busy) void createRoom();
                  }}
                  inputMode='numeric'
                  aria-label='人數上限'
                  title={`默認 ${DEFAULT_ROOM_CAPACITY} 人，最多 ${MAX_ROOM_CAPACITY} 人`}
                  placeholder={`默認 ${DEFAULT_ROOM_CAPACITY} 人`}
                  className='w-full rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-gray-400 focus:border-blue-500 dark:border-white/15 dark:placeholder:text-gray-500'
                />
              </div>
            </>
          )}
          <div
            className={
              compact
                ? 'flex flex-col gap-2'
                : 'flex flex-col gap-3 sm:flex-row sm:items-center'
            }
          >
            {!savedRoom && !savedRoomError && !savedRoomLoading && (
              <button
                type='button'
                onClick={() => void createRoom()}
                disabled={busy}
                className='rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50'
              >
                {busy ? '處理中…' : '創建房間'}
              </button>
            )}
            <div className='flex flex-1 gap-2'>
              <input
                value={joinCode}
                onChange={(e) =>
                  setJoinCode(e.target.value.toUpperCase().slice(0, 7))
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void joinRoom(joinCode);
                }}
                placeholder={
                  savedRoom ? '輸入其它房間號' : '輸入 6 至 7 位房間號'
                }
                className='min-w-0 flex-1 rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-white/15'
              />
              <button
                type='button'
                onClick={() => void joinRoom(joinCode)}
                disabled={busy || !joinCode.trim()}
                className='rounded-lg px-4 py-2 text-sm font-medium text-blue-600 ring-1 ring-blue-500/40 transition hover:bg-blue-500/10 disabled:opacity-40'
              >
                加入
              </button>
            </div>
          </div>
          <p className='mt-2 text-xs leading-relaxed text-gray-500 dark:text-gray-400'>
            {savedRoom
              ? '也可以輸入別人分享的房間號加入其它觀影室。'
              : savedRoomError || savedRoomLoading
              ? '也可以直接輸入房間號加入其它觀影室。'
              : compact
              ? '復制邀請鏈接發給伙伴，鏈接自帶片源與集數；房主控制播放，其他人自動跟隨。'
              : '創建後復制邀請鏈接發給伙伴。邀請鏈接會帶上當前的片源與集數，保證大家看的是同一集；房間內由房主控制播放，其他人自動跟隨進度。'}
          </p>
        </div>
      )}

      {settingsOpen && room && (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm'>
          <div className='w-full max-w-md rounded-2xl bg-white p-4 shadow-2xl dark:bg-[#111827]'>
            <div className='mb-4 flex items-center justify-between'>
              <h3 className='text-base font-semibold'>房間設置</h3>
              <button
                type='button'
                onClick={() => setSettingsOpen(false)}
                className='rounded-lg px-2 py-1 text-sm text-gray-500 transition hover:bg-black/5 dark:text-gray-300 dark:hover:bg-white/10'
              >
                關閉
              </button>
            </div>

            <div className='space-y-4'>
              <div>
                <p className='mb-2 text-xs font-medium text-gray-500 dark:text-gray-400'>
                  同步模式
                </p>
                <div className='flex gap-2 rounded-xl bg-black/[0.03] p-1 dark:bg-white/[0.04]'>
                  {(['auto', 'manual'] as const).map((mode) => {
                    const selected = isHost
                      ? (optimisticSyncMode ?? room.defaultSyncMode) === mode
                      : effectiveSyncMode === mode;
                    return (
                      <button
                        key={mode}
                        type='button'
                        onClick={() => void setSyncMode(mode)}
                        className={`flex-1 rounded-lg px-3 py-2 text-sm transition ${
                          selected
                            ? 'bg-blue-600 text-white'
                            : 'text-gray-600 hover:bg-black/5 dark:text-gray-300 dark:hover:bg-white/10'
                        }`}
                      >
                        {mode === 'auto' ? '自動同步' : '手動同步'}
                      </button>
                    );
                  })}
                </div>
                <div className='mt-3 rounded-lg bg-black/[0.03] px-3 py-2 text-sm dark:bg-white/[0.04]'>
                  <div className='flex items-center justify-between gap-2 text-gray-600 dark:text-gray-200'>
                    <span>當前同步時間</span>
                    <span className='font-medium tabular-nums text-blue-600 dark:text-blue-400'>
                      {formatDuration(room.state?.time ?? 0)}
                    </span>
                  </div>
                </div>
                {!isHost && effectiveSyncMode === 'manual' && (
                  <button
                    type='button'
                    onClick={() => {
                      setSettingsOpen(false);
                      void syncProgressOnce();
                    }}
                    className='mt-3 w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-700'
                  >
                    同步一次
                  </button>
                )}
                <p className='mt-2 text-[11px] leading-relaxed text-gray-400'>
                  {isHost
                    ? '房主設置默認同步模式，其他成員可自行覆蓋自己的同步模式。'
                    : '你當前可單獨設置自己的同步模式，不會影響房主默認值。'}
                </p>
              </div>

              <div>
                <p className='mb-2 text-xs font-medium text-gray-500 dark:text-gray-400'>
                  在線成員
                </p>
                <div className='space-y-1.5'>
                  {room.members.slice(0, MEMBER_PREVIEW_LIMIT).map((member) => (
                    <div
                      key={member.id}
                      className='flex items-center gap-2 rounded-lg bg-black/[0.03] px-2.5 py-1.5 text-sm dark:bg-white/[0.04]'
                    >
                      <span className='h-1.5 w-1.5 shrink-0 rounded-full bg-green-500' />
                      <span className='min-w-0 flex-1 truncate'>
                        {member.name}
                      </span>
                      {member.id === room.hostId && (
                        <span className='rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] text-blue-600 dark:text-blue-400'>
                          房主
                        </span>
                      )}
                      <span className='text-[10px] text-gray-500 dark:text-gray-400'>
                        {member.syncMode === 'manual' ? '手動' : '自動'}
                      </span>
                    </div>
                  ))}
                </div>
                {(memberCount || room.memberCount || 0) >
                  room.members.length && (
                  <p className='mt-1.5 text-[11px] leading-relaxed text-gray-400'>
                    僅顯示前 {room.members.length} 人，共{' '}
                    {memberCount || room.memberCount} 人在線
                  </p>
                )}
              </div>

              {isHost && room.persistent && (
                <div>
                  <p className='mb-2 text-xs font-medium text-gray-500 dark:text-gray-400'>
                    公開設置
                  </p>
                  <button
                    type='button'
                    onClick={() => void togglePublic()}
                    disabled={busy || room.enabled === false}
                    className={`w-full rounded-lg px-3 py-2 text-sm font-medium transition disabled:opacity-50 ${
                      room.isPublic
                        ? 'bg-green-600 text-white hover:bg-green-700'
                        : 'text-gray-700 ring-1 ring-black/10 hover:bg-black/5 dark:text-gray-200 dark:ring-white/15 dark:hover:bg-white/10'
                    }`}
                  >
                    {room.isPublic
                      ? '已公開到觀影室列表（點擊取消）'
                      : '公開到觀影室列表'}
                  </button>
                  <p className='mt-2 text-[11px] leading-relaxed text-gray-400'>
                    公開後，其他用戶可以在「觀影室」頁面看到這個房間並直接加入。
                  </p>
                </div>
              )}

              <div className='grid grid-cols-2 gap-2'>
                <button
                  type='button'
                  onClick={() => {
                    void copyInvite();
                    setSettingsOpen(false);
                  }}
                  className='rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-green-700'
                >
                  復制鏈接
                </button>
                <button
                  type='button'
                  onClick={() => {
                    void leaveRoom();
                    setSettingsOpen(false);
                  }}
                  className='rounded-lg px-3 py-2 text-sm text-gray-600 ring-1 ring-black/10 transition hover:bg-black/5 dark:text-gray-300 dark:ring-white/15 dark:hover:bg-white/10'
                >
                  離開房間
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {expanded && room && (
        <div
          className={
            compact
              ? 'mt-2 flex min-h-0 flex-1 flex-col gap-2'
              : 'mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_240px]'
          }
        >
          <div className={compact ? 'flex min-h-0 flex-1 flex-col' : 'min-w-0'}>
            {episodeMismatch && (
              <button
                type='button'
                onClick={followHost}
                className='mb-2 w-full rounded-lg bg-amber-500/15 px-3 py-2 text-sm text-amber-700 dark:text-amber-300'
              >
                房主已切換到第 {room.episode} 集，點此跟隨 →
              </button>
            )}
            <div
              ref={listRef}
              className={`overflow-y-auto rounded-xl bg-black/[0.03] p-3 text-sm dark:bg-white/[0.04] ${
                compact ? 'min-h-[64px] flex-1' : 'h-60'
              }`}
            >
              {events.length === 0 && (
                <p className='text-center text-xs text-gray-400'>
                  還沒有消息，打個招呼吧～
                </p>
              )}
              {events.map((event) => {
                const key = `${event.seq}-${event.actorId}`;

                // 系統提示 / 播放控制提示仍保持居中，不參與左右分列，
                // 否則會打斷聊天氣泡的對話節奏。
                if (event.type !== 'chat') {
                  return (
                    <div key={key} className='mb-2 text-center'>
                      <span
                        className={`inline-block max-w-full rounded-full px-2.5 py-0.5 text-[11px] leading-relaxed ${
                          event.type === 'control'
                            ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                            : 'text-gray-400'
                        }`}
                      >
                        {event.type === 'control'
                          ? `• ${event.text}`
                          : `— ${event.text} —`}
                      </span>
                    </div>
                  );
                }

                // 自愈重入會換 memberId，用歷次 id 集合判定，避免舊消息跳到左邊
                const isMine =
                  event.actorId === myId || myIdsRef.current.has(event.actorId);
                const clock = formatClock(event.at);

                // 四個角顯式寫全，避免 rounded-2xl 與單角類互相覆蓋時
                // 受 Tailwind CSS 聲明順序影響；小角即 QQ 氣泡的「尾巴」。
                const bubbleShape = isMine
                  ? 'rounded-tl-2xl rounded-tr-2xl rounded-bl-2xl rounded-br-sm'
                  : 'rounded-tl-2xl rounded-tr-2xl rounded-bl-sm rounded-br-2xl';

                return (
                  <div
                    key={key}
                    className={`mb-2.5 flex ${
                      isMine ? 'justify-end' : 'justify-start'
                    }`}
                  >
                    <div
                      className={`flex min-w-0 max-w-[88%] flex-col ${
                        isMine ? 'items-end' : 'items-start'
                      }`}
                    >
                      <div className='mb-1 flex max-w-full items-center gap-1.5 px-1 text-[11px] leading-none text-gray-400'>
                        {!isMine && (
                          <span className='max-w-[110px] truncate font-medium text-blue-600 dark:text-blue-400'>
                            {event.actorName}
                          </span>
                        )}
                        {clock && (
                          <span className='shrink-0 tabular-nums'>{clock}</span>
                        )}
                      </div>
                      <div
                        className={`${bubbleShape} whitespace-pre-wrap break-words shadow-sm ${
                          compact
                            ? 'px-2.5 py-1.5 text-[13px]'
                            : 'px-3 py-2 text-sm'
                        } leading-relaxed ${
                          isMine
                            ? 'bg-blue-600 text-white'
                            : 'bg-white text-gray-800 ring-1 ring-black/5 dark:bg-white/10 dark:text-gray-100 dark:ring-white/10'
                        }`}
                      >
                        {event.text}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className='mt-2 flex shrink-0 gap-2'>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void sendChat();
                }}
                maxLength={MAX_MESSAGE_LENGTH}
                placeholder='說點什麼…'
                className='min-w-0 flex-1 rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-white/15'
              />
              <button
                type='button'
                onClick={() => void sendChat()}
                disabled={!input.trim()}
                className='rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-40'
              >
                發送
              </button>
            </div>
          </div>

          <div className={compact ? 'shrink-0' : 'min-w-0'}>
            <div className={compact ? 'flex gap-2' : 'space-y-2'}>
              <button
                type='button'
                onClick={() => setSettingsOpen(true)}
                className={`rounded-lg bg-slate-700 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-800 ${
                  compact ? 'flex-1' : 'w-full'
                }`}
              >
                設置
              </button>
            </div>
            {storeKind === 'memory' && (
              <p
                className={`text-[11px] leading-relaxed text-gray-400 ${
                  compact ? 'mt-1.5' : 'mt-3'
                }`}
              >
                {compact
                  ? '記憶體儲存：多實例部署需配置 Supabase。'
                  : '目前使用單進程記憶體儲存。多實例 / Serverless 部署需配置 Supabase，否則房間狀態無法跨實例共享。'}
              </p>
            )}
            {/* 緊湊模式（側欄 Tab）空間有限，只保留需要用戶處理的警告；
                Supabase 正常態與「成員跟隨」說明在標題欄已能看出，不額外佔高度。 */}
            {!compact && storeKind === 'supabase' && (
              <p className='mt-3 text-[11px] leading-relaxed text-gray-400'>
                房間狀態儲存於 Supabase，可跨實例共享。
              </p>
            )}
            {!compact && !isHost && (
              <p className='mt-3 text-[11px] leading-relaxed text-gray-400'>
                進度由房主統一控制；你拖動進度條後會自動被拉回。
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
