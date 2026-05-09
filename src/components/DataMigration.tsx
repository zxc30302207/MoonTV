/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  Download,
  FileCheck,
  Lock,
  Upload,
} from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface DataMigrationProps {
  onRefreshConfig?: () => Promise<void>;
}

interface AlertModalProps {
  isOpen: boolean;
  onClose: () => void;
  type: 'success' | 'error' | 'warning';
  title: string;
  message?: string;
  content?: ReactNode;
  confirmText?: string;
  onConfirm?: () => void;
  showConfirm?: boolean;
  timer?: number;
}

const AlertModal = ({
  isOpen,
  onClose,
  type,
  title,
  message,
  content,
  confirmText = '確定',
  onConfirm,
  showConfirm = false,
  timer,
}: AlertModalProps) => {
  const [isVisible, setIsVisible] = useState(false);

  // 控制動畫狀態
  useEffect(() => {
    if (isOpen) {
      setIsVisible(true);
      if (timer) {
        setTimeout(() => {
          onClose();
        }, timer);
      }
    } else {
      setIsVisible(false);
    }
  }, [isOpen, timer, onClose]);

  if (!isOpen) return null;

  const getIcon = () => {
    switch (type) {
      case 'success':
        return <CheckCircle className='w-12 h-12 text-green-500' />;
      case 'error':
        return <AlertCircle className='w-12 h-12 text-red-500' />;
      case 'warning':
        return <AlertTriangle className='w-12 h-12 text-yellow-500' />;
      default:
        return null;
    }
  };

  const getBgColor = () => {
    switch (type) {
      case 'success':
        return 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800';
      case 'error':
        return 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800';
      case 'warning':
        return 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800';
      default:
        return 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800';
    }
  };

  return createPortal(
    <div
      className={`fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 transition-opacity duration-200 ${
        isVisible ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={onClose}
    >
      <div
        className={`bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full border ${getBgColor()} transition-all duration-200 ${
          isVisible ? 'scale-100' : 'scale-95'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className='p-6 text-center'>
          <div className='flex justify-center mb-4'>{getIcon()}</div>

          <h3 className='text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2'>
            {title}
          </h3>

          {message && (
            <p className='text-gray-600 dark:text-gray-400 mb-4'>{message}</p>
          )}

          {content && (
            <div className='text-left text-gray-600 dark:text-gray-400 mb-4'>
              {content}
            </div>
          )}

          <div className='flex justify-center space-x-3'>
            {showConfirm && onConfirm ? (
              <>
                <button
                  onClick={onClose}
                  className='px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors'
                >
                  取消
                </button>
                <button
                  onClick={() => {
                    onConfirm();
                    onClose();
                  }}
                  className='px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors'
                >
                  {confirmText}
                </button>
              </>
            ) : (
              <button
                onClick={onClose}
                className='px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors'
              >
                確定
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

const DataMigration = ({ onRefreshConfig }: DataMigrationProps) => {
  const [exportPassword, setExportPassword] = useState('');
  const [importPassword, setImportPassword] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [alertModal, setAlertModal] = useState<{
    isOpen: boolean;
    type: 'success' | 'error' | 'warning';
    title: string;
    message?: string;
    content?: ReactNode;
    confirmText?: string;
    onConfirm?: () => void;
    showConfirm?: boolean;
    timer?: number;
  }>({
    isOpen: false,
    type: 'success',
    title: '',
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showAlert = (config: Omit<typeof alertModal, 'isOpen'>) => {
    setAlertModal({ ...config, isOpen: true });
  };

  const hideAlert = () => {
    setAlertModal((prev) => ({ ...prev, isOpen: false }));
  };

  // 導出數據
  const handleExport = async () => {
    if (!exportPassword.trim()) {
      showAlert({
        type: 'error',
        title: '錯誤',
        message: '請輸入加密密碼',
      });
      return;
    }

    try {
      setIsExporting(true);

      const response = await fetch('/api/admin/data_migration/export', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          password: exportPassword,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `導出失敗: ${response.status}`);
      }

      // 獲取文件名
      const contentDisposition = response.headers.get('content-disposition');
      const filenameMatch = contentDisposition?.match(/filename="(.+)"/);
      const filename = filenameMatch?.[1] || 'moontv-backup.dat';

      // 下載文件
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      a.style.position = 'fixed';
      a.style.top = '0';
      a.style.left = '0';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      showAlert({
        type: 'success',
        title: '導出成功',
        message: '數據已成功導出，請妥善保管備份文件和密碼',
        timer: 3000,
      });

      setExportPassword('');
    } catch (error) {
      showAlert({
        type: 'error',
        title: '導出失敗',
        message: error instanceof Error ? error.message : '導出過程中發生錯誤',
      });
    } finally {
      setIsExporting(false);
    }
  };

  // 文件選擇處理
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  // 導入數據
  const handleImport = async () => {
    if (!selectedFile) {
      showAlert({
        type: 'error',
        title: '錯誤',
        message: '請選擇備份文件',
      });
      return;
    }

    if (!importPassword.trim()) {
      showAlert({
        type: 'error',
        title: '錯誤',
        message: '請輸入解密密碼',
      });
      return;
    }

    try {
      setIsImporting(true);

      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('password', importPassword);

      const response = await fetch('/api/admin/data_migration/import', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || `導入失敗: ${response.status}`);
      }

      showAlert({
        type: 'success',
        title: '導入成功',
        content: (
          <div className='text-left'>
            <p>
              <strong>導入完成！</strong>
            </p>
            <p className='mt-2'>導入的用戶數量: {result.importedUsers}</p>
            <p>
              備份時間:{' '}
              {new Date(result.timestamp).toLocaleString('zh-TW')}
            </p>
            <p>服務器版本: {result.serverVersion || '未知版本'}</p>
            <p className='mt-3 text-orange-600'>
              請刷新頁面以查看最新數據。
            </p>
          </div>
        ),
        confirmText: '刷新頁面',
        showConfirm: true,
        onConfirm: async () => {
          // 清理狀態
          setSelectedFile(null);
          setImportPassword('');
          if (fileInputRef.current) {
            fileInputRef.current.value = '';
          }

          // 刷新配置
          if (onRefreshConfig) {
            await onRefreshConfig();
          }

          // 刷新頁面
          window.location.reload();
        },
      });
    } catch (error) {
      showAlert({
        type: 'error',
        title: '導入失敗',
        message: error instanceof Error ? error.message : '導入過程中發生錯誤',
      });
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <>
      <div className='max-w-6xl mx-auto space-y-6'>
        {/* 簡潔警告提示 */}
        <div className='flex items-center gap-3 p-4 border border-amber-200 dark:border-amber-700 rounded-lg bg-amber-50/30 dark:bg-amber-900/5'>
          <AlertTriangle className='w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0' />
          <p className='text-sm text-amber-800 dark:text-amber-200'>
            數據遷移操作請謹慎，確保已備份重要數據
          </p>
        </div>

        {/* 主要操作區域 - 響應式佈局 */}
        <div className='grid grid-cols-1 lg:grid-cols-2 gap-6'>
          {/* 數據導出 */}
          <div className='border border-gray-200 dark:border-gray-700 rounded-lg p-6 bg-white dark:bg-gray-800 hover:shadow-sm transition-shadow flex flex-col'>
            <div className='flex items-center gap-3 mb-6'>
              <div className='w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center'>
                <Download className='w-4 h-4 text-blue-600 dark:text-blue-400' />
              </div>
              <div>
                <h3 className='font-semibold text-gray-900 dark:text-gray-100'>
                  數據導出
                </h3>
                <p className='text-sm text-gray-600 dark:text-gray-400'>
                  創建加密備份文件
                </p>
              </div>
            </div>

            <div className='flex-1 flex flex-col'>
              <div className='space-y-4'>
                {/* 密碼輸入 */}
                <div>
                  <label className='flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                    <Lock className='w-4 h-4' />
                    加密密碼
                  </label>
                  <input
                    type='password'
                    value={exportPassword}
                    onChange={(e) => setExportPassword(e.target.value)}
                    placeholder='設置強密碼保護備份文件'
                    className='w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors'
                    disabled={isExporting}
                  />
                  <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                    導入時需要使用相同密碼
                  </p>
                </div>

                {/* 備份內容列表 */}
                <div className='text-xs text-gray-600 dark:text-gray-400 space-y-1'>
                  <p className='font-medium text-gray-700 dark:text-gray-300 mb-2'>
                    備份內容：
                  </p>
                  <div className='grid grid-cols-2 gap-1'>
                    <div>• 管理配置</div>
                    <div>• 用戶數據</div>
                    <div>• 播放記錄</div>
                    <div>• 收藏夾</div>
                  </div>
                </div>
              </div>

              {/* 導出按鈕 */}
              <button
                onClick={handleExport}
                disabled={isExporting || !exportPassword.trim()}
                className={`w-full px-4 py-2.5 rounded-lg font-medium transition-colors mt-10 ${
                  isExporting || !exportPassword.trim()
                    ? 'bg-gray-100 dark:bg-gray-700 cursor-not-allowed text-gray-500 dark:text-gray-400'
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`}
              >
                {isExporting ? (
                  <div className='flex items-center justify-center gap-2'>
                    <div className='w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin'></div>
                    導出中...
                  </div>
                ) : (
                  <div className='flex items-center justify-center gap-2'>
                    <Download className='w-4 h-4' />
                    導出數據
                  </div>
                )}
              </button>
            </div>
          </div>

          {/* 數據導入 */}
          <div className='border border-gray-200 dark:border-gray-700 rounded-lg p-6 bg-white dark:bg-gray-800 hover:shadow-sm transition-shadow flex flex-col'>
            <div className='flex items-center gap-3 mb-6'>
              <div className='w-8 h-8 rounded-lg bg-red-50 dark:bg-red-900/20 flex items-center justify-center'>
                <Upload className='w-4 h-4 text-red-600 dark:text-red-400' />
              </div>
              <div>
                <h3 className='font-semibold text-gray-900 dark:text-gray-100'>
                  數據導入
                </h3>
                <p className='text-sm text-red-600 dark:text-red-400'>
                  ⚠️ 將清空現有數據
                </p>
              </div>
            </div>

            <div className='flex-1 flex flex-col'>
              <div className='space-y-4'>
                {/* 文件選擇 */}
                <div>
                  <label className='flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                    <FileCheck className='w-4 h-4' />
                    備份文件
                    {selectedFile && (
                      <span className='ml-auto text-xs text-green-600 dark:text-green-400 font-normal'>
                        {selectedFile.name} (
                        {(selectedFile.size / 1024).toFixed(1)} KB)
                      </span>
                    )}
                  </label>
                  <input
                    ref={fileInputRef}
                    type='file'
                    accept='.dat'
                    onChange={handleFileSelect}
                    className='w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-red-500 focus:border-red-500 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:font-medium file:bg-gray-50 dark:file:bg-gray-600 file:text-gray-700 dark:file:text-gray-300 hover:file:bg-gray-100 dark:hover:file:bg-gray-500 transition-colors'
                    disabled={isImporting}
                  />
                </div>

                {/* 密碼輸入 */}
                <div>
                  <label className='flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                    <Lock className='w-4 h-4' />
                    解密密碼
                  </label>
                  <input
                    type='password'
                    value={importPassword}
                    onChange={(e) => setImportPassword(e.target.value)}
                    placeholder='輸入導出時的加密密碼'
                    className='w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-red-500 focus:border-red-500 transition-colors'
                    disabled={isImporting}
                  />
                </div>
              </div>

              {/* 導入按鈕 */}
              <button
                onClick={handleImport}
                disabled={
                  isImporting || !selectedFile || !importPassword.trim()
                }
                className={`w-full px-4 py-2.5 rounded-lg font-medium transition-colors mt-10 ${
                  isImporting || !selectedFile || !importPassword.trim()
                    ? 'bg-gray-100 dark:bg-gray-700 cursor-not-allowed text-gray-500 dark:text-gray-400'
                    : 'bg-red-600 hover:bg-red-700 text-white'
                }`}
              >
                {isImporting ? (
                  <div className='flex items-center justify-center gap-2'>
                    <div className='w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin'></div>
                    導入中...
                  </div>
                ) : (
                  <div className='flex items-center justify-center gap-2'>
                    <Upload className='w-4 h-4' />
                    導入數據
                  </div>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 彈窗組件 */}
      <AlertModal
        isOpen={alertModal.isOpen}
        onClose={hideAlert}
        type={alertModal.type}
        title={alertModal.title}
        message={alertModal.message}
        content={alertModal.content}
        confirmText={alertModal.confirmText}
        onConfirm={alertModal.onConfirm}
        showConfirm={alertModal.showConfirm}
        timer={alertModal.timer}
      />
    </>
  );
};

export default DataMigration;
