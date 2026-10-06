/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, no-console, @next/next/no-img-element */

'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import AddDownloadModal from '@/components/AddDownloadModal';
import { BackButton } from '@/components/BackButton';
import CacheManager from '@/components/CacheManager';
import DanmakuSelector from '@/components/DanmakuSelector';
import EpisodeSelector from '@/components/EpisodeSelector';
import PageLayout from '@/components/PageLayout';

import {
  ErrorView,
  LoadingView,
  VideoLoadingMask,
} from './components/PlayStatusView';
import { VideoDetailPanel } from './components/VideoDetailPanel';
import { usePlayEngine } from './usePlayEngine';

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
    isDanmakuLoading,
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
      <div className='flex flex-col px-0 lg:px-[5rem] 2xl:px-32'>
        {/* 頂部操作欄：返回上一級（不想看了直接退出，不用回主頁重新找） */}
        <div className='flex items-center gap-3 px-3 pt-3 pb-2 lg:px-0 lg:pt-4'>
          <BackButton showLabel />
          {videoTitle && (
            <span className='truncate text-sm text-gray-500 dark:text-gray-400'>
              {videoTitle}
              {totalEpisodes > 1 && ` · 第 ${currentEpisodeIndex + 1} 集`}
            </span>
          )}
        </div>

        {/* 播放器和選集 */}
        <div>
          <div className='grid lg:h-[500px] xl:h-[650px] 2xl:h-[750px] grid-cols-1 md:grid-cols-4 md:gap-0'>
            {/* 播放器 */}
            <div className='h-full border-0 md:border-t md:border-b md:border-l md:border-white/0 md:dark:border-white/30 md:col-span-3'>
              <div className='relative w-full h-[300px] lg:h-full'>
                <div
                  ref={artRef}
                  className='bg-black w-full h-full overflow-hidden shadow-lg'
                ></div>

                {/* 彈幕選擇器 */}
                {showDanmakuSelector && (
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
                )}

                {/* 換源加載蒙層 */}
                <VideoLoadingMask
                  visible={isVideoLoading}
                  stage={videoLoadingStage}
                />

                {/* 彈幕加載提示 */}
                {isDanmakuLoading && (
                  <div className='absolute top-4 left-4 right-4 z-[400] flex justify-center'>
                    <div className='bg-gray-800/90 text-white px-4 py-2 rounded-lg shadow-lg'>
                      正在自動加載彈幕...
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 選集和換源 */}
            <div className='h-[300px] lg:h-full md:overflow-hidden md:col-span-1'>
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

      {/* 視頻緩存管理面板 */}
      <CacheManager
        isOpen={showCacheManager}
        onClose={() => setShowCacheManager(false)}
      />

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
