/* eslint-disable @typescript-eslint/no-explicit-any, no-console, @typescript-eslint/no-non-null-assertion */

import { ensureAdultAuthConfig } from '@/lib/adult-authorization';
import { getStorage } from '@/lib/db';

import { AdminConfig } from './admin.types';
import runtimeConfig from './runtime';

export interface ApiSite {
  key: string;
  api: string;
  name: string;
  detail?: string;
}

export interface ConfigFileStruct {
  cache_time?: number;
  api_site: {
    [key: string]: ApiSite;
  };
  custom_category?: {
    name?: string;
    type: 'movie' | 'tv';
    query: string;
  }[];
}

export const API_CONFIG = {
  search: {
    path: '?ac=videolist&wd=',
    pagePath: '?ac=videolist&wd={query}&pg={page}',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'application/json',
    },
  },
  detail: {
    path: '?ac=videolist&ids=',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'application/json',
    },
  },
};

// 在模塊加載時根據環境決定配置來源
let fileConfig: ConfigFileStruct;
let cachedConfig: AdminConfig;

export const ADULT_SOURCE_KEYS = new Set([
  'ckzy',
  'aivin',
  'dnzzy',
  'xiaojizy',
  'yutu',
  'doudou',
  'didi',
  'jkun',
  'souav',
]);

export function mergeRuntimeDefaultApiSites(config: ConfigFileStruct): {
  changed: boolean;
  config: ConfigFileStruct;
} {
  const defaults = runtimeConfig as unknown as ConfigFileStruct;
  const nextConfig: ConfigFileStruct = {
    ...config,
    api_site: {
      ...(config.api_site || {}),
    },
  };
  let changed = false;

  if (
    nextConfig.cache_time === undefined &&
    defaults.cache_time !== undefined
  ) {
    nextConfig.cache_time = defaults.cache_time;
    changed = true;
  }

  Object.entries(defaults.api_site || {}).forEach(([key, site]) => {
    if (!nextConfig.api_site[key]) {
      nextConfig.api_site[key] = site;
      changed = true;
    }
  });

  return { changed, config: nextConfig };
}

function hasAdultDefaultSources(config: ConfigFileStruct): boolean {
  return Object.keys(config.api_site || {}).some((key) =>
    ADULT_SOURCE_KEYS.has(key)
  );
}

function enableAdultSourceAccess(
  adminConfig: AdminConfig,
  config: ConfigFileStruct
): boolean {
  if (
    hasAdultDefaultSources(config) &&
    adminConfig.SiteConfig.DisableYellowFilter !== true
  ) {
    adminConfig.SiteConfig.DisableYellowFilter = true;
    return true;
  }

  return false;
}

function parseConfigFileStruct(
  rawConfigFile: unknown,
  logErrors = false
): ConfigFileStruct {
  if (typeof rawConfigFile !== 'string' || rawConfigFile.trim().length === 0) {
    return { api_site: {} };
  }

  try {
    const parsed = JSON.parse(rawConfigFile) as ConfigFileStruct;
    return {
      ...parsed,
      api_site: parsed.api_site || {},
    };
  } catch (e) {
    if (logErrors) {
      console.error('解析配置文件失敗:', e);
    }

    return { api_site: {} };
  }
}

export function refineConfig(adminConfig: AdminConfig): AdminConfig {
  fileConfig = parseConfigFileStruct(adminConfig.ConfigFile);
  const mergedConfig = mergeRuntimeDefaultApiSites(fileConfig);
  fileConfig = mergedConfig.config;
  if (mergedConfig.changed) {
    adminConfig.ConfigFile = JSON.stringify(fileConfig);
  }
  enableAdultSourceAccess(adminConfig, fileConfig);
  // 合並文件中的源信息
  const apiSiteEntries = Object.entries(fileConfig.api_site || []);
  const sourceConfigMap = new Map(
    (adminConfig.SourceConfig || []).map((s) => [s.key, s])
  );

  apiSiteEntries.forEach(([key, site]) => {
    const existingSource = sourceConfigMap.get(key);
    if (existingSource) {
      // 如果已存在，只覆蓋 name、api、detail 和 from
      existingSource.name = site.name;
      existingSource.api = site.api;
      existingSource.detail = site.detail;
      existingSource.from = 'config';
    } else {
      // 如果不存在，創建新條目
      sourceConfigMap.set(key, {
        key,
        name: site.name,
        api: site.api,
        detail: site.detail,
        from: 'config',
        disabled: false,
      });
    }
  });

  // 檢查現有源是否在 fileConfig.api_site 中，如果不在則標記為 custom
  const apiSiteKeys = new Set(apiSiteEntries.map(([key]) => key));
  sourceConfigMap.forEach((source) => {
    if (!apiSiteKeys.has(source.key)) {
      source.from = 'custom';
    }
  });

  // 將 Map 轉換回數組
  adminConfig.SourceConfig = Array.from(sourceConfigMap.values());

  // 覆蓋 CustomCategories
  const customCategories = fileConfig.custom_category || [];
  const customCategoriesMap = new Map(
    (adminConfig.CustomCategories || []).map((c) => [c.query + c.type, c])
  );

  customCategories.forEach((category) => {
    const key = category.query + category.type;
    const existedCategory = customCategoriesMap.get(key);
    if (existedCategory) {
      existedCategory.name = category.name;
      existedCategory.query = category.query;
      existedCategory.type = category.type;
      existedCategory.from = 'config';
    } else {
      customCategoriesMap.set(key, {
        name: category.name,
        type: category.type,
        query: category.query,
        from: 'config',
        disabled: false,
      });
    }
  });

  // 檢查現有 CustomCategories 是否在 fileConfig.custom_category 中，如果不在則標記為 custom
  const customCategoriesKeys = new Set(
    customCategories.map((c) => c.query + c.type)
  );
  customCategoriesMap.forEach((category) => {
    if (!customCategoriesKeys.has(category.query + category.type)) {
      category.from = 'custom';
    }
  });

  // 將 Map 轉換回數組
  adminConfig.CustomCategories = Array.from(customCategoriesMap.values());

  // 同步 cache_time 到 SiteConfig.SiteInterfaceCacheTime
  if (fileConfig.cache_time !== undefined) {
    adminConfig.SiteConfig.SiteInterfaceCacheTime = fileConfig.cache_time;
  }

  return adminConfig;
}

async function initConfig() {
  if (cachedConfig) {
    return;
  }

  if (process.env.DOCKER_ENV === 'true') {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const _require = eval('require') as NodeJS.Require;
    const fs = _require('fs') as typeof import('fs');
    const path = _require('path') as typeof import('path');

    const configPath = path.join(process.cwd(), 'config.json');
    const raw = fs.readFileSync(configPath, 'utf-8');
    fileConfig = JSON.parse(raw) as ConfigFileStruct;
    console.log('load dynamic config success');
  } else {
    // 默認使用編譯時生成的配置
    fileConfig = runtimeConfig as unknown as ConfigFileStruct;
  }
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType !== 'localstorage') {
    if (cachedConfig) {
      // 自檢補全配置
      cachedConfig = refineConfig(cachedConfig);
      return;
    }

    // 數據庫存儲，讀取並補全管理員配置
    const storage = getStorage();

    try {
      // 嘗試從數據庫獲取管理員配置
      let adminConfig: AdminConfig | null = null;
      if (storage && typeof (storage as any).getAdminConfig === 'function') {
        adminConfig = await (storage as any).getAdminConfig();
      }

      // 獲取所有用戶名，用於補全 Users
      let userNames: string[] = [];
      if (storage && typeof (storage as any).getAllUsers === 'function') {
        try {
          userNames = await (storage as any).getAllUsers();
        } catch (e) {
          console.error('獲取用戶列表失敗:', e);
        }
      }

      if (adminConfig) {
        fileConfig = parseConfigFileStruct(adminConfig.ConfigFile, true);
        const mergedConfig = mergeRuntimeDefaultApiSites(fileConfig);
        fileConfig = mergedConfig.config;
        if (mergedConfig.changed) {
          adminConfig.ConfigFile = JSON.stringify(fileConfig);
        }
        enableAdultSourceAccess(adminConfig, fileConfig);
        const apiSiteEntries = Object.entries(fileConfig.api_site || []);
        const customCategories = fileConfig.custom_category || [];

        // 補全 SourceConfig
        const sourceConfigMap = new Map(
          (adminConfig.SourceConfig || []).map((s) => [s.key, s])
        );

        apiSiteEntries.forEach(([key, site]) => {
          sourceConfigMap.set(key, {
            key,
            name: site.name,
            api: site.api,
            detail: site.detail,
            from: 'config',
            disabled: false,
          });
        });

        // 將 Map 轉換回數組
        adminConfig.SourceConfig = Array.from(sourceConfigMap.values());

        // 檢查現有源是否在 fileConfig.api_site 中，如果不在則標記為 custom
        const apiSiteKeys = new Set(apiSiteEntries.map(([key]) => key));
        adminConfig.SourceConfig.forEach((source) => {
          if (!apiSiteKeys.has(source.key)) {
            source.from = 'custom';
          }
        });

        // 確保 CustomCategories 被初始化
        if (!adminConfig.CustomCategories) {
          adminConfig.CustomCategories = [];
        }

        // 補全 CustomCategories
        const customCategoriesMap = new Map(
          adminConfig.CustomCategories.map((c) => [c.query + c.type, c])
        );

        customCategories.forEach((category) => {
          customCategoriesMap.set(category.query + category.type, {
            name: category.name,
            type: category.type,
            query: category.query,
            from: 'config',
            disabled: false,
          });
        });

        // 檢查現有 CustomCategories 是否在 fileConfig.custom_category 中，如果不在則標記為 custom
        const customCategoriesKeys = new Set(
          customCategories.map((c) => c.query + c.type)
        );
        customCategoriesMap.forEach((category) => {
          if (!customCategoriesKeys.has(category.query + category.type)) {
            category.from = 'custom';
          }
        });

        // 將 Map 轉換回數組
        adminConfig.CustomCategories = Array.from(customCategoriesMap.values());

        const existedUsers = new Set(
          (adminConfig.UserConfig.Users || []).map((u) => u.username)
        );
        userNames.forEach((uname) => {
          if (!existedUsers.has(uname)) {
            adminConfig!.UserConfig.Users.push({
              username: uname,
              role: 'user',
            });
          }
        });
        // 站長
        const ownerUser = process.env.USERNAME;
        if (ownerUser) {
          adminConfig!.UserConfig.Users = adminConfig!.UserConfig.Users.filter(
            (u) => u.username !== ownerUser
          );
          adminConfig!.UserConfig.Users.unshift({
            username: ownerUser,
            role: 'owner',
          });
        }
        // 初始化分組結構（若缺失）
        if (!adminConfig.UserConfig) {
          adminConfig.UserConfig = {
            AllowRegister: false,
            Users: [],
            Groups: [],
          } as any;
        }
        if (
          !('Groups' in adminConfig.UserConfig) ||
          !adminConfig.UserConfig.Groups
        ) {
          (adminConfig.UserConfig as any).Groups = [];
        }
        ensureAdultAuthConfig(adminConfig);
      } else {
        // 數據庫中沒有配置，使用默認的運行時配置
        if (process.env.DOCKER_ENV === 'true') {
          // eslint-disable-next-line @typescript-eslint/no-implied-eval
          const _require = eval('require') as NodeJS.Require;
          const fs = _require('fs') as typeof import('fs');
          const path = _require('path') as typeof import('path');

          const configPath = path.join(process.cwd(), 'config.json');
          const raw = fs.readFileSync(configPath, 'utf-8');
          fileConfig = JSON.parse(raw) as ConfigFileStruct;
        } else {
          // 默認使用編譯時生成的配置
          fileConfig = runtimeConfig as unknown as ConfigFileStruct;
        }
        // 數據庫中沒有配置，創建新的管理員配置
        let allUsers = userNames.map((uname) => ({
          username: uname,
          role: 'user',
        }));
        const ownerUser = process.env.USERNAME;
        if (ownerUser) {
          allUsers = allUsers.filter((u) => u.username !== ownerUser);
          allUsers.unshift({
            username: ownerUser,
            role: 'owner',
          });
        }
        adminConfig = {
          ConfigFile: JSON.stringify(fileConfig),
          SiteConfig: {
            SiteName: process.env.NEXT_PUBLIC_SITE_NAME || 'MoonTV',
            Announcement:
              process.env.ANNOUNCEMENT ||
              '本網站僅提供影視信息搜索服務，所有內容均來自第三方網站。本站不存儲任何視頻資源，不對任何內容的準確性、合法性、完整性負責。',
            SearchDownstreamMaxPage:
              Number(process.env.NEXT_PUBLIC_SEARCH_MAX_PAGE) || 5,
            SiteInterfaceCacheTime: fileConfig.cache_time || 7200,
            DoubanProxyType:
              process.env.NEXT_PUBLIC_DOUBAN_PROXY_TYPE || 'direct',
            DoubanProxy: process.env.NEXT_PUBLIC_DOUBAN_PROXY || '',
            DoubanImageProxyType:
              process.env.NEXT_PUBLIC_DOUBAN_IMAGE_PROXY_TYPE || 'server',
            DoubanImageProxy: process.env.NEXT_PUBLIC_DOUBAN_IMAGE_PROXY || '',
            DisableYellowFilter:
              hasAdultDefaultSources(fileConfig) ||
              process.env.NEXT_PUBLIC_DISABLE_YELLOW_FILTER === 'true',
            DanmakuApiBaseUrl: process.env.NEXT_PUBLIC_DANMU_API_BASE_URL || '',
            TVBoxEnabled: false,
            TVBoxPassword: '',
          },
          UserConfig: {
            AllowRegister: process.env.NEXT_PUBLIC_ENABLE_REGISTER === 'true',
            Users: allUsers as any,
            Groups: [],
          },
          SourceConfig: Object.entries(fileConfig.api_site || {}).map(
            ([key, site]) => ({
              key,
              name: site.name,
              api: site.api,
              detail: site.detail,
              from: 'config',
              disabled: false,
            })
          ),
          CustomCategories: (fileConfig.custom_category || []).map(
            (category) => ({
              name: category.name,
              type: category.type,
              query: category.query,
              from: 'config',
              disabled: false,
            })
          ),
          SubscriptionConfig: {},
          AdultAuthConfig: {
            cards: [],
            grants: [],
          },
        };
      }

      // 寫回數據庫（更新/創建）
      if (storage) {
        await storage.setAdminConfig(adminConfig);
      }

      // 更新緩存
      cachedConfig = adminConfig;
    } catch (err) {
      console.error('加載管理員配置失敗:', err);
    }
  } else {
    // 本地存儲直接使用文件配置
    cachedConfig = {
      ConfigFile: JSON.stringify(fileConfig),
      SiteConfig: {
        SiteName: process.env.SITE_NAME || 'MoonTV',
        Announcement:
          process.env.ANNOUNCEMENT ||
          '本網站僅提供影視信息搜索服務，所有內容均來自第三方網站。本站不存儲任何視頻資源，不對任何內容的準確性、合法性、完整性負責。',
        SearchDownstreamMaxPage:
          Number(process.env.NEXT_PUBLIC_SEARCH_MAX_PAGE) || 5,
        SiteInterfaceCacheTime: fileConfig.cache_time || 7200,
        DoubanProxyType: process.env.NEXT_PUBLIC_DOUBAN_PROXY_TYPE || 'direct',
        DoubanProxy: process.env.NEXT_PUBLIC_DOUBAN_PROXY || '',
        DoubanImageProxyType:
          process.env.NEXT_PUBLIC_DOUBAN_IMAGE_PROXY_TYPE || 'server',
        DoubanImageProxy: process.env.NEXT_PUBLIC_DOUBAN_IMAGE_PROXY || '',
        DisableYellowFilter:
          hasAdultDefaultSources(fileConfig) ||
          process.env.NEXT_PUBLIC_DISABLE_YELLOW_FILTER === 'true',
        DanmakuApiBaseUrl: process.env.NEXT_PUBLIC_DANMU_API_BASE_URL || '',
        TVBoxEnabled: false,
        TVBoxPassword: '',
      },
      UserConfig: {
        AllowRegister: process.env.NEXT_PUBLIC_ENABLE_REGISTER === 'true',
        Users: [],
        Groups: [],
      },
      SourceConfig: Object.entries(fileConfig.api_site).map(([key, site]) => ({
        key,
        name: site.name,
        api: site.api,
        detail: site.detail,
        from: 'config',
        disabled: false,
      })),
      CustomCategories:
        fileConfig.custom_category?.map((category) => ({
          name: category.name,
          type: category.type,
          query: category.query,
          from: 'config',
          disabled: false,
        })) || [],
      SubscriptionConfig: {},
      AdultAuthConfig: {
        cards: [],
        grants: [],
      },
    } as AdminConfig;
  }
}

export async function getConfig(): Promise<AdminConfig> {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (process.env.DOCKER_ENV === 'true' || storageType === 'localstorage') {
    await initConfig();
    return cachedConfig;
  }

  // 非 docker 環境且 DB 存儲，直接讀 db 配置
  const storage = getStorage();
  let adminConfig: AdminConfig | null = null;
  if (storage && typeof (storage as any).getAdminConfig === 'function') {
    adminConfig = await (storage as any).getAdminConfig();
  }

  if (adminConfig) {
    let shouldPersistAdminConfig = false;

    // 確保 CustomCategories 被初始化
    if (!adminConfig.CustomCategories) {
      adminConfig.CustomCategories = [];
    }

    // 數據庫優先，環境變量僅在缺省時回退
    adminConfig.SiteConfig.SiteName =
      adminConfig.SiteConfig.SiteName ||
      process.env.NEXT_PUBLIC_SITE_NAME ||
      'MoonTV';
    adminConfig.SiteConfig.Announcement =
      adminConfig.SiteConfig.Announcement ||
      process.env.ANNOUNCEMENT ||
      '本網站僅提供影視信息搜索服務，所有內容均來自第三方網站。本站不存儲任何視頻資源，不對任何內容的準確性、合法性、完整性負責。';
    adminConfig.UserConfig.AllowRegister =
      typeof adminConfig.UserConfig.AllowRegister === 'boolean'
        ? adminConfig.UserConfig.AllowRegister
        : process.env.NEXT_PUBLIC_ENABLE_REGISTER === 'true';
    adminConfig.SiteConfig.DoubanProxyType =
      adminConfig.SiteConfig.DoubanProxyType ||
      process.env.NEXT_PUBLIC_DOUBAN_PROXY_TYPE ||
      'direct';
    adminConfig.SiteConfig.DoubanProxy =
      adminConfig.SiteConfig.DoubanProxy ||
      process.env.NEXT_PUBLIC_DOUBAN_PROXY ||
      '';
    adminConfig.SiteConfig.DoubanImageProxyType =
      adminConfig.SiteConfig.DoubanImageProxyType ||
      process.env.NEXT_PUBLIC_DOUBAN_IMAGE_PROXY_TYPE ||
      'server';
    adminConfig.SiteConfig.DoubanImageProxy =
      adminConfig.SiteConfig.DoubanImageProxy ||
      process.env.NEXT_PUBLIC_DOUBAN_IMAGE_PROXY ||
      '';
    adminConfig.SiteConfig.DisableYellowFilter =
      typeof adminConfig.SiteConfig.DisableYellowFilter === 'boolean'
        ? adminConfig.SiteConfig.DisableYellowFilter
        : process.env.NEXT_PUBLIC_DISABLE_YELLOW_FILTER === 'true';

    // 彈幕接口配置：數據庫優先，其次環境變量，最後使用默認值
    adminConfig.SiteConfig.DanmakuApiBaseUrl =
      adminConfig.SiteConfig.DanmakuApiBaseUrl ||
      process.env.NEXT_PUBLIC_DANMU_API_BASE_URL ||
      '';
    // TVBox 開關與密碼默認值
    const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
    if (storageType === 'localstorage') {
      const raw = process.env.TVBOX_ENABLED;
      adminConfig.SiteConfig.TVBoxEnabled =
        raw == null ? true : String(raw).toLowerCase() === 'true';
      adminConfig.SiteConfig.TVBoxPassword = process.env.PASSWORD || '';
    } else {
      adminConfig.SiteConfig.TVBoxEnabled =
        typeof adminConfig.SiteConfig.TVBoxEnabled === 'boolean'
          ? adminConfig.SiteConfig.TVBoxEnabled
          : false;
      adminConfig.SiteConfig.TVBoxPassword =
        typeof adminConfig.SiteConfig.TVBoxPassword === 'string'
          ? adminConfig.SiteConfig.TVBoxPassword
          : '';
    }

    fileConfig = parseConfigFileStruct(adminConfig.ConfigFile, true);
    const mergedConfig = mergeRuntimeDefaultApiSites(fileConfig);
    fileConfig = mergedConfig.config;
    if (mergedConfig.changed) {
      adminConfig.ConfigFile = JSON.stringify(fileConfig);
      shouldPersistAdminConfig = true;
    }
    if (enableAdultSourceAccess(adminConfig, fileConfig)) {
      shouldPersistAdminConfig = true;
    }

    // 合並文件中的源信息
    const apiSiteEntries = Object.entries(fileConfig.api_site || []);
    const sourceConfigMap = new Map(
      (adminConfig.SourceConfig || []).map((s) => [s.key, s])
    );

    apiSiteEntries.forEach(([key, site]) => {
      const existingSource = sourceConfigMap.get(key);
      if (existingSource) {
        // 如果已存在，只覆蓋 name、api、detail 和 from
        existingSource.name = site.name;
        existingSource.api = site.api;
        existingSource.detail = site.detail;
        existingSource.from = 'config';
      } else {
        // 如果不存在，創建新條目
        shouldPersistAdminConfig = true;
        sourceConfigMap.set(key, {
          key,
          name: site.name,
          api: site.api,
          detail: site.detail,
          from: 'config',
          disabled: false,
        });
      }
    });

    // 檢查現有源是否在 fileConfig.api_site 中，如果不在則標記為 custom
    const apiSiteKeys = new Set(apiSiteEntries.map(([key]) => key));
    sourceConfigMap.forEach((source) => {
      if (!apiSiteKeys.has(source.key)) {
        source.from = 'custom';
      }
    });

    // 將 Map 轉換回數組
    adminConfig.SourceConfig = Array.from(sourceConfigMap.values());

    // 覆蓋 CustomCategories - 只覆蓋 from 為 config 的項
    const customCategories = fileConfig.custom_category || [];
    const customCategoriesMap = new Map(
      (adminConfig.CustomCategories || []).map((c) => [c.query + c.type, c])
    );

    customCategories.forEach((category) => {
      const key = category.query + category.type;
      const existingCategory = customCategoriesMap.get(key);
      if (existingCategory) {
        // 如果已存在，只覆蓋 from 為 config 的項
        if (existingCategory.from === 'config') {
          existingCategory.name = category.name;
          existingCategory.type = category.type;
          existingCategory.query = category.query;
          existingCategory.from = 'config';
          existingCategory.disabled = false;
        }
      } else {
        // 如果不存在，創建新條目
        customCategoriesMap.set(key, {
          name: category.name,
          type: category.type,
          query: category.query,
          from: 'config',
          disabled: false,
        });
      }
    });

    // 檢查現有分類是否在 fileConfig.custom_category 中，如果不在則標記為 custom
    const customCategoryKeys = new Set(
      customCategories.map((c) => c.query + c.type)
    );
    customCategoriesMap.forEach((category) => {
      if (!customCategoryKeys.has(category.query + category.type)) {
        category.from = 'custom';
      }
    });

    // 將 Map 轉換回數組
    adminConfig.CustomCategories = Array.from(customCategoriesMap.values());

    // 同步 cache_time 到 SiteConfig.SiteInterfaceCacheTime
    if (fileConfig.cache_time !== undefined) {
      adminConfig.SiteConfig.SiteInterfaceCacheTime = fileConfig.cache_time;
    }

    // 初始化分組結構（若缺失）
    if (!adminConfig.UserConfig) {
      adminConfig.UserConfig = {
        AllowRegister: false,
        Users: [],
        Groups: [],
      } as any;
    }
    if (
      !('Groups' in adminConfig.UserConfig) ||
      !adminConfig.UserConfig.Groups
    ) {
      (adminConfig.UserConfig as any).Groups = [];
    }

    const ownerUser = process.env.USERNAME || '';
    // 檢查配置中的站長用戶是否和 USERNAME 匹配，如果不匹配則降級為普通用戶
    let containOwner = false;
    adminConfig.UserConfig.Users.forEach((user) => {
      if (user.username !== ownerUser && user.role === 'owner') {
        user.role = 'user';
      }
      if (user.username === ownerUser) {
        containOwner = true;
        user.role = 'owner';
      }
    });

    // 如果不在則添加
    if (!containOwner) {
      adminConfig.UserConfig.Users.unshift({
        username: ownerUser,
        role: 'owner',
      });
    }
    if (shouldPersistAdminConfig && storage) {
      await storage.setAdminConfig(adminConfig);
    }
    cachedConfig = adminConfig;
  } else {
    await initConfig();
  }

  return cachedConfig;
}

export function configSelfCheck(adminConfig: AdminConfig): AdminConfig {
  // 確保必要的屬性存在和初始化
  if (!adminConfig.UserConfig) {
    adminConfig.UserConfig = { AllowRegister: false, Users: [] };
  }
  if (
    !adminConfig.UserConfig.Users ||
    !Array.isArray(adminConfig.UserConfig.Users)
  ) {
    adminConfig.UserConfig.Users = [];
  }
  if (!adminConfig.SourceConfig || !Array.isArray(adminConfig.SourceConfig)) {
    adminConfig.SourceConfig = [];
  }
  if (
    !adminConfig.CustomCategories ||
    !Array.isArray(adminConfig.CustomCategories)
  ) {
    adminConfig.CustomCategories = [];
  }
  if (!adminConfig.SubscriptionConfig) {
    adminConfig.SubscriptionConfig = {};
  }
  ensureAdultAuthConfig(adminConfig);

  // 站長變更自檢
  const ownerUser = process.env.USERNAME;
  const originalOwner = adminConfig.UserConfig.Users.find(
    (u) => u.username === ownerUser
  );

  // 去重
  const seenUsernames = new Set<string>();
  adminConfig.UserConfig.Users = adminConfig.UserConfig.Users.filter((user) => {
    if (seenUsernames.has(user.username)) {
      return false;
    }
    seenUsernames.add(user.username);
    return true;
  });
  // 過濾站長
  adminConfig.UserConfig.Users = adminConfig.UserConfig.Users.filter(
    (user) => user.username !== ownerUser
  );
  // 其他用戶不得擁有 owner 權限
  adminConfig.UserConfig.Users.forEach((user) => {
    if (user.role === 'owner') {
      user.role = 'user';
    }
  });
  // 重新添加回站長
  adminConfig.UserConfig.Users.unshift({
    username: ownerUser!,
    role: 'owner',
    banned: originalOwner?.banned ?? false,
    group: originalOwner?.group,
    lastOnline: originalOwner?.lastOnline,
  });

  // 採集源去重
  const seenSourceKeys = new Set<string>();
  adminConfig.SourceConfig = adminConfig.SourceConfig.filter((source) => {
    if (seenSourceKeys.has(source.key)) {
      return false;
    }
    seenSourceKeys.add(source.key);
    return true;
  });

  // 自定義分類去重
  const seenCustomCategoryKeys = new Set<string>();
  adminConfig.CustomCategories = adminConfig.CustomCategories.filter(
    (category) => {
      if (seenCustomCategoryKeys.has(category.query + category.type)) {
        return false;
      }
      seenCustomCategoryKeys.add(category.query + category.type);
      return true;
    }
  );

  return adminConfig;
}

export async function resetConfig() {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  const storage = getStorage();
  // 獲取所有用戶名，用於補全 Users
  let userNames: string[] = [];
  if (storage && typeof (storage as any).getAllUsers === 'function') {
    try {
      userNames = await (storage as any).getAllUsers();
    } catch (e) {
      console.error('獲取用戶列表失敗:', e);
    }
  }

  if (process.env.DOCKER_ENV === 'true') {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const _require = eval('require') as NodeJS.Require;
    const fs = _require('fs') as typeof import('fs');
    const path = _require('path') as typeof import('path');

    const configPath = path.join(process.cwd(), 'config.json');
    const raw = fs.readFileSync(configPath, 'utf-8');
    fileConfig = JSON.parse(raw) as ConfigFileStruct;
    console.log('load dynamic config success');
  } else {
    // 默認使用編譯時生成的配置
    fileConfig = runtimeConfig as unknown as ConfigFileStruct;
  }

  const apiSiteEntries = Object.entries(fileConfig.api_site);
  const customCategories = fileConfig.custom_category || [];
  let allUsers = userNames.map((uname) => ({
    username: uname,
    role: 'user',
  }));
  const ownerUser = process.env.USERNAME;
  if (ownerUser) {
    allUsers = allUsers.filter((u) => u.username !== ownerUser);
    allUsers.unshift({
      username: ownerUser,
      role: 'owner',
    });
  }
  const adminConfig = {
    ConfigFile: JSON.stringify(fileConfig),
    SiteConfig: {
      SiteName: process.env.SITE_NAME || 'MoonTV',
      Announcement:
        process.env.ANNOUNCEMENT ||
        '本網站僅提供影視信息搜索服務，所有內容均來自第三方網站。本站不存儲任何視頻資源，不對任何內容的準確性、合法性、完整性負責。',
      SearchDownstreamMaxPage:
        Number(process.env.NEXT_PUBLIC_SEARCH_MAX_PAGE) || 5,
      SiteInterfaceCacheTime: fileConfig.cache_time || 7200,
      DoubanProxyType: process.env.NEXT_PUBLIC_DOUBAN_PROXY_TYPE || 'direct',
      DoubanProxy: process.env.NEXT_PUBLIC_DOUBAN_PROXY || '',
      DoubanImageProxyType:
        process.env.NEXT_PUBLIC_DOUBAN_IMAGE_PROXY_TYPE || 'server',
      DoubanImageProxy: process.env.NEXT_PUBLIC_DOUBAN_IMAGE_PROXY || '',
      DisableYellowFilter:
        hasAdultDefaultSources(fileConfig) ||
        process.env.NEXT_PUBLIC_DISABLE_YELLOW_FILTER === 'true',
      DanmakuApiBaseUrl: process.env.NEXT_PUBLIC_DANMU_API_BASE_URL || '',
      TVBoxEnabled: false,
      TVBoxPassword: '',
    },
    UserConfig: {
      AllowRegister: process.env.NEXT_PUBLIC_ENABLE_REGISTER === 'true',
      Users: allUsers as any,
    },
    SourceConfig: apiSiteEntries.map(([key, site]) => ({
      key,
      name: site.name,
      api: site.api,
      detail: site.detail,
      from: 'config',
      disabled: false,
    })),
    CustomCategories:
      storageType === 'redis'
        ? customCategories?.map((category) => ({
            name: category.name,
            type: category.type,
            query: category.query,
            from: 'config',
            disabled: false,
          })) || []
        : [],
    SubscriptionConfig: {},
    AdultAuthConfig: {
      cards: [],
      grants: [],
    },
  } as AdminConfig;

  if (storage && typeof (storage as any).setAdminConfig === 'function') {
    await (storage as any).setAdminConfig(adminConfig);
  }
  if (cachedConfig == null) {
    // serverless 環境，直接使用 adminConfig
    cachedConfig = adminConfig;
  }
  cachedConfig.ConfigFile = adminConfig.ConfigFile;
  cachedConfig.SiteConfig = adminConfig.SiteConfig;
  cachedConfig.UserConfig = adminConfig.UserConfig;
  cachedConfig.SourceConfig = adminConfig.SourceConfig;
  cachedConfig.CustomCategories = adminConfig.CustomCategories || [];
  cachedConfig.SubscriptionConfig = adminConfig.SubscriptionConfig;
  cachedConfig.AdultAuthConfig = adminConfig.AdultAuthConfig;
}

export async function getCacheTime(): Promise<number> {
  const config = await getConfig();
  return config.SiteConfig.SiteInterfaceCacheTime || 7200;
}

export async function getAvailableApiSites(
  username?: string
): Promise<ApiSite[]> {
  const config = await getConfig();
  const all = config.SourceConfig.filter((s) => !s.disabled);
  if (
    !username ||
    !config.UserConfig?.Groups ||
    config.UserConfig.Groups.length === 0
  ) {
    return all.map((s) => ({
      key: s.key,
      name: s.name,
      api: s.api,
      detail: s.detail,
    }));
  }
  const user = config.UserConfig.Users.find((u) => u.username === username);
  const groupName = user?.group;
  if (!groupName) {
    return all.map((s) => ({
      key: s.key,
      name: s.name,
      api: s.api,
      detail: s.detail,
    }));
  }
  const group = config.UserConfig.Groups.find((g) => g.name === groupName);
  if (!group) {
    return all.map((s) => ({
      key: s.key,
      name: s.name,
      api: s.api,
      detail: s.detail,
    }));
  }
  const allowed = new Set(group.sourceKeys);
  const filtered = all.filter((s) => allowed.has(s.key));
  return filtered.map((s) => ({
    key: s.key,
    name: s.name,
    api: s.api,
    detail: s.detail,
  }));
}

export async function setCachedConfig(config: AdminConfig) {
  cachedConfig = config;
}
