/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, no-console, @next/next/no-img-element */

'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import AddDownloadModal from '@/components/AddDownloadModal';
import { BackButton } from '@/components/BackButton';
import CacheManager from '@/components/CacheManager';
import DanmakuSelector from '@/components/DanmakuSelector';
import EpisodeSelector from '@/components/EpisodeSelector';
import PageLayout from '@/components/PageLayout';

import { PlayerOverlayHeader } from './components/PlayerOverlayHeader';
import {
  ErrorView,
  LoadingView,
  VideoLoadingMask,
} from './components/PlayStatusView';
import { VideoDetailPanel } from './components/VideoDetailPanel';
import { formatTime } from './play-utils';
import { usePlayEngine } from './usePlayEngine';

/** 避免點到浮層時把點擊傳到 ArtPlayer（會誤觸發播放/暫停） */
function stopPlayerPointer(event: { stopPropagation: () => void }) {
  event.stopPropagation();
}

/**
 * 播放頁客戶端組件。
 *
 * 僅負責：調用 {@link usePlayEngine} 獲取狀態/回調，並按視圖分層渲染。
 * 加載、錯誤、視頻遮罩、詳情面板等均已拆分為獨立展示組件。
 */
export default function PlayClient() {
  const router = useRouter();
  const [showAddDownload, setShowAddDownload] = useState(false);

  const {
    // 加載 / 錯誤
    loading,
    loadingStage,
    loadingMessage,
    error,
    // 視頻與元數據
    detail,
    totalEpisodes,
    videoTitle,
    videoYear,
    videoDoubanId,
    currentSource,
    currentId,
    searchTitle,
    currentEpisodeIndex,
    videoUrl,
    skipConfig,
    // 播放器
    artRef,
    playerHost,
    preview,
    isVideoLoading,
    videoLoadingStage,
    setLoading,
    setIsVideoLoading,
    setVideoLoadingStage,
    // 源 / 換源
    availableSources,
    sourceSearchLoading,
    sourceSearchError,
    precomputedVideoInfo,
    preferBestSource,
    handleSourceChange,
    handleEpisodeChange,
    // 彈幕
    showDanmakuSelector,
    handleDanmakuSelect,
    handleDanmakuClose,
    // 緩存管理
    showCacheManager,
    setShowCacheManager,
    // 收藏 / 追更
    favorited,
    following,
    handleToggleFavorite,
    handleToggleFollowing,
  } = usePlayEngine();

  // 播放器內的彈窗（彈幕源 / 緩存管理）打開時鎖住頁面滾動，
  // 避免移動端未全屏時手指在遮罩上滑動仍然滾動到背後的頁面內容。
  const isPlayerModalOpen = showDanmakuSelector || showCacheManager;

  useEffect(() => {
    if (!isPlayerModalOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isPlayerModalOpen]);

  if (loading) {
    return (
      <PageLayout activePath='/play'>
        {/* 加載態也留一個返回入口：搜錯片/等太久不想等時能直接退出去。
            用絕對定位覆蓋，避免給整屏的加載視圖額外撐出滾動條。 */}
        <div className='relative'>
          <div className='absolute left-3 top-3 z-10 lg:left-[5rem] lg:top-4 2xl:left-32'>
            <BackButton showLabel />
          </div>
          <LoadingView stage={loadingStage} message={loadingMessage} />
        </div>
      </PageLayout>
    );
  }

  if (error) {
    return (
      <PageLayout activePath='/play'>
        <ErrorView
          message={error}
          videoTitle={videoTitle}
          onPrimary={() =>
            videoTitle
              ? router.push(`/search?q=${encodeURIComponent(videoTitle)}`)
              : router.back()
          }
          onRetry={() => window.location.reload()}
        />
      </PageLayout>
    );
  }

  return (
    <PageLayout activePath='/play'>
      <div className='mx-auto w-full px-3 pb-6 md:max-w-[95%] md:px-0 md:pb-10'>
        {/* 播放器 + 選集：桌面端合並為一張圓角卡片，移動端保持全寬沉浸 */}
        <div className='-mx-3 overflow-hidden md:mx-0 md:mt-4 md:rounded-2xl md:bg-white md:shadow-sm md:ring-1 md:ring-black/5 lg:mt-6 dark:md:bg-white/[0.03] dark:md:ring-white/10'>
          <div className='grid grid-cols-1 md:grid-cols-4 lg:h-[500px] xl:h-[650px] 2xl:h-[750px]'>
            {/* 播放器 */}
            <div className='h-full md:col-span-3'>
              <div
                className={`relative isolate w-full h-[300px] lg:h-full ${
                  isPlayerModalOpen ? 'z-[1200]' : ''
                }`}
              >
                <div
                  ref={artRef}
                  className='bg-black w-full h-full overflow-hidden shadow-lg'
                ></div>
                {playerHost &&
                  createPortal(
                    <>
                      <PlayerOverlayHeader
                        title={
                          videoTitle
                            ? totalEpisodes > 1
                              ? `${videoTitle} · 第 ${
                                  currentEpisodeIndex + 1
                                } 集`
                              : videoTitle
                            : ''
                        }
                      />
                      {/* 進度預覽：桌面跟隨鼠標，移動端固定居中 */}
                      {preview?.visible && (
                        <div
                          className='moontv-progress-preview pointer-events-none absolute z-40'
                          style={{
                            left: `clamp(calc(5rem + 8px), ${preview.left}%, calc(100% - 5rem - 8px))`,
                            bottom:
                              'calc(var(--art-bottom-height, 52px) - 16px)',
                            transform: 'translateX(-50%)',
                          }}
                        >
                          <div className='relative h-[90px] w-40 overflow-hidden rounded-md bg-black shadow-xl ring-1 ring-white/20'>
                            {preview.image ? (
                              <img
                                src={preview.image}
                                alt=''
                                className='block h-full w-full max-w-none object-contain'
                                draggable={false}
                              />
                            ) : (
                              <div className='flex h-full w-full items-center justify-center bg-black/60 text-xs text-white/40'>
                                加載中…
                              </div>
                            )}
                            <span className='absolute bottom-1 left-1/2 -translate-x-1/2 rounded bg-black/75 px-1.5 py-0.5 text-xs font-medium tabular-nums text-white'>
                              {formatTime(preview.time)}
                            </span>
                          </div>
                        </div>
                      )}
                      {/* 彈幕選擇器 / 緩存管理 / 提示：掛進播放器節點，網頁全屏與原生全屏都能看見 */}
                      {showDanmakuSelector && (
                        <div
                          className='moontv-player-modal'
                          onClick={stopPlayerPointer}
                          onMouseDown={stopPlayerPointer}
                        >
                          <DanmakuSelector
                            videoTitle={videoTitle}
                            isVisible={showDanmakuSelector}
                            currentEpisode={currentEpisodeIndex + 1}
                            currentEpisodeTitle={
                              detail?.episodes_titles?.[currentEpisodeIndex]
                            }
                            onSelect={handleDanmakuSelect}
                            onClose={handleDanmakuClose}
                          />
                        </div>
                      )}
                      <div
                        onClick={stopPlayerPointer}
                        onMouseDown={stopPlayerPointer}
                      >
                        <VideoLoadingMask
                          visible={isVideoLoading}
                          stage={videoLoadingStage}
                        />
                      </div>
                      {showCacheManager && (
                        <div
                          className='moontv-player-modal'
                          onClick={stopPlayerPointer}
                          onMouseDown={stopPlayerPointer}
                        >
                          <CacheManager
                            isOpen={showCacheManager}
                            onClose={() => setShowCacheManager(false)}
                          />
                        </div>
                      )}
                    </>,
                    playerHost
                  )}
              </div>
            </div>

            {/* 選集和換源 */}
            <div className='h-[300px] border-t border-black/5 md:col-span-1 md:overflow-hidden md:border-l md:border-t-0 lg:h-full dark:border-white/10'>
              <EpisodeSelector
                totalEpisodes={totalEpisodes}
                episodes_titles={detail?.episodes_titles || []}
                value={currentEpisodeIndex + 1}
                onChange={handleEpisodeChange}
                onSourceChange={handleSourceChange}
                currentSource={currentSource}
                currentId={currentId}
                videoTitle={searchTitle || videoTitle}
                availableSources={availableSources}
                sourceSearchLoading={sourceSearchLoading}
                sourceSearchError={sourceSearchError}
                precomputedVideoInfo={precomputedVideoInfo}
                preferBestSource={preferBestSource}
                setLoading={setLoading}
                setIsVideoLoading={setIsVideoLoading}
                setVideoLoadingStage={setVideoLoadingStage}
              />
            </div>
          </div>
        </div>

        {/* 詳情展示 */}
        <div className='mt-4 md:mt-6'>
          <div className='rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5 md:p-6 dark:bg-white/[0.03] dark:ring-white/10'>
            <VideoDetailPanel
              videoTitle={videoTitle}
              videoYear={videoYear}
              totalEpisodes={totalEpisodes}
              currentEpisodeIndex={currentEpisodeIndex}
              detail={detail}
              favorited={favorited}
              following={following}
              onToggleFavorite={handleToggleFavorite}
              onToggleFollowing={handleToggleFollowing}
              videoUrl={videoUrl}
              videoDoubanId={videoDoubanId}
              currentSource={currentSource}
              currentId={currentId}
              onDownload={() => setShowAddDownload(true)}
            />
          </div>
        </div>
      </div>

      {/* 添加下載彈窗 */}
      <AddDownloadModal
        isOpen={showAddDownload}
        onClose={() => setShowAddDownload(false)}
        onAddTask={(config) => {
          // 觸發自定義事件，通知導航欄的下載管理器
          if (typeof window !== 'undefined') {
            window.dispatchEvent(
              new CustomEvent('addDownloadTask', { detail: config })
            );
          }
          setShowAddDownload(false);
        }}
        initialUrl={videoUrl || ''}
        episodes={(detail?.episodes || []).map((url, i) => ({
          url,
          title: `${videoTitle}_${
            detail?.episodes_titles?.[i] || `第${i + 1}集`
          }`,
          label: detail?.episodes_titles?.[i] || `第${i + 1}集`,
        }))}
        currentEpisodeIndex={currentEpisodeIndex}
        initialTitle={`${videoTitle}${
          totalEpisodes > 1
            ? `_${
                detail?.episodes_titles?.[currentEpisodeIndex] ||
                `第${currentEpisodeIndex + 1}集`
              }`
            : ''
        }`}
        skipConfig={skipConfig}
      />
    </PageLayout>
  );
}
