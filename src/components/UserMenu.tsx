/* eslint-disable no-console,@typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */

'use client';

import {
  Check,
  ChevronDown,
  ExternalLink,
  KeyRound,
  LogOut,
  Settings,
  Shield,
  User,
  X,
} from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  clearAuthInfoCache,
  getCachedAuthInfo,
  refreshAuthInfo,
} from '@/lib/auth-client';
import { checkForUpdates, CURRENT_VERSION, UpdateStatus } from '@/lib/version';

import { useNavigationLoading } from './NavigationLoadingProvider';
import { VersionPanel } from './VersionPanel';

interface AuthInfo {
  username?: string;
  role?: 'owner' | 'admin' | 'user';
}

function formatAdultAuthExpiry(expiresAt?: number | null) {
  if (expiresAt === null) return '永久';
  if (!expiresAt) return '-';
  return new Date(expiresAt).toLocaleString('zh-TW', { hour12: false });
}

export const UserMenu: React.FC = () => {
  const router = useRouter();
  const pathname = usePathname();
  const { startLoading } = useNavigationLoading();
  const [isOpen, setIsOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [isAdultAuthOpen, setIsAdultAuthOpen] = useState(false);
  const [isVersionPanelOpen, setIsVersionPanelOpen] = useState(false);
  const [authInfo, setAuthInfo] = useState<AuthInfo | null>(null);
  const [storageType, setStorageType] = useState<string>('localstorage');
  const [mounted, setMounted] = useState(false);

  // 設置相關狀態
  const [defaultAggregateSearch, setDefaultAggregateSearch] = useState(true);
  const [defaultStreamSearch, setDefaultStreamSearch] = useState(true);
  const [simpleMode, setSimpleMode] = useState(false);
  const [doubanProxyUrl, setDoubanProxyUrl] = useState('');

  const [doubanDataSource, setDoubanDataSource] = useState('direct');
  const [doubanImageProxyType, setDoubanImageProxyType] = useState('server');
  const [doubanImageProxyUrl, setDoubanImageProxyUrl] = useState('');
  const [isDoubanDropdownOpen, setIsDoubanDropdownOpen] = useState(false);
  const [isDoubanImageProxyDropdownOpen, setIsDoubanImageProxyDropdownOpen] =
    useState(false);

  const [autoDanmakuEnabled, setAutoDanmakuEnabled] = useState(false);
  // 自動彈幕嘗試次數設置，-1為無限嘗試
  const [danmakuRetryCount, setDanmakuRetryCount] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('danmakuRetryCount');
      if (saved !== null) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed)) return parsed;
      }
    }
    return 3; // 默認重試3次
  });
  const [enablePreferBestSource, setEnablePreferBestSource] = useState(false);

  // 豆瓣數據源選項
  const doubanDataSourceOptions = [
    { value: 'direct', label: '直連（服務器直接請求豆瓣）' },
    { value: 'cors-proxy-zwei', label: 'Cors Proxy By Zwei' },
    {
      value: 'cmliussss-cdn-tencent',
      label: '豆瓣 CDN By CMLiussss（騰訊雲）',
    },
    { value: 'cmliussss-cdn-ali', label: '豆瓣 CDN By CMLiussss（阿裡雲）' },
    { value: 'custom', label: '自定義代理' },
  ];

  // 豆瓣圖片代理選項
  const doubanImageProxyTypeOptions = [
    { value: 'direct', label: '直連（瀏覽器直接請求豆瓣）' },
    { value: 'server', label: '服務器代理（由服務器代理請求豆瓣）' },
    { value: 'img3', label: '豆瓣精品 CDN（阿裡雲）' },
    {
      value: 'cmliussss-cdn-tencent',
      label: '豆瓣 CDN By CMLiussss（騰訊雲）',
    },
    { value: 'cmliussss-cdn-ali', label: '豆瓣 CDN By CMLiussss（阿裡雲）' },
    { value: 'custom', label: '自定義代理' },
  ];

  // 修改密碼相關狀態
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [adultCardCode, setAdultCardCode] = useState('');
  const [adultAuthLoading, setAdultAuthLoading] = useState(false);
  const [adultAuthError, setAdultAuthError] = useState('');
  const [adultAuthSuccess, setAdultAuthSuccess] = useState('');

  // 版本檢查相關狀態
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [isChecking, setIsChecking] = useState(true);

  // TVBox 設置
  const [tvboxEnabled, setTvboxEnabled] = useState(false);
  const [tvboxPassword, setTvboxPassword] = useState('');
  const [tvboxUrl, setTvboxUrl] = useState('');
  const isPrivileged = authInfo?.role === 'owner' || authInfo?.role === 'admin';

  const fetchTvboxConfig = async () => {
    try {
      const res = await fetch('/api/admin/tvbox', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      setTvboxEnabled(!!data.enabled);
      setTvboxPassword(data.password || '');
      setTvboxUrl(data.url || '');
    } catch (err) {
      console.warn('Failed to load TVBox admin config:', err);
    }
  };

  useEffect(() => {
    if (isSettingsOpen) {
      fetchTvboxConfig();
    }
  }, [isSettingsOpen]);

  // 確保組件已掛載
  useEffect(() => {
    setMounted(true);
  }, []);

  // 獲取認證信息和存儲類型
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const cached = getCachedAuthInfo();
      setAuthInfo(cached);
      refreshAuthInfo().then(setAuthInfo);

      const type =
        (window as any).RUNTIME_CONFIG?.STORAGE_TYPE || 'localstorage';
      setStorageType(type);
    }
  }, []);

  // 從 localStorage 讀取設置
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedAggregateSearch = localStorage.getItem(
        'defaultAggregateSearch'
      );
      if (savedAggregateSearch !== null) {
        setDefaultAggregateSearch(JSON.parse(savedAggregateSearch));
      }

      const savedDefaultStreamSearch = localStorage.getItem(
        'defaultStreamSearch'
      );
      if (savedDefaultStreamSearch !== null) {
        setDefaultStreamSearch(JSON.parse(savedDefaultStreamSearch));
      }

      const savedSimpleMode = localStorage.getItem('simpleMode');
      if (savedSimpleMode !== null) {
        setSimpleMode(JSON.parse(savedSimpleMode));
      }

      const savedDoubanDataSource = localStorage.getItem('doubanDataSource');
      const defaultDoubanProxyType =
        (window as any).RUNTIME_CONFIG?.DOUBAN_PROXY_TYPE || 'direct';
      if (savedDoubanDataSource !== null) {
        setDoubanDataSource(savedDoubanDataSource);
      } else if (defaultDoubanProxyType) {
        setDoubanDataSource(defaultDoubanProxyType);
      }

      const savedDoubanProxyUrl = localStorage.getItem('doubanProxyUrl');
      const defaultDoubanProxy =
        (window as any).RUNTIME_CONFIG?.DOUBAN_PROXY || '';
      if (savedDoubanProxyUrl !== null) {
        setDoubanProxyUrl(savedDoubanProxyUrl);
      } else if (defaultDoubanProxy) {
        setDoubanProxyUrl(defaultDoubanProxy);
      }

      const savedDoubanImageProxyType = localStorage.getItem(
        'doubanImageProxyType'
      );
      const defaultDoubanImageProxyType =
        (window as any).RUNTIME_CONFIG?.DOUBAN_IMAGE_PROXY_TYPE || 'server';
      if (savedDoubanImageProxyType !== null) {
        setDoubanImageProxyType(savedDoubanImageProxyType);
      } else if (defaultDoubanImageProxyType) {
        setDoubanImageProxyType(defaultDoubanImageProxyType);
      }

      const savedDoubanImageProxyUrl = localStorage.getItem(
        'doubanImageProxyUrl'
      );
      const defaultDoubanImageProxyUrl =
        (window as any).RUNTIME_CONFIG?.DOUBAN_IMAGE_PROXY || '';
      if (savedDoubanImageProxyUrl !== null) {
        setDoubanImageProxyUrl(savedDoubanImageProxyUrl);
      } else if (defaultDoubanImageProxyUrl) {
        setDoubanImageProxyUrl(defaultDoubanImageProxyUrl);
      }

      const savedAutoDanmakuEnabled =
        localStorage.getItem('autoDanmakuEnabled');
      if (savedAutoDanmakuEnabled !== null) {
        setAutoDanmakuEnabled(JSON.parse(savedAutoDanmakuEnabled));
      }

      const savedDanmakuRetryCount = localStorage.getItem('danmakuRetryCount');
      if (savedDanmakuRetryCount !== null) {
        const parsed = parseInt(savedDanmakuRetryCount, 10);
        if (!isNaN(parsed)) setDanmakuRetryCount(parsed);
      }

      const savedEnablePreferBestSource = localStorage.getItem(
        'enablePreferBestSource'
      );
      if (savedEnablePreferBestSource !== null) {
        setEnablePreferBestSource(JSON.parse(savedEnablePreferBestSource));
      }

      localStorage.removeItem('preferredDanmakuPlatform');
    }
  }, []);

  // 版本檢查
  useEffect(() => {
    const checkUpdate = async () => {
      try {
        const status = await checkForUpdates();
        setUpdateStatus(status);
      } catch (error) {
        console.warn('版本檢查失敗:', error);
      } finally {
        setIsChecking(false);
      }
    };

    checkUpdate();
  }, []);

  // 點擊外部區域關閉下拉框
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isDoubanDropdownOpen) {
        const target = event.target as Element;
        if (!target.closest('[data-dropdown="douban-datasource"]')) {
          setIsDoubanDropdownOpen(false);
        }
      }
    };

    if (isDoubanDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () =>
        document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isDoubanDropdownOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isDoubanImageProxyDropdownOpen) {
        const target = event.target as Element;
        if (!target.closest('[data-dropdown="douban-image-proxy"]')) {
          setIsDoubanImageProxyDropdownOpen(false);
        }
      }
    };

    if (isDoubanImageProxyDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () =>
        document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isDoubanImageProxyDropdownOpen]);

  const handleMenuClick = () => {
    setIsOpen(!isOpen);
  };

  const handleCloseMenu = () => {
    setIsOpen(false);
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('注銷請求失敗:', error);
    }
    clearAuthInfoCache();
    window.location.href = '/';
  };

  const handleAdminPanel = () => {
    // 如果已經在管理頁面，直接關閉菜單，不觸發加載動畫
    if (pathname === '/admin') {
      setIsOpen(false);
      return;
    }
    startLoading();
    router.push('/admin');
  };

  const handleChangePassword = () => {
    setIsOpen(false);
    setIsChangePasswordOpen(true);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setPasswordError('');
  };

  const handleCloseChangePassword = () => {
    setIsChangePasswordOpen(false);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setPasswordError('');
  };

  const handleAdultAuth = () => {
    setIsOpen(false);
    setIsAdultAuthOpen(true);
    setAdultCardCode('');
    setAdultAuthError('');
    setAdultAuthSuccess('');
  };

  const handleCloseAdultAuth = () => {
    setIsAdultAuthOpen(false);
    setAdultCardCode('');
    setAdultAuthError('');
    setAdultAuthSuccess('');
  };

  const handleSubmitAdultAuth = async () => {
    const normalizedCode = adultCardCode.trim();
    setAdultAuthError('');
    setAdultAuthSuccess('');

    if (!normalizedCode) {
      setAdultAuthError('請輸入授權卡號');
      return;
    }

    setAdultAuthLoading(true);
    try {
      const response = await fetch('/api/adult/authorization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: normalizedCode }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || '授權失敗');
      }

      setAdultCardCode('');
      setAdultAuthSuccess(
        `授權成功，到期時間：${formatAdultAuthExpiry(data.expiresAt ?? null)}`
      );
    } catch (error) {
      setAdultAuthError(error instanceof Error ? error.message : '授權失敗');
    } finally {
      setAdultAuthLoading(false);
    }
  };

  const handleSubmitChangePassword = async () => {
    setPasswordError('');

    // 驗證密碼
    if (!currentPassword) {
      setPasswordError('請輸入目前密碼');
      return;
    }

    if (!newPassword) {
      setPasswordError('新密碼不得為空');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('兩次輸入的密碼不一致');
      return;
    }

    setPasswordLoading(true);

    try {
      const response = await fetch('/api/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setPasswordError(data.error || '修改密碼失敗');
        return;
      }

      // 修改成功，關閉彈窗並登出
      setIsChangePasswordOpen(false);
      await handleLogout();
    } catch (error) {
      setPasswordError('網絡錯誤，請稍後重試');
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleSettings = () => {
    setIsOpen(false);
    setIsSettingsOpen(true);
  };

  const handleCloseSettings = () => {
    setIsSettingsOpen(false);
  };

  // 設置相關的處理函數

  const handleAutoDanmakuToggle = (value: boolean) => {
    setAutoDanmakuEnabled(value);
    localStorage.setItem('autoDanmakuEnabled', JSON.stringify(value));
  };

  const handleDanmakuRetryCountChange = (value: number) => {
    // 只允許-1或非負整數
    if (value < -1) return;
    setDanmakuRetryCount(value);
    localStorage.setItem('danmakuRetryCount', value.toString());
  };

  const handlePreferBestSourceToggle = (value: boolean) => {
    setEnablePreferBestSource(value);
    localStorage.setItem('enablePreferBestSource', JSON.stringify(value));
  };

  const handleAggregateToggle = (value: boolean) => {
    setDefaultAggregateSearch(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('defaultAggregateSearch', JSON.stringify(value));
    }
  };

  const handleDefaultStreamToggle = (value: boolean) => {
    setDefaultStreamSearch(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('defaultStreamSearch', JSON.stringify(value));
    }
  };

  const handleSimpleModeToggle = (value: boolean) => {
    setSimpleMode(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('simpleMode', JSON.stringify(value));
    }
    // 簡潔模式變化時關閉設置並刷新頁面
    setIsSettingsOpen(false);
    setTimeout(() => {
      window.location.reload();
    }, 100);
  };

  const handleDoubanProxyUrlChange = (value: string) => {
    setDoubanProxyUrl(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('doubanProxyUrl', value);
    }
  };

  const handleDoubanDataSourceChange = (value: string) => {
    setDoubanDataSource(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('doubanDataSource', value);
    }
  };

  const handleDoubanImageProxyTypeChange = (value: string) => {
    setDoubanImageProxyType(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('doubanImageProxyType', value);
    }
  };

  const handleDoubanImageProxyUrlChange = (value: string) => {
    setDoubanImageProxyUrl(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem('doubanImageProxyUrl', value);
    }
  };

  // 獲取感謝信息
  const getThanksInfo = (dataSource: string) => {
    switch (dataSource) {
      case 'cors-proxy-zwei':
        return {
          text: 'Thanks to @Zwei',
          url: 'https://github.com/bestzwei',
        };
      case 'cmliussss-cdn-tencent':
      case 'cmliussss-cdn-ali':
        return {
          text: 'Thanks to @CMLiussss',
          url: 'https://github.com/cmliu',
        };
      default:
        return null;
    }
  };

  const handleResetSettings = () => {
    const defaultDoubanProxyType =
      (window as any).RUNTIME_CONFIG?.DOUBAN_PROXY_TYPE || 'direct';
    const defaultDoubanProxy =
      (window as any).RUNTIME_CONFIG?.DOUBAN_PROXY || '';
    const defaultDoubanImageProxyType =
      (window as any).RUNTIME_CONFIG?.DOUBAN_IMAGE_PROXY_TYPE || 'server';
    const defaultDoubanImageProxyUrl =
      (window as any).RUNTIME_CONFIG?.DOUBAN_IMAGE_PROXY || '';

    setDefaultAggregateSearch(true);
    setDefaultStreamSearch(true);
    setSimpleMode(false);

    setDoubanProxyUrl(defaultDoubanProxy);
    setDoubanDataSource(defaultDoubanProxyType);
    setDoubanImageProxyType(defaultDoubanImageProxyType);
    setDoubanImageProxyUrl(defaultDoubanImageProxyUrl);

    setEnablePreferBestSource(false);
    setAutoDanmakuEnabled(false);
    setDanmakuRetryCount(3); // 新增：重置彈幕自動嘗試次數為3

    if (typeof window !== 'undefined') {
      localStorage.setItem('defaultAggregateSearch', JSON.stringify(true));
      localStorage.setItem('defaultStreamSearch', JSON.stringify(true));
      localStorage.setItem('simpleMode', JSON.stringify(false));

      localStorage.setItem('doubanProxyUrl', defaultDoubanProxy);
      localStorage.setItem('doubanDataSource', defaultDoubanProxyType);
      localStorage.setItem('doubanImageProxyType', defaultDoubanImageProxyType);
      localStorage.setItem('doubanImageProxyUrl', defaultDoubanImageProxyUrl);

      localStorage.setItem('enablePreferBestSource', JSON.stringify(false));
      localStorage.setItem('autoDanmakuEnabled', JSON.stringify(false));
      localStorage.removeItem('preferredDanmakuPlatform');
      localStorage.setItem('danmakuRetryCount', '3'); // 新增：重置本地彈幕自動嘗試次數為3
    }
  };

  // 檢查是否顯示管理面板按鈕
  const showAdminPanel =
    authInfo?.role === 'owner' || authInfo?.role === 'admin';

  // 檢查是否顯示修改密碼按鈕
  const showChangePassword =
    authInfo?.role !== 'owner' && storageType !== 'localstorage';

  const showAdultAuth =
    authInfo?.role === 'user' && storageType !== 'localstorage';

  // 角色中文映射
  const getRoleText = (role?: string) => {
    switch (role) {
      case 'owner':
        return '站長';
      case 'admin':
        return '管理員';
      case 'user':
        return '用戶';
      default:
        return '';
    }
  };

  // 菜單面板內容
  const menuPanel = (
    <>
      {/* 背景遮罩 - 普通菜單無需模糊 */}
      <div
        className='fixed inset-0 bg-transparent z-[1000]'
        onClick={handleCloseMenu}
      />

      {/* 菜單面板 */}
      <div className='fixed top-14 right-4 w-56 bg-white dark:bg-gray-900 rounded-lg shadow-xl z-[1001] border border-gray-200/50 dark:border-gray-700/50 overflow-hidden select-none'>
        {/* 用戶信息區域 */}
        <div className='px-3 py-2.5 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-gray-50 to-gray-100/50 dark:from-gray-800 dark:to-gray-800/50'>
          <div className='space-y-1'>
            <div className='flex items-center justify-between'>
              <span className='text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                當前用戶
              </span>
              <span
                className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium ${
                  (authInfo?.role || 'user') === 'owner'
                    ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300'
                    : (authInfo?.role || 'user') === 'admin'
                    ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
                    : 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                }`}
              >
                {getRoleText(authInfo?.role || 'user')}
              </span>
            </div>
            <div className='flex items-center justify-between'>
              <div className='font-semibold text-gray-900 dark:text-gray-100 text-sm truncate'>
                {authInfo?.username || 'default'}
              </div>
              <div className='text-[10px] text-gray-400 dark:text-gray-500'>
                數據存儲：
                {storageType === 'localstorage' ? '本地' : storageType}
              </div>
            </div>
          </div>
        </div>

        {/* 菜單項 */}
        <div className='py-1'>
          {/* 設置按鈕 */}
          <button
            onClick={handleSettings}
            className='w-full px-3 py-2 text-left flex items-center gap-2.5 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm'
          >
            <Settings className='w-4 h-4 text-gray-500 dark:text-gray-400' />
            <span className='font-medium'>設置</span>
          </button>

          {/* 管理面板按鈕 */}
          {showAdminPanel && (
            <button
              onClick={handleAdminPanel}
              className='w-full px-3 py-2 text-left flex items-center gap-2.5 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm'
            >
              <Shield className='w-4 h-4 text-gray-500 dark:text-gray-400' />
              <span className='font-medium'>管理面板</span>
            </button>
          )}

          {/* 修改密碼按鈕 */}
          {showChangePassword && (
            <button
              onClick={handleChangePassword}
              className='w-full px-3 py-2 text-left flex items-center gap-2.5 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm'
            >
              <KeyRound className='w-4 h-4 text-gray-500 dark:text-gray-400' />
              <span className='font-medium'>修改密碼</span>
            </button>
          )}

          {showAdultAuth && (
            <button
              onClick={handleAdultAuth}
              className='w-full px-3 py-2 text-left flex items-center gap-2.5 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm'
            >
              <KeyRound className='w-4 h-4 text-amber-500 dark:text-amber-300' />
              <span className='font-medium'>成人授權</span>
            </button>
          )}

          {/* 分割線 */}
          <div className='my-1 border-t border-gray-200 dark:border-gray-700'></div>

          {/* 登出按鈕 */}
          <button
            onClick={handleLogout}
            className='w-full px-3 py-2 text-left flex items-center gap-2.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-sm'
          >
            <LogOut className='w-4 h-4' />
            <span className='font-medium'>登出</span>
          </button>

          {/* 分割線 */}
          <div className='my-1 border-t border-gray-200 dark:border-gray-700'></div>

          {/* 版本信息 */}
          <button
            onClick={() => {
              setIsVersionPanelOpen(true);
              handleCloseMenu();
            }}
            className='w-full px-3 py-2 text-center flex items-center justify-center text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors text-xs'
          >
            <div className='flex items-center gap-1'>
              <span className='font-mono'>v{CURRENT_VERSION}</span>
              {!isChecking &&
                updateStatus &&
                updateStatus !== UpdateStatus.FETCH_FAILED && (
                  <div
                    className={`w-2 h-2 rounded-full -translate-y-2 ${
                      updateStatus === UpdateStatus.HAS_UPDATE
                        ? 'bg-yellow-500'
                        : updateStatus === UpdateStatus.NO_UPDATE
                        ? 'bg-green-400'
                        : ''
                    }`}
                  ></div>
                )}
            </div>
          </button>
        </div>
      </div>
    </>
  );

  // 設置面板內容
  const settingsPanel = (
    <>
      {/* 背景遮罩 */}
      <div
        className='fixed inset-0 bg-black/50 backdrop-blur-sm z-[1000]'
        onClick={handleCloseSettings}
      />

      {/* 設置面板 */}
      <div className='fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-xl max-h-[90vh] bg-white dark:bg-gray-900 rounded-xl shadow-xl z-[1001] p-6 overflow-y-auto'>
        {/* 標題欄 */}
        <div className='flex items-center justify-between mb-6'>
          <div className='flex items-center gap-3'>
            <h3 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
              本地設置
            </h3>
            <button
              onClick={handleResetSettings}
              className='px-2 py-1 text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 border border-red-200 hover:border-red-300 dark:border-red-800 dark:hover:border-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors'
              title='重置為默認設置'
            >
              重置
            </button>
          </div>
          <button
            onClick={handleCloseSettings}
            className='w-8 h-8 p-1 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors'
            aria-label='Close'
          >
            <X className='w-full h-full' />
          </button>
        </div>

        {/* 設置項 */}
        <div className='space-y-6'>
          {/* 簡潔模式下隱藏所有代理相關設置 */}
          {!simpleMode && (
            <>
              {/* 豆瓣數據源選擇 */}
              <div className='space-y-3'>
                <div>
                  <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                    豆瓣數據代理
                  </h4>
                  <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                    選擇獲取豆瓣數據的方式
                  </p>
                </div>
                <div className='relative' data-dropdown='douban-datasource'>
                  {/* 自定義下拉選擇框 */}
                  <button
                    type='button'
                    onClick={() =>
                      setIsDoubanDropdownOpen(!isDoubanDropdownOpen)
                    }
                    className='w-full px-3 py-2.5 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm hover:border-gray-400 dark:hover:border-gray-500 text-left'
                  >
                    {
                      doubanDataSourceOptions.find(
                        (option) => option.value === doubanDataSource
                      )?.label
                    }
                  </button>

                  {/* 下拉箭頭 */}
                  <div className='absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none'>
                    <ChevronDown
                      className={`w-4 h-4 text-gray-400 dark:text-gray-500 transition-transform duration-200 ${
                        isDoubanDropdownOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </div>

                  {/* 下拉選項列表 */}
                  {isDoubanDropdownOpen && (
                    <div className='absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg max-h-60 overflow-auto'>
                      {doubanDataSourceOptions.map((option) => (
                        <button
                          key={option.value}
                          type='button'
                          onClick={() => {
                            handleDoubanDataSourceChange(option.value);
                            setIsDoubanDropdownOpen(false);
                          }}
                          className={`w-full px-3 py-2.5 text-left text-sm transition-colors duration-150 flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-700 ${
                            doubanDataSource === option.value
                              ? 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400'
                              : 'text-gray-900 dark:text-gray-100'
                          }`}
                        >
                          <span className='truncate'>{option.label}</span>
                          {doubanDataSource === option.value && (
                            <Check className='w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0 ml-2' />
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* 感謝信息 */}
                {getThanksInfo(doubanDataSource) && (
                  <div className='mt-3'>
                    <button
                      type='button'
                      onClick={() =>
                        window.open(
                          getThanksInfo(doubanDataSource)!.url,
                          '_blank'
                        )
                      }
                      className='flex items-center justify-center gap-1.5 w-full px-3 text-xs text-gray-500 dark:text-gray-400 cursor-pointer'
                    >
                      <span className='font-medium'>
                        {getThanksInfo(doubanDataSource)!.text}
                      </span>
                      <ExternalLink className='w-3.5 opacity-70' />
                    </button>
                  </div>
                )}
              </div>

              {/* 豆瓣代理地址設置 - 僅在選擇自定義代理時顯示 */}
              {doubanDataSource === 'custom' && (
                <div className='space-y-3'>
                  <div>
                    <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                      豆瓣代理地址
                    </h4>
                    <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                      自定義代理服務器地址
                    </p>
                  </div>
                  <input
                    type='text'
                    className='w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 shadow-sm hover:border-gray-400 dark:hover:border-gray-500'
                    placeholder='例如: https://proxy.example.com/fetch?url='
                    value={doubanProxyUrl}
                    onChange={(e) => handleDoubanProxyUrlChange(e.target.value)}
                  />
                </div>
              )}

              {/* 分割線 */}
              <div className='border-t border-gray-200 dark:border-gray-700'></div>

              {/* 豆瓣圖片代理設置 */}
              <div className='space-y-3'>
                <div>
                  <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                    豆瓣圖片代理
                  </h4>
                  <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                    選擇獲取豆瓣圖片的方式
                  </p>
                </div>
                <div className='relative' data-dropdown='douban-image-proxy'>
                  {/* 自定義下拉選擇框 */}
                  <button
                    type='button'
                    onClick={() =>
                      setIsDoubanImageProxyDropdownOpen(
                        !isDoubanImageProxyDropdownOpen
                      )
                    }
                    className='w-full px-3 py-2.5 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm hover:border-gray-400 dark:hover:border-gray-500 text-left'
                  >
                    {
                      doubanImageProxyTypeOptions.find(
                        (option) => option.value === doubanImageProxyType
                      )?.label
                    }
                  </button>

                  {/* 下拉箭頭 */}
                  <div className='absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none'>
                    <ChevronDown
                      className={`w-4 h-4 text-gray-400 dark:text-gray-500 transition-transform duration-200 ${
                        isDoubanDropdownOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </div>

                  {/* 下拉選項列表 */}
                  {isDoubanImageProxyDropdownOpen && (
                    <div className='absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg max-h-60 overflow-auto'>
                      {doubanImageProxyTypeOptions.map((option) => (
                        <button
                          key={option.value}
                          type='button'
                          onClick={() => {
                            handleDoubanImageProxyTypeChange(option.value);
                            setIsDoubanImageProxyDropdownOpen(false);
                          }}
                          className={`w-full px-3 py-2.5 text-left text-sm transition-colors duration-150 flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-700 ${
                            doubanImageProxyType === option.value
                              ? 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400'
                              : 'text-gray-900 dark:text-gray-100'
                          }`}
                        >
                          <span className='truncate'>{option.label}</span>
                          {doubanImageProxyType === option.value && (
                            <Check className='w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0 ml-2' />
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* 感謝信息 */}
                {getThanksInfo(doubanImageProxyType) && (
                  <div className='mt-3'>
                    <button
                      type='button'
                      onClick={() =>
                        window.open(
                          getThanksInfo(doubanImageProxyType)!.url,
                          '_blank'
                        )
                      }
                      className='flex items-center justify-center gap-1.5 w-full px-3 text-xs text-gray-500 dark:text-gray-400 cursor-pointer'
                    >
                      <span className='font-medium'>
                        {getThanksInfo(doubanImageProxyType)!.text}
                      </span>
                      <ExternalLink className='w-3.5 opacity-70' />
                    </button>
                  </div>
                )}
              </div>

              {/* 豆瓣圖片代理地址設置 - 僅在選擇自定義代理時顯示 */}
              {doubanImageProxyType === 'custom' && (
                <div className='space-y-3'>
                  <div>
                    <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                      豆瓣圖片代理地址
                    </h4>
                    <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                      自定義圖片代理服務器地址
                    </p>
                  </div>
                  <input
                    type='text'
                    className='w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 shadow-sm hover:border-gray-400 dark:hover:border-gray-500'
                    placeholder='例如: https://proxy.example.com/fetch?url='
                    value={doubanImageProxyUrl}
                    onChange={(e) =>
                      handleDoubanImageProxyUrlChange(e.target.value)
                    }
                  />
                </div>
              )}

              {/* 分割線 */}
              <div className='border-t border-gray-200 dark:border-gray-700'></div>
            </>
          )}

          {/* 默認聚合搜索結果 */}
          <div className='flex items-center justify-between'>
            <div>
              <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                默認聚合搜索結果
              </h4>
              <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                搜索時默認按標題和年份聚合顯示結果
              </p>
            </div>
            <label className='flex items-center cursor-pointer'>
              <div className='relative'>
                <input
                  type='checkbox'
                  className='sr-only peer'
                  checked={defaultAggregateSearch}
                  onChange={(e) => handleAggregateToggle(e.target.checked)}
                />
                <div className='w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors dark:bg-gray-600'></div>
                <div className='absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5'></div>
              </div>
            </label>
          </div>

          {/* 默認流式搜索模式 */}
          <div className='flex items-center justify-between'>
            <div>
              <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                默認流式搜索模式
              </h4>
              <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                關閉後默認使用一次性返回，空結果將不緩存
              </p>
            </div>
            <label className='flex items-center cursor-pointer'>
              <div className='relative'>
                <input
                  type='checkbox'
                  className='sr-only peer'
                  checked={defaultStreamSearch}
                  onChange={(e) => handleDefaultStreamToggle(e.target.checked)}
                />
                <div className='w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors dark:bg-gray-600'></div>
                <div className='absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5'></div>
              </div>
            </label>
          </div>

          {/* 優選播放源 */}
          <div className='flex items-center justify-between'>
            <div>
              <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                優選播放源
              </h4>
              <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                開啟後，加載視頻時執行優選，關閉則跳過
              </p>
            </div>
            <label className='flex items-center cursor-pointer'>
              <div className='relative'>
                <input
                  type='checkbox'
                  className='sr-only peer'
                  checked={enablePreferBestSource}
                  onChange={(e) =>
                    handlePreferBestSourceToggle(e.target.checked)
                  }
                />
                <div className='w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors dark:bg-gray-600'></div>
                <div className='absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5'></div>
              </div>
            </label>
          </div>

          {/* 自動匹配彈幕 */}
          <div className='flex items-center justify-between'>
            <div>
              <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                自動匹配彈幕
              </h4>
              <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                在進入播放頁面時自動匹配並加載彈幕（推薦）
              </p>
            </div>
            <label className='flex items-center cursor-pointer'>
              <div className='relative'>
                <input
                  type='checkbox'
                  className='sr-only peer'
                  checked={autoDanmakuEnabled}
                  onChange={(e) => handleAutoDanmakuToggle(e.target.checked)}
                />
                <div className='w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors dark:bg-gray-600'></div>
                <div className='absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5'></div>
              </div>
            </label>
          </div>
          {/* 彈幕自動嘗試次數設置 */}
          <div className='flex items-center justify-between mt-2'>
            <div>
              <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                彈幕自動嘗試次數
              </h4>
              <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                自動彈幕獲取的嘗試次數，-1為一直獲取直到成功
              </p>
            </div>
            <input
              type='number'
              min='-1'
              className='w-11 px-2 py-1 rounded text-sm bg-[#f5f5f5] dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none border-none focus:outline-none focus:border-none focus:ring-0'
              value={danmakuRetryCount}
              onChange={(e) =>
                handleDanmakuRetryCountChange(Number(e.target.value))
              }
            />
          </div>

          {/* 分割線 */}
          <div className='border-t border-gray-200 dark:border-gray-700'></div>

          {/* TVBox 接口狀態 */}
          <div className='space-y-3'>
            <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
              TVBox 接口
            </h4>

            {/* 狀態和接口地址同行 */}
            <div className='flex items-center gap-3'>
              {/* 狀態徽章 */}
              <div
                className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-medium shrink-0 ${
                  tvboxEnabled
                    ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                }`}
              >
                <div
                  className={`w-2 h-2 rounded-full ${
                    tvboxEnabled ? 'bg-green-500 animate-pulse' : 'bg-gray-400'
                  }`}
                />
                <span>{tvboxEnabled ? '已開啟' : '未開啟'}</span>
              </div>

              {/* 接口地址 */}
              {tvboxEnabled && tvboxUrl ? (
                <>
                  <input
                    value={tvboxUrl}
                    type='text'
                    className='flex-1 min-w-0 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
                    readOnly
                  />
                  <button
                    type='button'
                    className='shrink-0 px-3 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors'
                    onClick={() => {
                      navigator.clipboard.writeText(tvboxUrl);
                    }}
                  >
                    復制
                  </button>
                </>
              ) : (
                !tvboxEnabled && (
                  <span className='text-xs text-gray-500 dark:text-gray-400'>
                    {storageType === 'localstorage'
                      ? '請修改環境變量 TVBOX_ENABLED 以開啟'
                      : isPrivileged
                      ? '請前往管理面板的站點配置中開啟'
                      : '請聯系管理員開啟'}
                  </span>
                )
              )}
            </div>

            {/* 說明文字和提示 */}
            {tvboxEnabled && tvboxUrl && (
              <div className='space-y-2'>
                <p className='text-xs text-gray-500 dark:text-gray-400'>
                  將該地址填入 TVBox 的訂閱/配置接口，並在請求頭設置
                  <code className='ml-1'>x-tvbox-password</code>。
                </p>
                {tvboxPassword && (
                  <div className='flex items-center gap-2'>
                    <input
                      value={tvboxPassword}
                      type='text'
                      readOnly
                      className='flex-1 min-w-0 px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-xs bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
                    />
                    <button
                      type='button'
                      className='shrink-0 px-2 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors'
                      onClick={() => {
                        navigator.clipboard.writeText(tvboxPassword);
                      }}
                    >
                      復制口令
                    </button>
                  </div>
                )}

                {storageType === 'localstorage' && (
                  <p className='text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-3 py-2 rounded-lg'>
                    💡 本地模式，開關由環境變量 TVBOX_ENABLED 控制，口令為
                    PASSWORD
                  </p>
                )}

                {isPrivileged && storageType !== 'localstorage' && (
                  <p className='text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-3 py-2 rounded-lg'>
                    💡 如需修改 TVBox
                    配置（開關/密碼），請前往管理面板的站點配置
                  </p>
                )}
              </div>
            )}
          </div>

          {/* 分割線 */}
          <div className='border-t border-gray-200 dark:border-gray-700'></div>

          {/* 簡潔模式設置 */}
          <div className='flex items-center justify-between'>
            <div>
              <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                簡潔模式
              </h4>
              <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                開啟後導航欄只保留首頁和搜索，首頁只保留繼續觀看和收藏夾
              </p>
            </div>
            <label className='flex items-center cursor-pointer'>
              <div className='relative'>
                <input
                  type='checkbox'
                  className='sr-only peer'
                  checked={simpleMode}
                  onChange={(e) => handleSimpleModeToggle(e.target.checked)}
                />
                <div className='w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors dark:bg-gray-600'></div>
                <div className='absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5'></div>
              </div>
            </label>
          </div>
        </div>

        {/* 底部說明 */}
        <div className='mt-6 pt-4 border-t border-gray-200 dark:border-gray-700'>
          <p className='text-xs text-gray-500 dark:text-gray-400 text-center'>
            這些設置保存在本地瀏覽器中
          </p>
        </div>
      </div>
    </>
  );

  // 修改密碼面板內容
  const changePasswordPanel = (
    <>
      {/* 背景遮罩 */}
      <div
        className='fixed inset-0 bg-black/50 backdrop-blur-sm z-[1000]'
        onClick={handleCloseChangePassword}
      />

      {/* 修改密碼面板 */}
      <div className='fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-white dark:bg-gray-900 rounded-xl shadow-xl z-[1001] p-6'>
        {/* 標題欄 */}
        <div className='flex items-center justify-between mb-6'>
          <h3 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
            修改密碼
          </h3>
          <button
            onClick={handleCloseChangePassword}
            className='w-8 h-8 p-1 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors'
            aria-label='Close'
          >
            <X className='w-full h-full' />
          </button>
        </div>

        {/* 表單 */}
        <div className='space-y-4'>
          {/* 目前密碼輸入 */}
          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
              目前密碼
            </label>
            <input
              type='password'
              className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-colors bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400'
              placeholder='請輸入目前密碼'
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              disabled={passwordLoading}
            />
          </div>

          {/* 新密碼輸入 */}
          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
              新密碼
            </label>
            <input
              type='password'
              className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-colors bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400'
              placeholder='請輸入新密碼'
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              disabled={passwordLoading}
            />
          </div>

          {/* 確認密碼輸入 */}
          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
              確認密碼
            </label>
            <input
              type='password'
              className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-colors bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400'
              placeholder='請再次輸入新密碼'
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={passwordLoading}
            />
          </div>

          {/* 錯誤信息 */}
          {passwordError && (
            <div className='text-red-500 text-sm bg-red-50 dark:bg-red-900/20 p-3 rounded-md border border-red-200 dark:border-red-800'>
              {passwordError}
            </div>
          )}
        </div>

        {/* 操作按鈕 */}
        <div className='flex gap-3 mt-6 pt-4 border-t border-gray-200 dark:border-gray-700'>
          <button
            onClick={handleCloseChangePassword}
            className='flex-1 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md transition-colors'
            disabled={passwordLoading}
          >
            取消
          </button>
          <button
            onClick={handleSubmitChangePassword}
            className='flex-1 px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
            disabled={
              passwordLoading ||
              !currentPassword ||
              !newPassword ||
              !confirmPassword
            }
          >
            {passwordLoading ? '修改中...' : '確認修改'}
          </button>
        </div>

        {/* 底部說明 */}
        <div className='mt-4 pt-4 border-t border-gray-200 dark:border-gray-700'>
          <p className='text-xs text-gray-500 dark:text-gray-400 text-center'>
            修改密碼後需要重新登錄
          </p>
        </div>
      </div>
    </>
  );

  const adultAuthPanel = (
    <>
      <div
        className='fixed inset-0 bg-black/50 backdrop-blur-sm z-[1000]'
        onClick={handleCloseAdultAuth}
      />

      <div className='fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-white dark:bg-gray-900 rounded-xl shadow-xl z-[1001] p-6'>
        <div className='flex items-center justify-between mb-6'>
          <div>
            <h3 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
              成人內容授權
            </h3>
            <p className='mt-1 text-sm text-gray-500 dark:text-gray-400'>
              輸入管理員提供的授權卡號後即可解鎖成人內容。
            </p>
          </div>
          <button
            onClick={handleCloseAdultAuth}
            className='w-8 h-8 p-1 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors'
            aria-label='Close'
          >
            <X className='w-full h-full' />
          </button>
        </div>

        <div className='space-y-4'>
          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
              授權卡號
            </label>
            <input
              type='text'
              className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-colors bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 font-mono'
              placeholder='ADULT-XXXX-XXXX-XXXX-XXXXXX'
              value={adultCardCode}
              onChange={(e) => {
                setAdultCardCode(e.target.value);
                setAdultAuthError('');
                setAdultAuthSuccess('');
              }}
              disabled={adultAuthLoading}
            />
          </div>

          {adultAuthError && (
            <div className='text-red-500 text-sm bg-red-50 dark:bg-red-900/20 p-3 rounded-md border border-red-200 dark:border-red-800'>
              {adultAuthError}
            </div>
          )}

          {adultAuthSuccess && (
            <div className='text-green-700 text-sm bg-green-50 dark:bg-green-900/20 p-3 rounded-md border border-green-200 dark:border-green-800 dark:text-green-300'>
              {adultAuthSuccess}
            </div>
          )}
        </div>

        <div className='flex gap-3 mt-6 pt-4 border-t border-gray-200 dark:border-gray-700'>
          <button
            onClick={handleCloseAdultAuth}
            className='flex-1 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md transition-colors'
            disabled={adultAuthLoading}
          >
            取消
          </button>
          <button
            onClick={handleSubmitAdultAuth}
            className='flex-1 px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
            disabled={adultAuthLoading || !adultCardCode.trim()}
          >
            {adultAuthLoading ? '授權中...' : '啟用授權'}
          </button>
        </div>
      </div>
    </>
  );

  return (
    <>
      <div className='relative'>
        <button
          onClick={handleMenuClick}
          className='w-10 h-10 p-2 rounded-full flex items-center justify-center text-gray-600 hover:bg-gray-200/50 dark:text-gray-300 dark:hover:bg-gray-700/50 transition-colors'
          aria-label='User Menu'
        >
          <User className='w-full h-full' />
        </button>
        {updateStatus === UpdateStatus.HAS_UPDATE && (
          <div className='absolute top-[2px] right-[2px] w-2 h-2 bg-yellow-500 rounded-full'></div>
        )}
      </div>

      {/* 使用 Portal 將菜單面板渲染到 document.body */}
      {isOpen && mounted && createPortal(menuPanel, document.body)}

      {/* 使用 Portal 將設置面板渲染到 document.body */}
      {isSettingsOpen && mounted && createPortal(settingsPanel, document.body)}

      {/* 使用 Portal 將修改密碼面板渲染到 document.body */}
      {isChangePasswordOpen &&
        mounted &&
        createPortal(changePasswordPanel, document.body)}

      {isAdultAuthOpen &&
        mounted &&
        createPortal(adultAuthPanel, document.body)}

      {/* 版本面板 */}
      <VersionPanel
        isOpen={isVersionPanelOpen}
        onClose={() => setIsVersionPanelOpen(false)}
      />
    </>
  );
};
