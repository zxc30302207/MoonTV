/* eslint-disable @typescript-eslint/no-explicit-any, no-console, @typescript-eslint/no-non-null-assertion */

'use client';

import {
  closestCenter,
  DndContext,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  restrictToParentElement,
  restrictToVerticalAxis,
} from '@dnd-kit/modifiers';
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Bell,
  Check,
  ChevronDown,
  ChevronUp,
  Database,
  ExternalLink,
  FileText,
  FolderOpen,
  KeyRound,
  Settings,
  Users,
  Video,
} from 'lucide-react';
import { GripVertical } from 'lucide-react';
import { Suspense, useCallback, useEffect, useState } from 'react';
import Swal from 'sweetalert2';

import {
  type AdminConfig,
  type AdminConfigResult,
  type AdultAuthDuration,
} from '@/lib/admin.types';
import {
  type AuthInfo,
  getCachedAuthInfo,
  refreshAuthInfo,
} from '@/lib/auth-client';

import DataMigration from '@/components/DataMigration';
import PageLayout from '@/components/PageLayout';

// 統一彈窗方法（必須在首次使用前定義）
const showError = (message: string) =>
  Swal.fire({ icon: 'error', title: '錯誤', text: message });

const showSuccess = (message: string) =>
  Swal.fire({
    icon: 'success',
    title: '成功',
    text: message,
    timer: 2000,
    showConfirmButton: false,
  });

// 新增站點配置類型
interface SiteConfig {
  SiteName: string;
  Announcement: string;
  SearchDownstreamMaxPage: number;
  SiteInterfaceCacheTime: number;
  DoubanProxyType: string;
  DoubanProxy: string;
  DoubanImageProxyType: string;
  DoubanImageProxy: string;
  DisableYellowFilter: boolean;
  TVBoxEnabled?: boolean;
  TVBoxPassword?: string;
  DanmakuApiBaseUrl?: string;
}

// 視頻源數據類型
interface DataSource {
  name: string;
  key: string;
  api: string;
  detail?: string;
  disabled?: boolean;
  from: 'config' | 'custom';
}

// 自定義分類數據類型
interface CustomCategory {
  name?: string;
  type: 'movie' | 'tv';
  query: string;
  disabled?: boolean;
  from: 'config' | 'custom';
}

const ADULT_AUTH_DURATION_OPTIONS: {
  value: AdultAuthDuration;
  label: string;
}[] = [
  { value: 'day', label: '1 日' },
  { value: 'week', label: '1 周' },
  { value: 'month', label: '1 個月' },
  { value: 'year', label: '1 年' },
  { value: 'forever', label: '永久' },
];

const ADULT_AUTH_DURATION_LABELS: Record<AdultAuthDuration, string> =
  ADULT_AUTH_DURATION_OPTIONS.reduce(
    (labels, option) => ({ ...labels, [option.value]: option.label }),
    {} as Record<AdultAuthDuration, string>
  );

function formatAdultAuthDate(timestamp?: number | null) {
  if (timestamp === null) return '永久';
  if (!timestamp) return '-';
  return new Date(timestamp).toLocaleString('zh-TW', { hour12: false });
}

// 可折疊標簽組件
interface CollapsibleTabProps {
  title: string;
  icon?: React.ReactNode;
  isExpanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

const CollapsibleTab = ({
  title,
  icon,
  isExpanded,
  onToggle,
  children,
}: CollapsibleTabProps) => {
  return (
    <div className='rounded-xl shadow-sm mb-4 overflow-hidden bg-white/80 backdrop-blur-md dark:bg-gray-800/50 dark:ring-1 dark:ring-gray-700'>
      <button
        onClick={onToggle}
        className='w-full px-6 py-4 flex items-center justify-between bg-gray-50/70 dark:bg-gray-800/60 hover:bg-gray-100/80 dark:hover:bg-gray-700/60 transition-colors'
      >
        <div className='flex items-center gap-3'>
          {icon}
          <h3 className='text-lg font-medium text-gray-900 dark:text-gray-100'>
            {title}
          </h3>
        </div>
        <div className='text-gray-500 dark:text-gray-400'>
          {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
        </div>
      </button>

      {isExpanded && <div className='px-6 py-4'>{children}</div>}
    </div>
  );
};

// 用戶配置組件
interface UserConfigProps {
  config: AdminConfig | null;
  role: 'owner' | 'admin' | null;
  refreshConfig: () => Promise<void>;
  currentUsername: string | null;
}

const UserConfig = ({
  config,
  role,
  refreshConfig,
  currentUsername,
}: UserConfigProps) => {
  const [userSettings, setUserSettings] = useState({
    enableRegistration: false,
  });
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [batchGroupName, setBatchGroupName] = useState<string>('');
  const [_selectedGroupInDialog, setSelectedGroupInDialog] =
    useState<string>('');
  // 彈窗編輯，刪除內聯編輯狀態
  const [showAddUserForm, setShowAddUserForm] = useState(false);
  const [showChangePasswordForm, setShowChangePasswordForm] = useState(false);
  const [newUser, setNewUser] = useState({
    username: '',
    password: '',
  });
  const [changePasswordUser, setChangePasswordUser] = useState({
    username: '',
    password: '',
  });
  const [adultCardDuration, setAdultCardDuration] =
    useState<AdultAuthDuration>('month');
  const [adultCardBusy, setAdultCardBusy] = useState(false);
  const adultCards = config?.AdultAuthConfig?.cards ?? [];
  const adultGrants = config?.AdultAuthConfig?.grants ?? [];

  // 注：分類配置不依賴存儲類型禁用邏輯

  // 注：分類配置不依賴存儲類型禁用邏輯

  useEffect(() => {
    if (config?.UserConfig) {
      setUserSettings({
        enableRegistration: config.UserConfig.AllowRegister,
      });
    }
  }, [config]);

  // 切換允許註冊設置
  const toggleAllowRegister = async (value: boolean) => {
    try {
      // 先更新本地 UI
      setUserSettings((prev) => ({ ...prev, enableRegistration: value }));

      const res = await fetch('/api/admin/user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'setAllowRegister',
          allowRegister: value,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `操作失敗: ${res.status}`);
      }

      await refreshConfig();
    } catch (err) {
      showError(err instanceof Error ? err.message : '操作失敗');
      // revert toggle UI
      setUserSettings((prev) => ({ ...prev, enableRegistration: !value }));
    }
  };

  const handleBanUser = async (uname: string) => {
    await handleUserAction('ban', uname);
  };

  const handleUnbanUser = async (uname: string) => {
    await handleUserAction('unban', uname);
  };

  const handleSetAdmin = async (uname: string) => {
    await handleUserAction('setAdmin', uname);
  };

  const handleRemoveAdmin = async (uname: string) => {
    await handleUserAction('cancelAdmin', uname);
  };

  const handleAddUser = async () => {
    if (!newUser.username || !newUser.password) return;
    await handleUserAction('add', newUser.username, newUser.password);
    setNewUser({ username: '', password: '' });
    setShowAddUserForm(false);
  };

  const handleChangePassword = async () => {
    if (!changePasswordUser.username || !changePasswordUser.password) return;
    await handleUserAction(
      'changePassword',
      changePasswordUser.username,
      changePasswordUser.password
    );
    setChangePasswordUser({ username: '', password: '' });
    setShowChangePasswordForm(false);
  };

  const handleShowChangePasswordForm = (username: string) => {
    setChangePasswordUser({ username, password: '' });
    setShowChangePasswordForm(true);
    setShowAddUserForm(false); // 關閉添加用戶表單
  };

  const handleDeleteUser = async (username: string) => {
    const { isConfirmed } = await Swal.fire({
      title: '確認刪除用戶',
      text: `刪除用戶 ${username} 將同時刪除其搜索歷史、播放記錄和收藏夾，此操作不可恢復！`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: '確認刪除',
      cancelButtonText: '取消',
      confirmButtonColor: '#dc2626',
    });

    if (!isConfirmed) return;

    await handleUserAction('deleteUser', username);
  };

  // 選中/全選
  const toggleSelectUser = (username: string) => {
    const next = new Set(selectedUsers);
    if (next.has(username)) next.delete(username);
    else next.add(username);
    setSelectedUsers(next);
  };
  const toggleSelectAllUsers = () => {
    const all = config?.UserConfig.Users ?? [];
    if (selectedUsers.size === all.length) setSelectedUsers(new Set());
    else setSelectedUsers(new Set(all.map((u) => u.username)));
  };

  // 批量分組與移出組
  const _openGroupPicker = async () => {
    /* replaced by inline chips */
  };

  const createGroupPrompt = async () => {
    const allSources = config?.SourceConfig || [];
    const sourceListHtml = `
      <div style="text-align:left;max-height:260px;overflow:auto;border:1px solid var(--swal2-border,#e5e7eb);border-radius:8px;padding:8px;margin-top:8px;display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px">
        ${allSources
          .map(
            (s) => `
            <label style="display:flex;align-items:center;gap:8px;padding:8px;border:1px solid #e5e7eb;border-radius:8px;background:#fafafa;cursor:pointer">
              <input type="checkbox" name="groupSources" value="${s.key}" />
              <span style="font-size:13px"><strong>${
                s.name || s.key
              }</strong> <span style="opacity:.7">(${s.key})</span></span>
            </label>`
          )
          .join('')}
      </div>`;

    const { value, isConfirmed } = await Swal.fire({
      title: '新建分組',
      width: '800px',
      html:
        '<input id="swal-input-group-name" class="swal2-input" placeholder="分組名稱" style="width: 100%; max-width: 400px; margin: 0 auto;" />' +
        '<div style="text-align:left;margin-top:6px;font-size:12px;opacity:.8;display:flex;align-items:center;gap:10px">' +
        '<span>選擇該分組可使用的視頻源</span>' +
        '<label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-size:12px">' +
        '<input id="swal-group-select-all" type="checkbox" /> 全選' +
        '</label>' +
        '</div>' +
        sourceListHtml,
      didOpen: (el) => {
        const toggleAll = el.querySelector(
          '#swal-group-select-all'
        ) as HTMLInputElement | null;
        const itemNodes = Array.from(
          el.querySelectorAll('input[name="groupSources"]')
        ) as HTMLInputElement[];
        if (toggleAll) {
          toggleAll.addEventListener('change', () => {
            itemNodes.forEach((n) => {
              n.checked = toggleAll.checked;
            });
          });
        }
      },
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonText: '創建',
      cancelButtonText: '取消',
      preConfirm: () => {
        const nameEl = document.getElementById(
          'swal-input-group-name'
        ) as HTMLInputElement | null;
        const name = nameEl?.value?.trim();
        if (!name) {
          Swal.showValidationMessage('分組名稱不能為空');
          return null as unknown as { name: string; sourceKeys: string[] };
        }
        const checked = Array.from(
          document.querySelectorAll('input[name="groupSources"]:checked')
        ) as HTMLInputElement[];
        const sourceKeys = checked.map((c) => c.value);
        return { name, sourceKeys };
      },
    });
    if (!isConfirmed || !value) return;
    const { name, sourceKeys } = value as {
      name: string;
      sourceKeys: string[];
    };
    try {
      const resp = await fetch('/api/admin/group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', name, sourceKeys }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || '創建分組失敗');
      }
      await refreshConfig();
      setBatchGroupName(name);
      showSuccess('分組已創建');
    } catch (err) {
      showError(err instanceof Error ? err.message : '創建分組失敗');
    }
  };

  const performBatchAssignGroup = async (groupName: string) => {
    if (selectedUsers.size === 0) {
      showError('請先選擇要分配的用戶');
      return;
    }

    try {
      const resp = await fetch('/api/admin/group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'assignUsers',
          name: groupName,
          users: Array.from(selectedUsers),
        }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || '批量分組失敗');
      }
      setSelectedUsers(new Set());
      setBatchGroupName('');
      await refreshConfig();
      showSuccess('批量分組成功');
    } catch (err) {
      showError(err instanceof Error ? err.message : '批量分組失敗');
    }
  };
  const handleBatchRemoveGroup = async () => {
    if (selectedUsers.size === 0) return;
    try {
      const resp = await fetch('/api/admin/group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'removeUsers',
          users: Array.from(selectedUsers),
        }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || '批量移出失敗');
      }
      setSelectedUsers(new Set());
      await refreshConfig();
      showSuccess('已將所選用戶移出分組');
    } catch (err) {
      showError(err instanceof Error ? err.message : '批量移出失敗');
    }
  };

  // 組管理：刪除/進入編輯/保存編輯
  const callGroupApi = async (body: Record<string, any>) => {
    try {
      const resp = await fetch('/api/admin/group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || `操作失敗: ${resp.status}`);
      }
      await refreshConfig();
      showSuccess('已保存');
    } catch (err) {
      showError(err instanceof Error ? err.message : '操作失敗');
      throw err;
    }
  };

  const handleDeleteGroup = async (name: string) => {
    const { isConfirmed } = await Swal.fire({
      title: '確認刪除分組',
      text: `刪除分組 ${name} 後，該分組下的用戶不會再受限於此分組的視頻源。`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: '確認刪除',
      cancelButtonText: '取消',
      confirmButtonColor: '#dc2626',
    });
    if (!isConfirmed) return;
    await callGroupApi({ action: 'delete', name });
    if (batchGroupName === name) setBatchGroupName('');
  };

  const openGroupManagementDialog = async () => {
    const groups = config?.UserConfig?.Groups || [];
    setSelectedGroupInDialog(''); // 重置選中狀態

    await Swal.fire({
      title: '分組管理',
      html: `
        <div class="text-left">
          <div class="mb-4">
            <h4 class="text-sm font-medium text-gray-700 mb-2">已創建的分組</h4>
            <div class="grid gap-3" style="grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));">
              ${groups
                .map(
                  (g) => `
                <div
                  onclick="window.selectGroupInDialog('${g.name}')"
                  class="p-3 rounded-lg border cursor-pointer transition-colors hover:shadow-sm"
                  style="background-color: var(--selected-group-bg, #f9fafb); border-color: var(--selected-group-border, #e5e7eb);"
                  id="group-card-${g.name}"
                >
                  <div class="flex items-center justify-between gap-2 mb-2">
                    <span class="text-sm font-medium text-gray-800">${
                      g.name
                    }</span>
                    <div class="flex items-center gap-2">
                      <span class="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                        ${g.sourceKeys?.length || 0} 源
                      </span>
                    </div>
                  </div>
                  <div class="flex flex-wrap gap-2">
                    ${(g.sourceKeys || [])
                      .map(
                        (k) => `
                      <span class="px-2 py-1 text-xs rounded border bg-gray-50 border-gray-300 text-gray-700">
                        ${k}
                      </span>
                    `
                      )
                      .join('')}
                    ${
                      !g.sourceKeys || g.sourceKeys.length === 0
                        ? '<span class="text-xs text-gray-500">未配置源</span>'
                        : ''
                    }
                  </div>
                </div>
              `
                )
                .join('')}
              ${
                groups.length === 0
                  ? '<div class="col-span-full text-center text-gray-500 py-4">暫無分組</div>'
                  : ''
              }
            </div>
          </div>
          <div class="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <div class="text-sm text-blue-800">
              已選中 ${
                selectedUsers.size
              } 個用戶，選擇分組和用戶後可進行分配操作
            </div>
          </div>
        </div>
      `,
      width: '800px',
      showConfirmButton: false,
      showCancelButton: false,
      showCloseButton: true,
      footer: `
        <div class="flex items-center justify-between w-full">
          <div class="text-sm text-gray-600">
            <span id="selected-group-text">請選擇分組</span>
          </div>
          <div class="flex gap-2">
            <button
              id="edit-group-btn"
              class="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
              disabled
            >
              編輯
            </button>
            <button
              id="assign-group-btn"
              class="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
              disabled
            >
              分配
            </button>
            <button
              id="delete-group-btn"
              class="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
              disabled
            >
              刪除
            </button>
          </div>
        </div>
      `,
      didOpen: () => {
        // 添加全局函數供按鈕調用
        (window as any).selectGroupInDialog = (groupName: string) => {
          setSelectedGroupInDialog(groupName);
          (window as any).currentSelectedGroup = groupName; // 設置全局變量

          // 更新UI
          groups.forEach((g) => {
            const card = document.getElementById(`group-card-${g.name}`);
            if (card) {
              if (g.name === groupName) {
                card.style.setProperty('--selected-group-bg', '#dcfce7');
                card.style.setProperty('--selected-group-border', '#16a34a');
              } else {
                card.style.setProperty('--selected-group-bg', '#f9fafb');
                card.style.setProperty('--selected-group-border', '#e5e7eb');
              }
            }
          });

          // 更新文本和按鈕狀態
          const selectedText = document.getElementById('selected-group-text');
          const editBtn = document.getElementById(
            'edit-group-btn'
          ) as HTMLButtonElement;
          const assignBtn = document.getElementById(
            'assign-group-btn'
          ) as HTMLButtonElement;
          const deleteBtn = document.getElementById(
            'delete-group-btn'
          ) as HTMLButtonElement;

          if (selectedText) selectedText.textContent = `已選擇: ${groupName}`;
          if (editBtn) editBtn.disabled = false;
          if (assignBtn) assignBtn.disabled = selectedUsers.size === 0;
          if (deleteBtn) deleteBtn.disabled = false;
        };

        (window as any).editSelectedGroup = async () => {
          const groupName = (window as any).currentSelectedGroup;
          if (!groupName) return;
          const group = groups.find((g) => g.name === groupName);
          if (group) {
            await openEditGroupDialog(groupName, group.sourceKeys || []);
            // 編輯完成後重新打開分組管理彈窗
            openGroupManagementDialog();
          }
        };

        (window as any).assignToSelectedGroup = async () => {
          const groupName = (window as any).currentSelectedGroup;
          if (!groupName) return;
          await performBatchAssignGroup(groupName);
        };

        (window as any).deleteSelectedGroup = async () => {
          const groupName = (window as any).currentSelectedGroup;
          if (!groupName) return;
          await handleDeleteGroup(groupName);
        };

        // 綁定按鈕事件
        setTimeout(() => {
          const editBtn = document.getElementById('edit-group-btn');
          const assignBtn = document.getElementById('assign-group-btn');
          const deleteBtn = document.getElementById('delete-group-btn');

          if (editBtn)
            editBtn.onclick = () => (window as any).editSelectedGroup();
          if (assignBtn)
            assignBtn.onclick = () => (window as any).assignToSelectedGroup();
          if (deleteBtn)
            deleteBtn.onclick = () => (window as any).deleteSelectedGroup();
        }, 100);
      },
    });
  };

  const openEditGroupDialog = async (
    groupName: string,
    currentKeys: string[]
  ) => {
    const allSources = config?.SourceConfig || [];
    const sourceListHtml = `
      <div style="text-align:left;max-height:260px;overflow:auto;border:1px solid var(--swal2-border,#e5e7eb);border-radius:8px;padding:8px;margin-top:8px;display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px">
        ${allSources
          .map(
            (s) => `
            <label style="display:flex;align-items:center;gap:8px;padding:8px;border:1px solid #e5e7eb;border-radius:8px;background:#fafafa;cursor:pointer">\n              <input type="checkbox" name="editGroupSources" value="${
              s.key
            }" ${
              currentKeys?.includes(s.key) ? 'checked' : ''
            }/>\n              <span style="font-size:13px"><strong>${
              s.name || s.key
            }</strong> <span style="opacity:.7">(${
              s.key
            })</span></span>\n            </label>`
          )
          .join('')}
      </div>`;

    const { value, isConfirmed } = await Swal.fire({
      title: '編輯分組',
      width: '800px',
      html:
        `<input id="swal-edit-group-name" class="swal2-input" placeholder="分組名稱" value="${groupName}" style="width: 100%; max-width: 400px; margin: 0 auto;" />` +
        '<div style="text-align:left;margin-top:6px;font-size:12px;opacity:.8;display:flex;align-items:center;gap:10px">' +
        '<span>設置該分組可使用的視頻源</span>' +
        '<label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-size:12px">' +
        '<input id="swal-edit-group-select-all" type="checkbox" /> 全選' +
        '</label>' +
        '</div>' +
        sourceListHtml,
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonText: '保存',
      cancelButtonText: '取消',
      didOpen: (el) => {
        const toggleAll = el.querySelector(
          '#swal-edit-group-select-all'
        ) as HTMLInputElement | null;
        const itemNodes = Array.from(
          el.querySelectorAll('input[name="editGroupSources"]')
        ) as HTMLInputElement[];
        if (toggleAll) {
          toggleAll.addEventListener('change', () => {
            itemNodes.forEach((n) => {
              n.checked = toggleAll.checked;
            });
          });
        }
      },
      preConfirm: () => {
        const nameEl = document.getElementById(
          'swal-edit-group-name'
        ) as HTMLInputElement | null;
        const name = nameEl?.value?.trim();
        if (!name) {
          Swal.showValidationMessage('分組名稱不能為空');
          return null as unknown as { name: string; sourceKeys: string[] };
        }
        const checked = Array.from(
          document.querySelectorAll('input[name="editGroupSources"]:checked')
        ) as HTMLInputElement[];
        const sourceKeys = checked.map((c) => c.value);
        return { name, sourceKeys };
      },
    });
    if (!isConfirmed || !value) return;
    const { name, sourceKeys } = value as {
      name: string;
      sourceKeys: string[];
    };
    if (name !== groupName) {
      await callGroupApi({ action: 'rename', name: groupName, newName: name });
    }
    await callGroupApi({ action: 'setSources', name, sourceKeys });
    if (batchGroupName === groupName) setBatchGroupName(name);
  };

  // 通用請求函數
  const handleUserAction = async (
    action:
      | 'add'
      | 'ban'
      | 'unban'
      | 'setAdmin'
      | 'cancelAdmin'
      | 'changePassword'
      | 'deleteUser',
    targetUsername: string,
    targetPassword?: string
  ) => {
    try {
      const res = await fetch('/api/admin/user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUsername,
          ...(targetPassword ? { targetPassword } : {}),
          action,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `操作失敗: ${res.status}`);
      }

      // 成功後刷新配置（無需整頁刷新）
      await refreshConfig();
    } catch (err) {
      showError(err instanceof Error ? err.message : '操作失敗');
    }
  };

  const callAdultCardApi = async (body: Record<string, unknown>) => {
    setAdultCardBusy(true);
    try {
      const res = await fetch('/api/admin/adult-card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `操作失敗: ${res.status}`);
      }

      const data = await res.json();
      await refreshConfig();
      return data;
    } catch (err) {
      showError(err instanceof Error ? err.message : '操作失敗');
      return null;
    } finally {
      setAdultCardBusy(false);
    }
  };

  const handleCreateAdultCard = async () => {
    const data = await callAdultCardApi({
      action: 'create',
      duration: adultCardDuration,
    });
    if (data?.card?.code) {
      showSuccess(`授權卡已生成：${data.card.code}`);
    }
  };

  const handleToggleAdultCard = async (code: string, disabled?: boolean) => {
    await callAdultCardApi({
      action: disabled ? 'enable' : 'disable',
      code,
    });
  };

  const handleDeleteAdultCard = async (code: string) => {
    const { isConfirmed } = await Swal.fire({
      title: '確認刪除授權卡',
      text: `刪除授權卡 ${code} 後，透過此卡取得的成人內容授權也會一併移除。`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: '確認刪除',
      cancelButtonText: '取消',
      confirmButtonColor: '#dc2626',
    });
    if (!isConfirmed) return;

    await callAdultCardApi({ action: 'delete', code });
  };

  const handleCopyAdultCard = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      showSuccess('授權卡號已複製');
    } catch {
      showError('無法複製，請手動選取卡號');
    }
  };

  if (!config) {
    return (
      <div className='text-center text-gray-500 dark:text-gray-400'>
        加載中...
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      {/* 用戶統計 */}
      <div>
        <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300 mb-3'>
          用戶統計
        </h4>
        <div className='p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800'>
          <div className='text-2xl font-bold text-green-800 dark:text-green-300'>
            {config.UserConfig.Users.length}
          </div>
          <div className='text-sm text-green-600 dark:text-green-400'>
            總用戶數
          </div>
        </div>
      </div>

      {/* 註冊設置 */}
      <div>
        <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300 mb-3'>
          註冊設置
        </h4>
        <div className='flex items-center justify-between'>
          <label className='text-gray-700 dark:text-gray-300'>
            允許新用戶註冊
          </label>
          <button
            onClick={() =>
              toggleAllowRegister(!userSettings.enableRegistration)
            }
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ${
              userSettings.enableRegistration
                ? 'bg-green-600'
                : 'bg-gray-200 dark:bg-gray-700'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                userSettings.enableRegistration
                  ? 'translate-x-6'
                  : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </div>

      {/* 成人授權卡 */}
      {(role === 'owner' || role === 'admin') && (
        <div>
          <div className='mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
            <div>
              <h4 className='flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300'>
                <KeyRound size={16} />
                成人授權卡
              </h4>
              <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                未持有效授權卡的普通用戶無法載入成人推薦或成人列表。
              </p>
            </div>
            <div className='flex flex-col gap-2 sm:flex-row sm:items-center'>
              <select
                value={adultCardDuration}
                onChange={(e) =>
                  setAdultCardDuration(e.target.value as AdultAuthDuration)
                }
                className='px-3 py-2 rounded-lg border border-gray-300 bg-white text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
              >
                {ADULT_AUTH_DURATION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button
                type='button'
                onClick={handleCreateAdultCard}
                disabled={adultCardBusy}
                className='px-3 py-2 rounded-lg bg-green-600 text-sm text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-400'
              >
                生成授權卡
              </button>
            </div>
          </div>

          <div className='grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(20rem,1fr)]'>
            <div className='rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden'>
              <div className='max-h-80 overflow-auto'>
                <table className='min-w-full divide-y divide-gray-200 dark:divide-gray-700'>
                  <thead className='bg-gray-50 dark:bg-gray-900'>
                    <tr>
                      <th className='px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400'>
                        卡號
                      </th>
                      <th className='px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400'>
                        期限
                      </th>
                      <th className='px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400'>
                        狀態
                      </th>
                      <th className='px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400'>
                        使用者
                      </th>
                      <th className='px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400'>
                        操作
                      </th>
                    </tr>
                  </thead>
                  <tbody className='divide-y divide-gray-200 dark:divide-gray-700'>
                    {adultCards.length === 0 ? (
                      <tr>
                        <td
                          colSpan={5}
                          className='px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400'
                        >
                          尚未生成授權卡
                        </td>
                      </tr>
                    ) : (
                      adultCards.map((card) => {
                        const statusText = card.disabled
                          ? '已停用'
                          : card.usedBy
                          ? '已使用'
                          : '未使用';
                        return (
                          <tr
                            key={card.code}
                            className='hover:bg-gray-50 dark:hover:bg-gray-800'
                          >
                            <td className='px-4 py-3 text-sm font-mono text-gray-900 dark:text-gray-100'>
                              {card.code}
                            </td>
                            <td className='px-4 py-3 text-sm text-gray-700 dark:text-gray-300'>
                              {ADULT_AUTH_DURATION_LABELS[card.duration]}
                            </td>
                            <td className='px-4 py-3'>
                              <span
                                className={`rounded-full px-2 py-1 text-xs ${
                                  card.disabled
                                    ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
                                    : card.usedBy
                                    ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
                                    : 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                                }`}
                              >
                                {statusText}
                              </span>
                            </td>
                            <td className='px-4 py-3 text-sm text-gray-700 dark:text-gray-300'>
                              {card.usedBy || '-'}
                            </td>
                            <td className='px-4 py-3 text-right text-sm'>
                              <div className='flex flex-wrap justify-end gap-2'>
                                <button
                                  type='button'
                                  onClick={() => handleCopyAdultCard(card.code)}
                                  className='rounded-full bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-800 transition-colors hover:bg-gray-200 dark:bg-gray-700/60 dark:text-gray-200 dark:hover:bg-gray-700'
                                >
                                  複製
                                </button>
                                {!card.usedBy && (
                                  <button
                                    type='button'
                                    onClick={() =>
                                      handleToggleAdultCard(
                                        card.code,
                                        card.disabled
                                      )
                                    }
                                    disabled={adultCardBusy}
                                    className='rounded-full bg-yellow-100 px-3 py-1.5 text-xs font-medium text-yellow-800 transition-colors hover:bg-yellow-200 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-yellow-900/40 dark:text-yellow-200 dark:hover:bg-yellow-900/60'
                                  >
                                    {card.disabled ? '啟用' : '停用'}
                                  </button>
                                )}
                                <button
                                  type='button'
                                  onClick={() =>
                                    handleDeleteAdultCard(card.code)
                                  }
                                  disabled={adultCardBusy}
                                  className='rounded-full bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60'
                                >
                                  刪除
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className='rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden'>
              <div className='border-b border-gray-200 bg-gray-50 px-4 py-3 text-sm font-medium text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'>
                已授權用戶
              </div>
              <div className='max-h-80 overflow-auto'>
                <table className='min-w-full divide-y divide-gray-200 dark:divide-gray-700'>
                  <thead className='bg-gray-50 dark:bg-gray-900'>
                    <tr>
                      <th className='px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400'>
                        用戶
                      </th>
                      <th className='px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400'>
                        到期
                      </th>
                      <th className='px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400'>
                        狀態
                      </th>
                    </tr>
                  </thead>
                  <tbody className='divide-y divide-gray-200 dark:divide-gray-700'>
                    {adultGrants.length === 0 ? (
                      <tr>
                        <td
                          colSpan={3}
                          className='px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400'
                        >
                          尚無普通用戶授權
                        </td>
                      </tr>
                    ) : (
                      adultGrants.map((grant) => {
                        const expired =
                          grant.expiresAt !== null &&
                          grant.expiresAt <= Date.now();
                        return (
                          <tr
                            key={grant.username}
                            className='hover:bg-gray-50 dark:hover:bg-gray-800'
                          >
                            <td className='px-4 py-3 text-sm text-gray-900 dark:text-gray-100'>
                              {grant.username}
                            </td>
                            <td className='px-4 py-3 text-sm text-gray-700 dark:text-gray-300'>
                              {formatAdultAuthDate(grant.expiresAt)}
                            </td>
                            <td className='px-4 py-3'>
                              <span
                                className={`rounded-full px-2 py-1 text-xs ${
                                  expired
                                    ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
                                    : 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                                }`}
                              >
                                {expired ? '已過期' : '有效'}
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 用戶列表 */}
      <div>
        <div className='flex items-center justify-between mb-3'>
          <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
            用戶列表
          </h4>
          <button
            onClick={() => {
              setShowAddUserForm(!showAddUserForm);
              if (showChangePasswordForm) {
                setShowChangePasswordForm(false);
                setChangePasswordUser({ username: '', password: '' });
              }
            }}
            className='px-3 py-1 bg-green-600 hover:bg-green-700 text-white text-sm rounded-lg transition-colors'
          >
            {showAddUserForm ? '取消' : '添加用戶'}
          </button>
        </div>

        {/* 批量分組工具欄（移動到用戶列表標題下方） */}
        <div className='p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-700 mb-4'>
          <div className='flex flex-col sm:flex-row items-start sm:items-center gap-3 justify-between'>
            <label className='flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300'>
              <input
                type='checkbox'
                checked={
                  selectedUsers.size ===
                    (config?.UserConfig.Users.length || 0) &&
                  (config?.UserConfig.Users.length || 0) > 0
                }
                onChange={toggleSelectAllUsers}
                className='w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600'
              />
              全選 ({selectedUsers.size}/{config?.UserConfig.Users.length || 0})
            </label>
            <div className='flex items-center gap-2'>
              <button
                onClick={createGroupPrompt}
                className='px-3 py-1 bg-purple-600 hover:bg-purple-700 text-white text-sm rounded-lg transition-colors'
              >
                新建分組
              </button>
              <button
                onClick={openGroupManagementDialog}
                className='px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors'
              >
                編輯分組
              </button>
              <button
                onClick={handleBatchRemoveGroup}
                disabled={selectedUsers.size === 0}
                className='px-3 py-1 bg-gray-600 hover:bg-gray-700 disabled:bg-gray-400 text-white text-sm rounded-lg transition-colors'
              >
                移出分組
              </button>
            </div>
          </div>
        </div>

        {/* 添加用戶表單 */}
        {showAddUserForm && (
          <div className='mb-4 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700'>
            <div className='flex flex-col sm:flex-row gap-4 sm:gap-3'>
              <input
                type='text'
                placeholder='用戶名'
                value={newUser.username}
                onChange={(e) =>
                  setNewUser((prev) => ({ ...prev, username: e.target.value }))
                }
                className='flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
              />
              <input
                type='password'
                placeholder='密碼'
                value={newUser.password}
                onChange={(e) =>
                  setNewUser((prev) => ({ ...prev, password: e.target.value }))
                }
                className='flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
              />
              <button
                onClick={handleAddUser}
                disabled={!newUser.username || !newUser.password}
                className='w-full sm:w-auto px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-lg transition-colors'
              >
                添加
              </button>
            </div>
          </div>
        )}

        {/* 修改密碼表單 */}
        {showChangePasswordForm && (
          <div className='mb-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-700'>
            <h5 className='text-sm font-medium text-blue-800 dark:text-blue-300 mb-3'>
              修改用戶密碼
            </h5>
            <div className='flex flex-col sm:flex-row gap-4 sm:gap-3'>
              <input
                type='text'
                placeholder='用戶名'
                value={changePasswordUser.username}
                disabled
                className='flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100 cursor-not-allowed'
              />
              <input
                type='password'
                placeholder='新密碼'
                value={changePasswordUser.password}
                onChange={(e) =>
                  setChangePasswordUser((prev) => ({
                    ...prev,
                    password: e.target.value,
                  }))
                }
                className='flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent'
              />
              <button
                onClick={handleChangePassword}
                disabled={!changePasswordUser.password}
                className='w-full sm:w-auto px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg transition-colors'
              >
                修改密碼
              </button>
              <button
                onClick={() => {
                  setShowChangePasswordForm(false);
                  setChangePasswordUser({ username: '', password: '' });
                }}
                className='w-full sm:w-auto px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition-colors'
              >
                取消
              </button>
            </div>
          </div>
        )}

        {/* 用戶列表 */}
        <div className='border border-gray-200 dark:border-gray-700 rounded-lg max-h-[28rem] overflow-y-auto overflow-x-auto'>
          <table className='min-w-full divide-y divide-gray-200 dark:divide-gray-700'>
            <thead className='bg-gray-50 dark:bg-gray-900'>
              <tr>
                <th className='w-8' />
                <th
                  scope='col'
                  className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'
                >
                  用戶名
                </th>
                <th
                  scope='col'
                  className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'
                >
                  角色
                </th>
                <th
                  scope='col'
                  className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'
                >
                  分組
                </th>
                <th
                  scope='col'
                  className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'
                >
                  最後在線
                </th>
                <th
                  scope='col'
                  className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'
                >
                  狀態
                </th>
                <th
                  scope='col'
                  className='px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'
                >
                  操作
                </th>
              </tr>
            </thead>
            {/* 按規則排序用戶：自己 -> 站長(若非自己) -> 管理員 -> 其他 */}
            {(() => {
              const sortedUsers = [...config.UserConfig.Users].sort((a, b) => {
                type UserInfo = (typeof config.UserConfig.Users)[number];
                const priority = (u: UserInfo) => {
                  if (u.username === currentUsername) return 0;
                  if (u.role === 'owner') return 1;
                  if (u.role === 'admin') return 2;
                  return 3;
                };
                return priority(a) - priority(b);
              });
              return (
                <tbody className='divide-y divide-gray-200 dark:divide-gray-700'>
                  {sortedUsers.map((user) => {
                    // 修改密碼權限：站長可修改管理員和普通用戶密碼，管理員可修改普通用戶和自己的密碼，但任何人都不能修改站長密碼
                    const canChangePassword =
                      user.role !== 'owner' && // 不能修改站長密碼
                      (role === 'owner' || // 站長可以修改管理員和普通用戶密碼
                        (role === 'admin' &&
                          (user.role === 'user' ||
                            user.username === currentUsername))); // 管理員可以修改普通用戶和自己的密碼

                    // 刪除用戶權限：站長可刪除除自己外的所有用戶，管理員僅可刪除普通用戶
                    const canDeleteUser =
                      user.username !== currentUsername &&
                      (role === 'owner' || // 站長可以刪除除自己外的所有用戶
                        (role === 'admin' && user.role === 'user')); // 管理員僅可刪除普通用戶

                    // 其他操作權限：不能操作自己，站長可操作所有用戶，管理員可操作普通用戶
                    const canOperate =
                      user.username !== currentUsername &&
                      (role === 'owner' ||
                        (role === 'admin' && user.role === 'user'));
                    return (
                      <tr
                        key={user.username}
                        className='hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors'
                      >
                        <td className='px-2 py-4'>
                          <input
                            type='checkbox'
                            checked={selectedUsers.has(user.username)}
                            onChange={() => toggleSelectUser(user.username)}
                            className='w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600'
                          />
                        </td>
                        <td className='px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100'>
                          {user.username}
                        </td>
                        <td className='px-6 py-4 whitespace-nowrap'>
                          <span
                            className={`px-2 py-1 text-xs rounded-full ${
                              user.role === 'owner'
                                ? 'bg-yellow-100 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-300'
                                : user.role === 'admin'
                                ? 'bg-purple-100 dark:bg-purple-900/20 text-purple-800 dark:text-purple-300'
                                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                            }`}
                          >
                            {user.role === 'owner'
                              ? '站長'
                              : user.role === 'admin'
                              ? '管理員'
                              : '普通用戶'}
                          </span>
                        </td>
                        <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100'>
                          {user.group || '-'}
                        </td>
                        <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100'>
                          {user.lastOnline
                            ? new Date(user.lastOnline).toLocaleString(
                                'zh-TW',
                                { hour12: false }
                              )
                            : '-'}
                        </td>
                        <td className='px-6 py-4 whitespace-nowrap'>
                          <span
                            className={`px-2 py-1 text-xs rounded-full ${
                              !user.banned
                                ? 'bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300'
                                : 'bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-300'
                            }`}
                          >
                            {!user.banned ? '正常' : '已封禁'}
                          </span>
                        </td>
                        <td className='px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2'>
                          {/* 修改密碼按鈕 */}
                          {canChangePassword && (
                            <button
                              onClick={() =>
                                handleShowChangePasswordForm(user.username)
                              }
                              className='inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 hover:bg-blue-200 dark:bg-blue-900/40 dark:hover:bg-blue-900/60 dark:text-blue-200 transition-colors'
                            >
                              修改密碼
                            </button>
                          )}
                          {canOperate && (
                            <>
                              {/* 其他操作按鈕 */}
                              {user.role === 'user' && (
                                <button
                                  onClick={() => handleSetAdmin(user.username)}
                                  className='inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800 hover:bg-purple-200 dark:bg-purple-900/40 dark:hover:bg-purple-900/60 dark:text-purple-200 transition-colors'
                                >
                                  設為管理
                                </button>
                              )}
                              {user.role === 'admin' && (
                                <button
                                  onClick={() =>
                                    handleRemoveAdmin(user.username)
                                  }
                                  className='inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-gray-700/40 dark:hover:bg-gray-700/60 dark:text-gray-200 transition-colors'
                                >
                                  取消管理
                                </button>
                              )}
                              {user.role !== 'owner' &&
                                (!user.banned ? (
                                  <button
                                    onClick={() => handleBanUser(user.username)}
                                    className='inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-red-100 text-red-800 hover:bg-red-200 dark:bg-red-900/40 dark:hover:bg-red-900/60 dark:text-red-300 transition-colors'
                                  >
                                    封禁
                                  </button>
                                ) : (
                                  <button
                                    onClick={() =>
                                      handleUnbanUser(user.username)
                                    }
                                    className='inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-green-100 text-green-800 hover:bg-green-200 dark:bg-green-900/40 dark:hover:bg-green-900/60 dark:text-green-300 transition-colors'
                                  >
                                    解封
                                  </button>
                                ))}
                            </>
                          )}
                          {/* 刪除用戶按鈕 - 放在最後，使用更明顯的紅色樣式 */}
                          {canDeleteUser && (
                            <button
                              onClick={() => handleDeleteUser(user.username)}
                              className='inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-red-600 text-white hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-700 transition-colors'
                            >
                              刪除用戶
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              );
            })()}
          </table>
        </div>
      </div>
    </div>
  );
};

// 視頻源配置組件
const VideoSourceConfig = ({
  config,
  refreshConfig,
}: {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}) => {
  const [sources, setSources] = useState<DataSource[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [orderChanged, setOrderChanged] = useState(false);
  const [newSource, setNewSource] = useState<DataSource>({
    name: '',
    key: '',
    api: '',
    detail: '',
    disabled: false,
    from: 'config',
  });

  // 批量操作相關狀態
  const [selectedSources, setSelectedSources] = useState<Set<string>>(
    new Set()
  );

  // dnd-kit 傳感器
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // 輕微位移即可觸發
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 150, // 長按 150ms 後觸發，避免與滾動沖突
        tolerance: 5,
      },
    })
  );

  // 初始化
  useEffect(() => {
    if (config?.SourceConfig) {
      setSources(config.SourceConfig);
      // 進入時重置 orderChanged
      setOrderChanged(false);
    }
  }, [config]);

  // 通用 API 請求
  const callSourceApi = async (body: Record<string, any>) => {
    try {
      const resp = await fetch('/api/admin/source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body }),
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || `操作失敗: ${resp.status}`);
      }

      // 成功後刷新配置
      await refreshConfig();
    } catch (err) {
      showError(err instanceof Error ? err.message : '操作失敗');
      throw err; // 向上拋出方便調用處判斷
    }
  };

  const handleToggleEnable = (key: string) => {
    const target = sources.find((s) => s.key === key);
    if (!target) return;
    const action = target.disabled ? 'enable' : 'disable';
    callSourceApi({ action, key }).catch(() => {
      console.error('操作失敗', action, key);
    });
  };

  const handleDelete = (key: string) => {
    callSourceApi({ action: 'delete', key }).catch(() => {
      console.error('操作失敗', 'delete', key);
    });
  };

  const handleAddSource = () => {
    if (!newSource.name || !newSource.key || !newSource.api) return;
    callSourceApi({
      action: 'add',
      key: newSource.key,
      name: newSource.name,
      api: newSource.api,
      detail: newSource.detail,
    })
      .then(() => {
        setNewSource({
          name: '',
          key: '',
          api: '',
          detail: '',
          disabled: false,
          from: 'custom',
        });
        setShowAddForm(false);
      })
      .catch(() => {
        console.error('操作失敗', 'add', newSource);
      });
  };

  const handleDragEnd = (event: any) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = sources.findIndex((s) => s.key === active.id);
    const newIndex = sources.findIndex((s) => s.key === over.id);
    setSources((prev) => arrayMove(prev, oldIndex, newIndex));
    setOrderChanged(true);
  };

  const handleSaveOrder = () => {
    const order = sources.map((s) => s.key);
    callSourceApi({ action: 'sort', order })
      .then(() => {
        setOrderChanged(false);
      })
      .catch(() => {
        console.error('操作失敗', 'sort', order);
      });
  };

  // 分組管理功能已遷移至「用戶配置」模塊，此處不再提供

  // 批量操作相關函數

  const toggleSelectAll = () => {
    if (selectedSources.size === sources.length) {
      setSelectedSources(new Set());
    } else {
      setSelectedSources(new Set(sources.map((s) => s.key)));
    }
  };

  const toggleSelectSource = (key: string) => {
    const newSelected = new Set(selectedSources);
    if (newSelected.has(key)) {
      newSelected.delete(key);
    } else {
      newSelected.add(key);
    }
    setSelectedSources(newSelected);
  };

  const handleBatchDisable = async () => {
    if (selectedSources.size === 0) return;

    const { isConfirmed } = await Swal.fire({
      title: '確認批量禁用',
      text: `確定要禁用選中的 ${selectedSources.size} 個視頻源嗎？`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: '確認禁用',
      cancelButtonText: '取消',
      confirmButtonColor: '#dc2626',
    });

    if (!isConfirmed) return;

    try {
      await callSourceApi({
        action: 'batchDisable',
        keys: Array.from(selectedSources),
      });
    } catch (err) {
      console.error('批量禁用失敗', err);
    }
  };

  const handleBatchEnable = async () => {
    if (selectedSources.size === 0) return;

    const { isConfirmed } = await Swal.fire({
      title: '確認批量啟用',
      text: `確定要啟用選中的 ${selectedSources.size} 個視頻源嗎？`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: '確認啟用',
      cancelButtonText: '取消',
      confirmButtonColor: '#16a34a',
    });

    if (!isConfirmed) return;

    try {
      await callSourceApi({
        action: 'batchEnable',
        keys: Array.from(selectedSources),
      });
      // 批量啟用後保持選中狀態，不清空
    } catch (err) {
      console.error('批量啟用失敗', err);
    }
  };

  const handleBatchDelete = async () => {
    if (selectedSources.size === 0) return;

    // 檢查是否有不可刪除的源
    const deletableSources = sources.filter(
      (s) => selectedSources.has(s.key) && s.from !== 'config'
    );
    const nonDeletableCount = selectedSources.size - deletableSources.length;

    let confirmText = `確定要刪除選中的 ${deletableSources.length} 個自定義視頻源嗎？`;
    if (nonDeletableCount > 0) {
      confirmText += `\n注意：有 ${nonDeletableCount} 個系統默認源無法刪除，將被跳過。`;
    }

    const { isConfirmed } = await Swal.fire({
      title: '確認批量刪除',
      text: confirmText,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: '確認刪除',
      cancelButtonText: '取消',
      confirmButtonColor: '#dc2626',
    });

    if (!isConfirmed) return;

    try {
      await callSourceApi({
        action: 'batchDelete',
        keys: deletableSources.map((s) => s.key),
      });
      setSelectedSources(new Set());
    } catch (err) {
      console.error('批量刪除失敗', err);
    }
  };

  // 可拖拽行封裝 (dnd-kit)
  const DraggableRow = ({ source }: { source: DataSource }) => {
    const { attributes, listeners, setNodeRef, transform, transition } =
      useSortable({ id: source.key });

    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
    } as React.CSSProperties;

    return (
      <tr
        ref={setNodeRef}
        style={style}
        className='hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors select-none'
      >
        {/* 拖拽手柄 */}
        <td
          className='px-2 py-4 cursor-grab text-gray-400'
          style={{ touchAction: 'none' }}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={16} />
        </td>

        {/* 復選框列 */}
        <td className='px-2 py-4'>
          <input
            type='checkbox'
            checked={selectedSources.has(source.key)}
            onChange={() => toggleSelectSource(source.key)}
            className='w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600'
          />
        </td>
        <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100'>
          {source.name}
        </td>
        <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100'>
          {source.key}
        </td>
        <td
          className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100 max-w-[12rem] truncate'
          title={source.api}
        >
          {source.api}
        </td>
        <td
          className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100 max-w-[8rem] truncate'
          title={source.detail || '-'}
        >
          {source.detail || '-'}
        </td>
        <td className='px-6 py-4 whitespace-nowrap max-w-[1rem]'>
          <span
            className={`px-2 py-1 text-xs rounded-full ${
              !source.disabled
                ? 'bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300'
                : 'bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-300'
            }`}
          >
            {!source.disabled ? '啟用中' : '已禁用'}
          </span>
        </td>
        <td className='px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2'>
          <button
            onClick={() => handleToggleEnable(source.key)}
            className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium ${
              !source.disabled
                ? 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/60'
                : 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900/60'
            } transition-colors`}
          >
            {!source.disabled ? '禁用' : '啟用'}
          </button>
          {source.from !== 'config' && (
            <button
              onClick={() => handleDelete(source.key)}
              className='inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-gray-700/40 dark:hover:bg-gray-700/60 dark:text-gray-200 transition-colors'
            >
              刪除
            </button>
          )}
        </td>
      </tr>
    );
  };

  if (!config) {
    return (
      <div className='text-center text-gray-500 dark:text-gray-400'>
        加載中...
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      {/* 分組管理功能移除：請在「用戶配置」中進行分組與分配 */}
      {/* 添加視頻源表單 */}
      <div className='flex items-center justify-between'>
        <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
          視頻源列表
        </h4>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className='px-3 py-1 bg-green-600 hover:bg-green-700 text-white text-sm rounded-lg transition-colors'
        >
          {showAddForm ? '取消' : '添加視頻源'}
        </button>
      </div>

      {/* 批量操作工具欄 */}
      {sources.length > 0 && (
        <div className='p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-700 mb-4'>
          <div className='flex flex-col sm:flex-row items-start sm:items-center gap-3 justify-between'>
            <div className='flex items-center gap-2'>
              <label className='flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300'>
                <input
                  type='checkbox'
                  checked={
                    selectedSources.size === sources.length &&
                    sources.length > 0
                  }
                  onChange={toggleSelectAll}
                  className='w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600'
                />
                全選 ({selectedSources.size}/{sources.length})
              </label>
            </div>
            <div className='flex items-center gap-2'>
              <button
                onClick={handleBatchEnable}
                disabled={selectedSources.size === 0}
                className='px-3 py-1 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white text-sm rounded-lg transition-colors flex items-center gap-1'
              >
                <Check size={14} />
                批量啟用
              </button>
              <button
                onClick={handleBatchDisable}
                disabled={selectedSources.size === 0}
                className='px-3 py-1 bg-red-600 hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white text-sm rounded-lg transition-colors flex items-center gap-1'
              >
                <ChevronDown size={14} />
                批量禁用
              </button>
              <button
                onClick={handleBatchDelete}
                disabled={selectedSources.size === 0}
                className='px-3 py-1 bg-gray-600 hover:bg-gray-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white text-sm rounded-lg transition-colors flex items-center gap-1'
              >
                <FileText size={14} />
                批量刪除
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddForm && (
        <div className='p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 space-y-4'>
          <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
            <input
              type='text'
              placeholder='名稱'
              value={newSource.name}
              onChange={(e) =>
                setNewSource((prev) => ({ ...prev, name: e.target.value }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
            <input
              type='text'
              placeholder='Key'
              value={newSource.key}
              onChange={(e) =>
                setNewSource((prev) => ({ ...prev, key: e.target.value }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
            <input
              type='text'
              placeholder='API 地址'
              value={newSource.api}
              onChange={(e) =>
                setNewSource((prev) => ({ ...prev, api: e.target.value }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
            <input
              type='text'
              placeholder='Detail 地址（選填）'
              value={newSource.detail}
              onChange={(e) =>
                setNewSource((prev) => ({ ...prev, detail: e.target.value }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
          </div>
          <div className='flex justify-end'>
            <button
              onClick={handleAddSource}
              disabled={!newSource.name || !newSource.key || !newSource.api}
              className='w-full sm:w-auto px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-lg transition-colors'
            >
              添加
            </button>
          </div>
        </div>
      )}

      {/* 視頻源表格 */}
      <div className='border border-gray-200 dark:border-gray-700 rounded-lg max-h-[28rem] overflow-y-auto overflow-x-auto'>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          autoScroll={false}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        >
          <table className='min-w-full divide-y divide-gray-200 dark:divide-gray-700'>
            <thead className='bg-gray-50 dark:bg-gray-900'>
              <tr>
                <th className='w-8' />
                <th className='w-8' />
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  名稱
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  Key
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  API 地址
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  Detail 地址
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  狀態
                </th>
                <th className='px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  操作
                </th>
              </tr>
            </thead>
            <SortableContext
              items={sources.map((s) => s.key)}
              strategy={verticalListSortingStrategy}
            >
              <tbody className='divide-y divide-gray-200 dark:divide-gray-700'>
                {sources.map((source) => (
                  <DraggableRow key={source.key} source={source} />
                ))}
              </tbody>
            </SortableContext>
          </table>
        </DndContext>
      </div>

      {/* 保存排序按鈕 */}
      {orderChanged && (
        <div className='flex justify-end'>
          <button
            onClick={handleSaveOrder}
            className='px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors'
          >
            保存排序
          </button>
        </div>
      )}
    </div>
  );
};

// 分類配置組件
const CategoryConfig = ({
  config,
  refreshConfig,
}: {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}) => {
  const [categories, setCategories] = useState<CustomCategory[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [orderChanged, setOrderChanged] = useState(false);
  const [newCategory, setNewCategory] = useState<CustomCategory>({
    name: '',
    type: 'movie',
    query: '',
    disabled: false,
    from: 'config',
  });

  // 注：本節不再基於存儲類型禁用

  // dnd-kit 傳感器
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // 輕微位移即可觸發
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 150, // 長按 150ms 後觸發，避免與滾動沖突
        tolerance: 5,
      },
    })
  );

  // 初始化
  useEffect(() => {
    if (config?.CustomCategories) {
      setCategories(config.CustomCategories);
      // 進入時重置 orderChanged
      setOrderChanged(false);
    }
  }, [config]);

  // 通用 API 請求
  const callCategoryApi = async (body: Record<string, any>) => {
    try {
      const resp = await fetch('/api/admin/category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body }),
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || `操作失敗: ${resp.status}`);
      }

      // 成功後刷新配置
      await refreshConfig();
    } catch (err) {
      showError(err instanceof Error ? err.message : '操作失敗');
      throw err; // 向上拋出方便調用處判斷
    }
  };

  const handleToggleEnable = (query: string, type: 'movie' | 'tv') => {
    const target = categories.find((c) => c.query === query && c.type === type);
    if (!target) return;
    const action = target.disabled ? 'enable' : 'disable';
    callCategoryApi({ action, query, type }).catch(() => {
      console.error('操作失敗', action, query, type);
    });
  };

  const handleDelete = (query: string, type: 'movie' | 'tv') => {
    callCategoryApi({ action: 'delete', query, type }).catch(() => {
      console.error('操作失敗', 'delete', query, type);
    });
  };

  const handleAddCategory = () => {
    if (!newCategory.name || !newCategory.query) return;
    callCategoryApi({
      action: 'add',
      name: newCategory.name,
      type: newCategory.type,
      query: newCategory.query,
    })
      .then(() => {
        setNewCategory({
          name: '',
          type: 'movie',
          query: '',
          disabled: false,
          from: 'custom',
        });
        setShowAddForm(false);
      })
      .catch(() => {
        console.error('操作失敗', 'add', newCategory);
      });
  };

  const handleDragEnd = (event: any) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = categories.findIndex(
      (c) => `${c.query}:${c.type}` === active.id
    );
    const newIndex = categories.findIndex(
      (c) => `${c.query}:${c.type}` === over.id
    );
    setCategories((prev) => arrayMove(prev, oldIndex, newIndex));
    setOrderChanged(true);
  };

  const handleSaveOrder = () => {
    const order = categories.map((c) => `${c.query}:${c.type}`);
    callCategoryApi({ action: 'sort', order })
      .then(() => {
        setOrderChanged(false);
      })
      .catch(() => {
        console.error('操作失敗', 'sort', order);
      });
  };

  // 可拖拽行封裝 (dnd-kit)
  const DraggableRow = ({ category }: { category: CustomCategory }) => {
    const { attributes, listeners, setNodeRef, transform, transition } =
      useSortable({ id: `${category.query}:${category.type}` });

    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
    } as React.CSSProperties;

    return (
      <tr
        ref={setNodeRef}
        style={style}
        className='hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors select-none'
      >
        <td
          className='px-2 py-4 cursor-grab text-gray-400'
          style={{ touchAction: 'none' }}
          {...{ ...attributes, ...listeners }}
        >
          <GripVertical size={16} />
        </td>
        <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100'>
          {category.name || '-'}
        </td>
        <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100'>
          <span
            className={`px-2 py-1 text-xs rounded-full ${
              category.type === 'movie'
                ? 'bg-blue-100 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300'
                : 'bg-purple-100 dark:bg-purple-900/20 text-purple-800 dark:text-purple-300'
            }`}
          >
            {category.type === 'movie' ? '電影' : '電視劇'}
          </span>
        </td>
        <td
          className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100 max-w-[12rem] truncate'
          title={category.query}
        >
          {category.query}
        </td>
        <td className='px-6 py-4 whitespace-nowrap max-w-[1rem]'>
          <span
            className={`px-2 py-1 text-xs rounded-full ${
              !category.disabled
                ? 'bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300'
                : 'bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-300'
            }`}
          >
            {!category.disabled ? '啟用中' : '已禁用'}
          </span>
        </td>
        <td className='px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2'>
          <button
            onClick={() => handleToggleEnable(category.query, category.type)}
            className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium ${
              !category.disabled
                ? 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/60'
                : 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900/60'
            } transition-colors`}
          >
            {!category.disabled ? '禁用' : '啟用'}
          </button>
          {category.from !== 'config' && (
            <button
              onClick={() => handleDelete(category.query, category.type)}
              className='inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-gray-700/40 dark:hover:bg-gray-700/60 dark:text-gray-200 transition-colors'
            >
              刪除
            </button>
          )}
        </td>
      </tr>
    );
  };

  if (!config) {
    return (
      <div className='text-center text-gray-500 dark:text-gray-400'>
        加載中...
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      {/* 添加分類表單 */}
      <div className='flex items-center justify-between'>
        <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
          自定義分類列表
        </h4>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className='px-3 py-1 bg-green-600 hover:bg-green-700 text-white text-sm rounded-lg transition-colors'
        >
          {showAddForm ? '取消' : '添加分類'}
        </button>
      </div>

      {showAddForm && (
        <div className='p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 space-y-4'>
          <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
            <input
              type='text'
              placeholder='分類名稱'
              value={newCategory.name}
              onChange={(e) =>
                setNewCategory((prev) => ({ ...prev, name: e.target.value }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
            <select
              value={newCategory.type}
              onChange={(e) =>
                setNewCategory((prev) => ({
                  ...prev,
                  type: e.target.value as 'movie' | 'tv',
                }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            >
              <option value='movie'>電影</option>
              <option value='tv'>電視劇</option>
            </select>
            <input
              type='text'
              placeholder='搜索關鍵詞'
              value={newCategory.query}
              onChange={(e) =>
                setNewCategory((prev) => ({ ...prev, query: e.target.value }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
          </div>
          <div className='flex justify-end'>
            <button
              onClick={handleAddCategory}
              disabled={!newCategory.name || !newCategory.query}
              className='w-full sm:w-auto px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-lg transition-colors'
            >
              添加
            </button>
          </div>
        </div>
      )}

      {/* 分類表格 */}
      <div className='border border-gray-200 dark:border-gray-700 rounded-lg max-h-[28rem] overflow-y-auto overflow-x-auto'>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          autoScroll={false}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        >
          <table className='min-w-full divide-y divide-gray-200 dark:divide-gray-700'>
            <thead className='bg-gray-50 dark:bg-gray-900'>
              <tr>
                <th className='w-8' />
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  分類名稱
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  類型
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  搜索關鍵詞
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  狀態
                </th>
                <th className='px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  操作
                </th>
              </tr>
            </thead>
            <SortableContext
              items={categories.map((c) => `${c.query}:${c.type}`)}
              strategy={verticalListSortingStrategy}
            >
              <tbody className='divide-y divide-gray-200 dark:divide-gray-700'>
                {categories.map((category) => (
                  <DraggableRow
                    key={`${category.query}:${category.type}`}
                    category={category}
                  />
                ))}
              </tbody>
            </SortableContext>
          </table>
        </DndContext>
      </div>

      {/* 保存排序按鈕 */}
      {orderChanged && (
        <div className='flex justify-end'>
          <button
            onClick={handleSaveOrder}
            className='px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors'
          >
            保存排序
          </button>
        </div>
      )}
    </div>
  );
};

// 新增配置文件組件
const ConfigFileComponent = ({
  config,
  refreshConfig,
}: {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}) => {
  const [configContent, setConfigContent] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (config?.ConfigFile) {
      try {
        // 解析 JSON 並格式化顯示
        const parsedConfig = JSON.parse(config.ConfigFile);
        setConfigContent(JSON.stringify(parsedConfig, null, 2));
      } catch (e) {
        // 如果解析失敗，直接顯示原始內容
        setConfigContent(config.ConfigFile);
      }
    }
  }, [config]);

  // 保存配置文件
  const handleSave = async () => {
    try {
      setSaving(true);

      // 驗證並格式化 JSON
      let formattedConfig;
      try {
        const parsedConfig = JSON.parse(configContent);
        formattedConfig = JSON.stringify(parsedConfig, null, 2);
      } catch (e) {
        throw new Error('配置文件格式錯誤，請檢查 JSON 語法');
      }

      const resp = await fetch('/api/admin/config_file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ configFile: formattedConfig }),
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || `保存失敗: ${resp.status}`);
      }

      showSuccess('配置文件保存成功');
      await refreshConfig();
    } catch (err) {
      showError(err instanceof Error ? err.message : '保存失敗');
    } finally {
      setSaving(false);
    }
  };

  if (!config) {
    return (
      <div className='text-center text-gray-500 dark:text-gray-400'>
        加載中...
      </div>
    );
  }

  return (
    <div className='space-y-4'>
      {/* 配置文件編輯區域 */}
      <div className='space-y-4'>
        <div className='relative'>
          <textarea
            value={configContent}
            onChange={(e) => setConfigContent(e.target.value)}
            rows={20}
            placeholder='請輸入配置文件內容（JSON 格式）...'
            className='w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono text-sm leading-relaxed resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 hover:border-gray-400 dark:hover:border-gray-500'
            style={{
              fontFamily:
                'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace',
            }}
            spellCheck={false}
            data-gramm={false}
          />
        </div>

        <div className='flex items-center justify-between'>
          <div className='text-xs text-gray-500 dark:text-gray-400'>
            支持 JSON 格式，用於配置視頻源和自定義分類
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className={`px-4 py-2 rounded-lg transition-colors ${
              saving
                ? 'bg-gray-400 cursor-not-allowed text-white'
                : 'bg-green-600 hover:bg-green-700 text-white'
            }`}
          >
            {saving ? '保存中…' : '保存配置文件'}
          </button>
        </div>
      </div>
    </div>
  );
};
// 訂閱配置組件
const SubscriptionConfig = ({
  config,
  refreshConfig,
}: {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}) => {
  const [subscriptionUrl, setSubscriptionUrl] = useState('');
  const [autoUpdate, setAutoUpdate] = useState(false);
  const [updateInterval, setUpdateInterval] = useState(86400); // 默認一天
  const [importMode, setImportMode] = useState<'overwrite' | 'merge'>('merge');
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (config?.SubscriptionConfig) {
      const sub = config.SubscriptionConfig;
      setSubscriptionUrl(sub.subscriptionUrl || '');
      setAutoUpdate(sub.autoUpdate || false);
      setUpdateInterval(sub.updateInterval || 86400);
      setImportMode(sub.importMode || 'merge');
      setLastUpdated(sub.lastUpdated || null);
    }
  }, [config]);

  const handleSave = async () => {
    try {
      setSaving(true);
      const resp = await fetch('/api/admin/subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update',
          subscriptionUrl,
          autoUpdate,
          updateInterval,
          importMode,
        }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || '保存失敗');
      }
      showSuccess('訂閱配置已保存');
      await refreshConfig();
    } catch (err) {
      showError(err instanceof Error ? err.message : '保存失敗');
    } finally {
      setSaving(false);
    }
  };

  const handleImport = async () => {
    try {
      setImporting(true);
      const resp = await fetch('/api/admin/subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'import',
          subscriptionUrl: subscriptionUrl || undefined,
          importMode,
        }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || '導入失敗');
      }
      showSuccess('訂閱數據導入成功');
      await refreshConfig();
    } catch (err) {
      showError(err instanceof Error ? err.message : '導入失敗');
    } finally {
      setImporting(false);
    }
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString('zh-TW');
  };

  return (
    <div className='space-y-6'>
      <div className='space-y-4'>
        <div>
          <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'>
            訂閱地址 URL
          </label>
          <input
            type='text'
            value={subscriptionUrl}
            onChange={(e) => setSubscriptionUrl(e.target.value)}
            placeholder='https://example.com/subscription.json'
            className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
          />
          <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
            訂閱地址返回的數據應為 JSON 格式，支持 Base58 編碼。
          </p>
        </div>

        <div>
          <div className='flex items-center justify-between'>
            <label className='text-sm font-medium text-gray-700 dark:text-gray-300'>
              自動更新
            </label>
            <button
              onClick={() => setAutoUpdate(!autoUpdate)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full ${
                autoUpdate ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                  autoUpdate ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
          <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
            用戶/管理員登錄時檢查更新，若超過更新週期則自動導入。
          </p>
        </div>

        <div>
          <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'>
            更新週期（秒）
          </label>
          <input
            type='number'
            value={updateInterval}
            onChange={(e) => setUpdateInterval(Number(e.target.value))}
            className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            min='60'
          />
          <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
            例如：86400 秒 = 1 天
          </p>
        </div>

        <div>
          <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'>
            導入模式
          </label>
          <div className='flex space-x-4'>
            <label className='inline-flex items-center'>
              <input
                type='radio'
                checked={importMode === 'merge'}
                onChange={() => setImportMode('merge')}
                className='form-radio'
              />
              <span className='ml-2'>合並（根據key值合並）</span>
            </label>
            <label className='inline-flex items-center'>
              <input
                type='radio'
                checked={importMode === 'overwrite'}
                onChange={() => setImportMode('overwrite')}
                className='form-radio'
              />
              <span className='ml-2'>覆蓋（清空現有源）</span>
            </label>
          </div>
        </div>

        {lastUpdated && (
          <div className='text-sm text-gray-600 dark:text-gray-400'>
            最後更新時間：{formatTime(lastUpdated)}
          </div>
        )}
      </div>

      <div className='flex space-x-4'>
        <button
          onClick={handleSave}
          disabled={saving}
          className={`px-4 py-2 rounded-lg transition-colors ${
            saving
              ? 'bg-gray-400 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-700'
          } text-white`}
        >
          {saving ? '保存中...' : '保存配置'}
        </button>
        <button
          onClick={handleImport}
          disabled={importing || !subscriptionUrl}
          className={`px-4 py-2 rounded-lg transition-colors ${
            importing || !subscriptionUrl
              ? 'bg-gray-400 cursor-not-allowed'
              : 'bg-green-600 hover:bg-green-700'
          } text-white`}
        >
          {importing ? '導入中...' : '立即導入'}
        </button>
      </div>
    </div>
  );
};

// 新增站點配置組件
const SiteConfigComponent = ({
  config,
  currentUsername,
}: {
  config: AdminConfig | null;
  currentUsername: string | null;
}) => {
  const [siteSettings, setSiteSettings] = useState<SiteConfig>({
    SiteName: '',
    Announcement: '',
    SearchDownstreamMaxPage: 1,
    SiteInterfaceCacheTime: 7200,
    DoubanProxyType: 'direct',
    DoubanProxy: '',
    DoubanImageProxyType: 'direct',
    DoubanImageProxy: '',
    DisableYellowFilter: false,
    TVBoxEnabled: false,
    TVBoxPassword: '',
    DanmakuApiBaseUrl: '',
  });
  // 保存狀態
  const [saving, setSaving] = useState(false);

  // TVBox 密碼生成
  const generateRandomPassword = () => {
    const alphabet =
      'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    return Array.from({ length: 16 })
      .map(() => alphabet[Math.floor(Math.random() * alphabet.length)])
      .join('');
  };

  const encodeUsername = (username: string) => {
    if (!username) return '';
    const bytes = new TextEncoder().encode(username);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  };

  const getTvboxConfigUrl = () => {
    if (typeof window === 'undefined') return '';
    const un = encodeUsername(currentUsername || '');
    const base = `${window.location.origin}/api/tvbox/config`;
    return un ? `${base}?un=${encodeURIComponent(un)}` : base;
  };

  // 豆瓣數據源相關狀態
  const [isDoubanDropdownOpen, setIsDoubanDropdownOpen] = useState(false);
  const [isDoubanImageProxyDropdownOpen, setIsDoubanImageProxyDropdownOpen] =
    useState(false);

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

  // 僅在 localstorage 場景禁用（無法寫入 DB）
  const isLocalStorage =
    typeof window !== 'undefined' &&
    (window as any).RUNTIME_CONFIG?.STORAGE_TYPE === 'localstorage';

  useEffect(() => {
    if (config?.SiteConfig) {
      setSiteSettings({
        ...config.SiteConfig,
        DoubanProxyType: config.SiteConfig.DoubanProxyType || 'direct',
        DoubanProxy: config.SiteConfig.DoubanProxy || '',
        DoubanImageProxyType:
          config.SiteConfig.DoubanImageProxyType || 'direct',
        DoubanImageProxy: config.SiteConfig.DoubanImageProxy || '',
        DisableYellowFilter: config.SiteConfig.DisableYellowFilter || false,
        TVBoxEnabled: config.SiteConfig.TVBoxEnabled || false,
        TVBoxPassword: config.SiteConfig.TVBoxPassword || '',
        DanmakuApiBaseUrl: config.SiteConfig.DanmakuApiBaseUrl || '',
      });
    }
  }, [config]);

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

  // 處理豆瓣數據源變化
  const handleDoubanDataSourceChange = (value: string) => {
    if (!isLocalStorage) {
      setSiteSettings((prev) => ({
        ...prev,
        DoubanProxyType: value,
      }));
    }
  };

  // 處理豆瓣圖片代理變化
  const handleDoubanImageProxyChange = (value: string) => {
    if (!isLocalStorage) {
      setSiteSettings((prev) => ({
        ...prev,
        DoubanImageProxyType: value,
      }));
    }
  };

  // 保存站點配置
  const handleSave = async () => {
    try {
      setSaving(true);
      const resp = await fetch('/api/admin/site', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...siteSettings }),
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || `保存失敗: ${resp.status}`);
      }

      showSuccess('保存成功, 請刷新頁面');
    } catch (err) {
      showError(err instanceof Error ? err.message : '保存失敗');
    } finally {
      setSaving(false);
    }
  };

  if (!config) {
    return (
      <div className='text-center text-gray-500 dark:text-gray-400'>
        加載中...
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      {/* 站點名稱 */}
      <div>
        <label
          className={`block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 ${
            isLocalStorage ? 'opacity-50' : ''
          }`}
        >
          站點名稱
          {isLocalStorage && (
            <span className='ml-2 text-xs text-gray-500 dark:text-gray-400'>
              (本地存儲下請通過環境變量修改)
            </span>
          )}
        </label>
        <input
          type='text'
          value={siteSettings.SiteName}
          onChange={(e) =>
            !isLocalStorage &&
            setSiteSettings((prev) => ({ ...prev, SiteName: e.target.value }))
          }
          disabled={isLocalStorage}
          className={`w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent ${
            isLocalStorage ? 'opacity-50 cursor-not-allowed' : ''
          }`}
        />
      </div>

      {/* 站點公告 */}
      <div>
        <label
          className={`block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 ${
            isLocalStorage ? 'opacity-50' : ''
          }`}
        >
          站點公告
          {isLocalStorage && (
            <span className='ml-2 text-xs text-gray-500 dark:text-gray-400'>
              (本地存儲下請通過環境變量修改)
            </span>
          )}
        </label>
        <textarea
          value={siteSettings.Announcement}
          onChange={(e) =>
            !isLocalStorage &&
            setSiteSettings((prev) => ({
              ...prev,
              Announcement: e.target.value,
            }))
          }
          disabled={isLocalStorage}
          rows={3}
          className={`w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent ${
            isLocalStorage ? 'opacity-50 cursor-not-allowed' : ''
          }`}
        />
      </div>

      {/* 豆瓣數據源設置 */}
      <div className='space-y-3'>
        <div>
          <label
            className={`block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 ${
              isLocalStorage ? 'opacity-50' : ''
            }`}
          >
            豆瓣數據代理
            {isLocalStorage && (
              <span className='ml-2 text-xs text-gray-500 dark:text-gray-400'>
                (本地存儲下請通過環境變量修改)
              </span>
            )}
          </label>
          <div className='relative' data-dropdown='douban-datasource'>
            {/* 自定義下拉選擇框 */}
            <button
              type='button'
              onClick={() => setIsDoubanDropdownOpen(!isDoubanDropdownOpen)}
              disabled={isLocalStorage}
              className={`w-full px-3 py-2.5 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm hover:border-gray-400 dark:hover:border-gray-500 text-left ${
                isLocalStorage ? 'opacity-50 cursor-not-allowed' : ''
              }`}
            >
              {
                doubanDataSourceOptions.find(
                  (option) => option.value === siteSettings.DoubanProxyType
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
            {isDoubanDropdownOpen && !isLocalStorage && (
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
                      siteSettings.DoubanProxyType === option.value
                        ? 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400'
                        : 'text-gray-900 dark:text-gray-100'
                    }`}
                  >
                    <span className='truncate'>{option.label}</span>
                    {siteSettings.DoubanProxyType === option.value && (
                      <Check className='w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0 ml-2' />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
          <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
            選擇獲取豆瓣數據的方式
          </p>

          {/* 感謝信息 */}
          {getThanksInfo(siteSettings.DoubanProxyType) && (
            <div className='mt-3'>
              <button
                type='button'
                onClick={() =>
                  window.open(
                    getThanksInfo(siteSettings.DoubanProxyType)!.url,
                    '_blank'
                  )
                }
                className='flex items-center justify-center gap-1.5 w-full px-3 text-xs text-gray-500 dark:text-gray-400 cursor-pointer'
              >
                <span className='font-medium'>
                  {getThanksInfo(siteSettings.DoubanProxyType)!.text}
                </span>
                <ExternalLink className='w-3.5 opacity-70' />
              </button>
            </div>
          )}
        </div>

        {/* 豆瓣代理地址設置 - 僅在選擇自定義代理時顯示 */}
        {siteSettings.DoubanProxyType === 'custom' && (
          <div>
            <label
              className={`block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 ${
                isLocalStorage ? 'opacity-50' : ''
              }`}
            >
              豆瓣代理地址
            </label>
            <input
              type='text'
              placeholder='例如: https://proxy.example.com/fetch?url='
              value={siteSettings.DoubanProxy}
              onChange={(e) =>
                !isLocalStorage &&
                setSiteSettings((prev) => ({
                  ...prev,
                  DoubanProxy: e.target.value,
                }))
              }
              disabled={isLocalStorage}
              className={`w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 shadow-sm hover:border-gray-400 dark:hover:border-gray-500 ${
                isLocalStorage ? 'opacity-50 cursor-not-allowed' : ''
              }`}
            />
            <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
              自定義代理服務器地址
            </p>
          </div>
        )}
      </div>

      {/* 彈幕接口配置 */}
      <div className='space-y-3'>
        <div>
          <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
            彈幕接口基礎地址
            <span className='ml-2 text-xs text-gray-500 dark:text-gray-400'>
              （如使用第三方彈幕服務，可在此填寫其 API 根地址）
            </span>
          </label>
          <input
            type='text'
            value={siteSettings.DanmakuApiBaseUrl || ''}
            onChange={(e) =>
              setSiteSettings((prev) => ({
                ...prev,
                DanmakuApiBaseUrl: e.target.value,
              }))
            }
            className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
            placeholder=''
          />
        </div>
      </div>

      {/* 豆瓣圖片代理設置 */}
      <div className='space-y-3'>
        <div>
          <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
            豆瓣圖片代理
          </label>
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
                  (option) => option.value === siteSettings.DoubanImageProxyType
                )?.label
              }
            </button>

            {/* 下拉箭頭 */}
            <div className='absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none'>
              <ChevronDown
                className={`w-4 h-4 text-gray-400 dark:text-gray-500 transition-transform duration-200 ${
                  isDoubanImageProxyDropdownOpen ? 'rotate-180' : ''
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
                      handleDoubanImageProxyChange(option.value);
                      setIsDoubanImageProxyDropdownOpen(false);
                    }}
                    className={`w-full px-3 py-2.5 text-left text-sm transition-colors duration-150 flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-700 ${
                      siteSettings.DoubanImageProxyType === option.value
                        ? 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400'
                        : 'text-gray-900 dark:text-gray-100'
                    }`}
                  >
                    <span className='truncate'>{option.label}</span>
                    {siteSettings.DoubanImageProxyType === option.value && (
                      <Check className='w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0 ml-2' />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
          <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
            選擇獲取豆瓣圖片的方式
          </p>

          {/* 感謝信息 */}
          {getThanksInfo(siteSettings.DoubanImageProxyType) && (
            <div className='mt-3'>
              <button
                type='button'
                onClick={() =>
                  window.open(
                    getThanksInfo(siteSettings.DoubanImageProxyType)!.url,
                    '_blank'
                  )
                }
                className='flex items-center justify-center gap-1.5 w-full px-3 text-xs text-gray-500 dark:text-gray-400 cursor-pointer'
              >
                <span className='font-medium'>
                  {getThanksInfo(siteSettings.DoubanImageProxyType)!.text}
                </span>
                <ExternalLink className='w-3.5 opacity-70' />
              </button>
            </div>
          )}
        </div>

        {/* 豆瓣代理地址設置 - 僅在選擇自定義代理時顯示 */}
        {siteSettings.DoubanImageProxyType === 'custom' && (
          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
              豆瓣圖片代理地址
            </label>
            <input
              type='text'
              placeholder='例如: https://proxy.example.com/fetch?url='
              value={siteSettings.DoubanImageProxy}
              onChange={(e) =>
                setSiteSettings((prev) => ({
                  ...prev,
                  DoubanImageProxy: e.target.value,
                }))
              }
              className='w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 shadow-sm hover:border-gray-400 dark:hover:border-gray-500'
            />
            <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
              自定義圖片代理服務器地址
            </p>
          </div>
        )}
      </div>

      {/* 搜索接口可拉取最大頁數 */}
      <div>
        <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
          搜索接口可拉取最大頁數
        </label>
        <input
          type='number'
          min={1}
          value={siteSettings.SearchDownstreamMaxPage}
          onChange={(e) =>
            setSiteSettings((prev) => ({
              ...prev,
              SearchDownstreamMaxPage: Number(e.target.value),
            }))
          }
          className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
        />
      </div>

      {/* 站點接口緩存時間 */}
      <div>
        <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
          站點接口緩存時間（秒）
        </label>
        <input
          type='number'
          min={1}
          value={siteSettings.SiteInterfaceCacheTime}
          onChange={(e) =>
            setSiteSettings((prev) => ({
              ...prev,
              SiteInterfaceCacheTime: Number(e.target.value),
            }))
          }
          className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
        />
      </div>

      {/* 禁用黃色過濾器 */}
      <div>
        <div className='flex items-center justify-between'>
          <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
            禁用黃色過濾器
          </label>
          <button
            type='button'
            onClick={() =>
              setSiteSettings((prev) => ({
                ...prev,
                DisableYellowFilter: !prev.DisableYellowFilter,
              }))
            }
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ${
              siteSettings.DisableYellowFilter
                ? 'bg-green-600'
                : 'bg-gray-200 dark:bg-gray-700'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                siteSettings.DisableYellowFilter
                  ? 'translate-x-6'
                  : 'translate-x-1'
              }`}
            />
          </button>
        </div>
        <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
          禁用黃色內容的過濾功能，允許顯示所有內容。
        </p>
      </div>

      {/* TVBox 配置 */}
      <div className='space-y-4 pt-4 border-t border-gray-200 dark:border-gray-700'>
        <h3 className='text-base font-semibold text-gray-900 dark:text-gray-100'>
          TVBox 接口配置
        </h3>

        {/* TVBox 開關 */}
        <div>
          <div className='flex items-center justify-between'>
            <label
              className={`block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 ${
                isLocalStorage ? 'opacity-50' : ''
              }`}
            >
              啟用 TVBox 接口
              {isLocalStorage && (
                <span className='ml-2 text-xs text-gray-500 dark:text-gray-400'>
                  (本地模式由環境變量 TVBOX_ENABLED 控制)
                </span>
              )}
            </label>
            <button
              type='button'
              onClick={() =>
                !isLocalStorage &&
                setSiteSettings((prev) => ({
                  ...prev,
                  TVBoxEnabled: !prev.TVBoxEnabled,
                }))
              }
              disabled={isLocalStorage}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ${
                isLocalStorage ? 'opacity-50 cursor-not-allowed' : ''
              } ${
                siteSettings.TVBoxEnabled
                  ? 'bg-green-600'
                  : 'bg-gray-200 dark:bg-gray-700'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  siteSettings.TVBoxEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
          <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
            開啟後可在 TVBox 中使用本站數據，訪問需攜帶密碼。
          </p>
        </div>

        {/* TVBox 接口地址和密碼 */}
        <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
          {/* 接口地址 */}
          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
              接口地址
            </label>
            <div className='flex gap-2'>
              <input
                type='text'
                value={getTvboxConfigUrl()}
                readOnly
                className='flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm'
              />
              <button
                type='button'
                onClick={() => {
                  const url = getTvboxConfigUrl();
                  if (url) {
                    navigator.clipboard.writeText(url);
                  }
                }}
                className='px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors text-sm'
              >
                復制
              </button>
            </div>
            <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
              將該地址填入 TVBox 的訂閱/配置接口，並在請求頭設置
              <code className='ml-1'>x-tvbox-password</code>
            </p>
          </div>

          {/* 訪問密碼 */}
          <div>
            <label
              className={`block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 ${
                isLocalStorage ? 'opacity-50' : ''
              }`}
            >
              訪問密碼
              {isLocalStorage && (
                <span className='ml-2 text-xs text-gray-500 dark:text-gray-400'>
                  (本地模式口令為環境變量 PASSWORD)
                </span>
              )}
            </label>
            <div className='flex gap-2'>
              <input
                type='text'
                placeholder='設置訪問密碼'
                value={siteSettings.TVBoxPassword}
                onChange={(e) =>
                  !isLocalStorage &&
                  setSiteSettings((prev) => ({
                    ...prev,
                    TVBoxPassword: e.target.value,
                  }))
                }
                disabled={isLocalStorage}
                className={`flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent ${
                  isLocalStorage ? 'opacity-50 cursor-not-allowed' : ''
                }`}
              />
              <button
                type='button'
                onClick={() =>
                  !isLocalStorage &&
                  setSiteSettings((prev) => ({
                    ...prev,
                    TVBoxPassword: generateRandomPassword(),
                  }))
                }
                disabled={isLocalStorage}
                className={`px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors text-sm ${
                  isLocalStorage ? 'opacity-50 cursor-not-allowed' : ''
                }`}
              >
                生成
              </button>
            </div>
            <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
              建議使用隨機生成的密碼
            </p>
          </div>
        </div>
      </div>

      {/* 操作按鈕 */}
      <div className='flex justify-end'>
        <button
          onClick={handleSave}
          disabled={saving}
          className={`px-4 py-2 ${
            saving
              ? 'bg-gray-400 cursor-not-allowed'
              : 'bg-green-600 hover:bg-green-700'
          } text-white rounded-lg transition-colors`}
        >
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  );
};

function AdminPageClient() {
  const [config, setConfig] = useState<AdminConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<'owner' | 'admin' | null>(null);
  const [authInfo, setAuthInfo] = useState<AuthInfo | null>(() =>
    getCachedAuthInfo()
  );
  const currentUsername = authInfo?.username || null;
  const [expandedTabs, setExpandedTabs] = useState<{ [key: string]: boolean }>({
    userConfig: false,
    videoSource: false,
    siteConfig: false,
    categoryConfig: false,
    configFile: false,
    subscriptionConfig: false,
  });

  // 獲取管理員配置
  // showLoading 用於控制是否在請求期間顯示整體加載骨架。
  const fetchConfig = useCallback(async (showLoading = false) => {
    try {
      if (showLoading) {
        setLoading(true);
      }

      const response = await fetch(`/api/admin/config`);

      if (!response.ok) {
        const data = (await response.json()) as any;
        throw new Error(`獲取配置失敗: ${data.error}`);
      }

      const data = (await response.json()) as AdminConfigResult;
      setConfig(data.Config);
      setRole(data.Role);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '獲取配置失敗';
      showError(msg);
      setError(msg);
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    // 首次加載時顯示骨架
    fetchConfig(true);
  }, [fetchConfig]);

  useEffect(() => {
    refreshAuthInfo().then(setAuthInfo);
  }, []);

  // 切換標簽展開狀態
  const toggleTab = (tabKey: string) => {
    setExpandedTabs((prev) => ({
      ...prev,
      [tabKey]: !prev[tabKey],
    }));
  };

  // 新增: 重置配置處理函數
  const handleResetConfig = async () => {
    const { isConfirmed } = await Swal.fire({
      title: '確認重置配置',
      text: '此操作將重置用戶封禁和管理員設置、自定義視頻源，站點配置將重置為默認值，是否繼續？',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: '確認',
      cancelButtonText: '取消',
    });
    if (!isConfirmed) return;

    try {
      const response = await fetch(`/api/admin/reset`, {
        method: 'POST',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });
      if (!response.ok) {
        throw new Error(`重置失敗: ${response.status}`);
      }
      showSuccess('重置成功，請刷新頁面！');
    } catch (err) {
      showError(err instanceof Error ? err.message : '重置失敗');
    }
  };

  if (loading) {
    return (
      <PageLayout activePath='/admin'>
        <div className='px-2 sm:px-10 py-4 sm:py-8'>
          <div className='max-w-[95%] mx-auto'>
            <h1 className='text-2xl font-bold text-gray-900 dark:text-gray-100 mb-8'>
              管理員設置
            </h1>
            <div className='space-y-4'>
              {Array.from({ length: 3 }).map((_, index) => (
                <div
                  key={index}
                  className='h-20 bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse'
                />
              ))}
            </div>
          </div>
        </div>
      </PageLayout>
    );
  }

  if (error) {
    // 錯誤已通過 SweetAlert2 展示，此處直接返回空
    return null;
  }

  return (
    <PageLayout activePath='/admin'>
      <div className='px-2 sm:px-10 py-4 sm:py-8'>
        <div className='max-w-[95%] mx-auto'>
          {/* 標題 + 重置配置按鈕 */}
          <div className='flex items-center gap-2 mb-8'>
            <h1 className='text-2xl font-bold text-gray-900 dark:text-gray-100'>
              管理員設置
            </h1>
            {/* 緩存提示按鈕 */}
            <button
              onClick={() => {
                Swal.fire({
                  title: '提示',
                  text: '視頻源配置和分類配置中的修改需要清理瀏覽緩存才會在UI上徹底生效，否則需等待站點配置中的接口緩存時間後才生效',
                  icon: 'info',
                  confirmButtonText: '我知道了',
                  confirmButtonColor: '#3b82f6',
                });
              }}
              className='w-8 h-8 p-1.5 rounded-full flex items-center justify-center text-gray-600 hover:bg-gray-200/50 dark:text-gray-300 dark:hover:bg-gray-700/50 transition-colors'
              aria-label='緩存提示'
            >
              <Bell className='w-full h-full' />
            </button>
            {config && role === 'owner' && (
              <button
                onClick={handleResetConfig}
                className='px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-xs rounded-md transition-colors'
              >
                重置配置
              </button>
            )}
          </div>

          {/* 訂閱配置標簽 */}
          <CollapsibleTab
            title='訂閱配置'
            icon={
              <Bell size={20} className='text-gray-600 dark:text-gray-400' />
            }
            isExpanded={expandedTabs.subscriptionConfig}
            onToggle={() => toggleTab('subscriptionConfig')}
          >
            <SubscriptionConfig config={config} refreshConfig={fetchConfig} />
          </CollapsibleTab>

          {/* 配置文件標簽 */}
          <CollapsibleTab
            title='配置文件'
            icon={
              <FileText
                size={20}
                className='text-gray-600 dark:text-gray-400'
              />
            }
            isExpanded={expandedTabs.configFile}
            onToggle={() => toggleTab('configFile')}
          >
            <ConfigFileComponent config={config} refreshConfig={fetchConfig} />
          </CollapsibleTab>

          {/* 站點配置標簽 */}
          <CollapsibleTab
            title='站點配置'
            icon={
              <Settings
                size={20}
                className='text-gray-600 dark:text-gray-400'
              />
            }
            isExpanded={expandedTabs.siteConfig}
            onToggle={() => toggleTab('siteConfig')}
          >
            <SiteConfigComponent
              config={config}
              currentUsername={currentUsername}
            />
          </CollapsibleTab>

          <div className='space-y-4'>
            {/* 用戶配置標簽 */}
            <CollapsibleTab
              title='用戶配置'
              icon={
                <Users size={20} className='text-gray-600 dark:text-gray-400' />
              }
              isExpanded={expandedTabs.userConfig}
              onToggle={() => toggleTab('userConfig')}
            >
              <UserConfig
                config={config}
                role={role}
                refreshConfig={fetchConfig}
                currentUsername={currentUsername}
              />
            </CollapsibleTab>

            {/* 視頻源配置標簽 */}
            <CollapsibleTab
              title='視頻源配置'
              icon={
                <Video size={20} className='text-gray-600 dark:text-gray-400' />
              }
              isExpanded={expandedTabs.videoSource}
              onToggle={() => toggleTab('videoSource')}
            >
              <VideoSourceConfig config={config} refreshConfig={fetchConfig} />
            </CollapsibleTab>

            {/* 分類配置標簽 */}
            <CollapsibleTab
              title='分類配置'
              icon={
                <FolderOpen
                  size={20}
                  className='text-gray-600 dark:text-gray-400'
                />
              }
              isExpanded={expandedTabs.categoryConfig}
              onToggle={() => toggleTab('categoryConfig')}
            >
              <CategoryConfig config={config} refreshConfig={fetchConfig} />
            </CollapsibleTab>

            {/* 數據遷移標簽 - 僅站長可見 */}
            {role === 'owner' && (
              <CollapsibleTab
                title='數據遷移'
                icon={
                  <Database
                    size={20}
                    className='text-gray-600 dark:text-gray-400'
                  />
                }
                isExpanded={expandedTabs.dataMigration}
                onToggle={() => toggleTab('dataMigration')}
              >
                <DataMigration onRefreshConfig={fetchConfig} />
              </CollapsibleTab>
            )}
          </div>
        </div>
      </div>
    </PageLayout>
  );
}

export default function AdminPage() {
  return (
    <Suspense>
      <AdminPageClient />
    </Suspense>
  );
}
