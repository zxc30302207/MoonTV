'use client';

import { BackButton } from '@/components/BackButton';

interface PlayerOverlayHeaderProps {
  title: string;
}

/**
 * 嵌在 ArtPlayer 內部的頂欄：返回 + 片名。
 *
 * 掛到 `.art-video-player` 裡，全屏（網頁/原生）時仍能看到；
 * 顯隱交給播放器控制欄狀態（見 globals.css）。
 */
export function PlayerOverlayHeader({ title }: PlayerOverlayHeaderProps) {
  return (
    <div className='moontv-play-header pointer-events-none absolute left-0 right-0 top-0 z-40 flex items-center gap-2 bg-gradient-to-b from-black/75 via-black/35 to-transparent px-3 pb-8 pt-[max(0.625rem,env(safe-area-inset-top))]'>
      <div
        className='pointer-events-auto shrink-0'
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <BackButton showLabel variant='overlay' />
      </div>
      {title ? (
        <span className='min-w-0 truncate text-sm font-medium text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]'>
          {title}
        </span>
      ) : null}
    </div>
  );
}
