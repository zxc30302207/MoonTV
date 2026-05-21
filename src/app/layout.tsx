/* eslint-disable @typescript-eslint/no-explicit-any */

import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { Suspense } from 'react';

import './globals.css';
import 'sweetalert2/dist/sweetalert2.min.css';

import { getConfig } from '@/lib/config';

import AuthBootstrap from '../components/AuthBootstrap';
import ConditionalNav from '../components/ConditionalNav';
import GlobalDownloadManager from '../components/GlobalDownloadManager';
import { GlobalErrorIndicator } from '../components/GlobalErrorIndicator';
import { NavigationLoadingIndicator } from '../components/NavigationLoadingIndicator';
import { NavigationLoadingProvider } from '../components/NavigationLoadingProvider';
import ServiceWorkerRegistration from '../components/ServiceWorkerRegistration';
import { SiteProvider } from '../components/SiteProvider';
import SubscriptionAutoUpdate from '../components/SubscriptionAutoUpdate';
import { ThemeProvider } from '../components/ThemeProvider';
import UserOnlineUpdate from '../components/UserOnlineUpdate';

export const runtime = 'nodejs';

const inter = Inter({ subsets: ['latin'] });

// 動態生成 metadata，支持配置更新後的標題變化
export async function generateMetadata(): Promise<Metadata> {
  let siteName = process.env.NEXT_PUBLIC_SITE_NAME || 'MoonTV';
  if (process.env.NEXT_PUBLIC_STORAGE_TYPE !== 'localstorage') {
    const config = await getConfig();
    siteName = config.SiteConfig.SiteName;
  }

  return {
    title: siteName,
    description: '影視聚合',
    manifest: '/manifest.json',
  };
}

export const viewport: Viewport = {
  viewportFit: 'cover',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';

  let siteName = process.env.NEXT_PUBLIC_SITE_NAME || 'MoonTV';
  let announcement =
    process.env.ANNOUNCEMENT ||
    '本網站僅提供影視信息搜索服務，所有內容均來自第三方網站。本站不存儲任何視頻資源，不對任何內容的準確性、合法性、完整性負責。';
  let enableRegister = process.env.NEXT_PUBLIC_ENABLE_REGISTER === 'true';
  let doubanProxyType = process.env.NEXT_PUBLIC_DOUBAN_PROXY_TYPE || 'direct';
  let doubanProxy = process.env.NEXT_PUBLIC_DOUBAN_PROXY || '';
  let doubanImageProxyType =
    process.env.NEXT_PUBLIC_DOUBAN_IMAGE_PROXY_TYPE || 'server';
  let doubanImageProxy = process.env.NEXT_PUBLIC_DOUBAN_IMAGE_PROXY || '';
  let disableYellowFilter =
    process.env.NEXT_PUBLIC_DISABLE_YELLOW_FILTER === 'true';
  let autoUpdateEnabled = false;
  const isCloudPlatform =
    process.env.CF_PAGES === '1' ||
    process.env.CLOUDFLARE_PAGES === '1' ||
    process.env.VERCEL === '1' ||
    process.env.NETLIFY === 'true';
  const pwaEnabled = process.env.NODE_ENV !== 'development' && !isCloudPlatform;
  if (storageType !== 'localstorage') {
    const config = await getConfig();
    siteName = config.SiteConfig.SiteName;
    announcement = config.SiteConfig.Announcement;
    enableRegister = config.UserConfig.AllowRegister;
    doubanProxyType = config.SiteConfig.DoubanProxyType;
    doubanProxy = config.SiteConfig.DoubanProxy;
    doubanImageProxyType = config.SiteConfig.DoubanImageProxyType;
    doubanImageProxy = config.SiteConfig.DoubanImageProxy;
    disableYellowFilter = config.SiteConfig.DisableYellowFilter;
    autoUpdateEnabled = config.SubscriptionConfig?.autoUpdate === true;
  }

  // 將運行時配置注入到全局 window 對象，供客戶端在運行時讀取
  const runtimeConfig = {
    STORAGE_TYPE: process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage',
    ENABLE_REGISTER: enableRegister,
    DOUBAN_PROXY_TYPE: doubanProxyType,
    DOUBAN_PROXY: doubanProxy,
    DOUBAN_IMAGE_PROXY_TYPE: doubanImageProxyType,
    DOUBAN_IMAGE_PROXY: doubanImageProxy,
    DISABLE_YELLOW_FILTER: disableYellowFilter,
    DANMU_API_BASE_URL: '/api/danmaku',
  };

  return (
    <html lang='zh-TW' suppressHydrationWarning>
      <head>
        <meta
          name='viewport'
          content='width=device-width, initial-scale=1.0, viewport-fit=cover'
        />
        <link rel='apple-touch-icon' href='/icons/icon-192x192.png' />
        {/* 將配置序列化後直接寫入腳本，瀏覽器端可通過 window.RUNTIME_CONFIG 獲取 */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script
          dangerouslySetInnerHTML={{
            __html: `window.RUNTIME_CONFIG = ${JSON.stringify(runtimeConfig)};`,
          }}
        />
      </head>
      <body
        className={`${inter.className} min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-200`}
      >
        <ThemeProvider
          attribute='class'
          defaultTheme='system'
          enableSystem
          disableTransitionOnChange
        >
          <ServiceWorkerRegistration enabled={pwaEnabled} />
          <AuthBootstrap />
          <Suspense fallback={null}>
            <NavigationLoadingProvider>
              <SiteProvider siteName={siteName} announcement={announcement}>
                <NavigationLoadingIndicator />
                <UserOnlineUpdate />

                {/* 條件導航欄 - 根據路徑自動判斷是否顯示 */}
                <ConditionalNav />

                {/* 全局下載管理器 - 只渲染一次，被所有導航欄共享 */}
                <GlobalDownloadManager />

                {/* 頁面內容 */}
                <div className='relative w-full'>
                  <main
                    className='flex-1 mb-14 md:mb-0'
                    style={{
                      paddingBottom:
                        'calc(3.5rem + env(safe-area-inset-bottom))',
                    }}
                  >
                    {children}
                  </main>
                </div>

                <GlobalErrorIndicator />
                {autoUpdateEnabled && <SubscriptionAutoUpdate />}
              </SiteProvider>
            </NavigationLoadingProvider>
          </Suspense>
        </ThemeProvider>
      </body>
    </html>
  );
}
