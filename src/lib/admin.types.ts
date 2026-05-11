export interface AdminConfig {
  ConfigFile: string;
  SiteConfig: {
    SiteName: string;
    Announcement: string;
    SearchDownstreamMaxPage: number;
    SiteInterfaceCacheTime: number;
    DoubanProxyType: string;
    DoubanProxy: string;
    DoubanImageProxyType: string;
    DoubanImageProxy: string;
    DisableYellowFilter: boolean;
    // 彈幕接口配置
    DanmakuApiBaseUrl?: string;
    // TVBox 接口開關與訪問密碼
    TVBoxEnabled?: boolean;
    TVBoxPassword?: string;
  };
  UserConfig: {
    AllowRegister: boolean;
    Users: {
      username: string;
      role: 'user' | 'admin' | 'owner';
      banned?: boolean;
      group?: string;
      lastOnline?: number;
    }[];
    Groups?: {
      name: string;
      sourceKeys: string[];
    }[];
  };
  SourceConfig: {
    key: string;
    name: string;
    api: string;
    detail?: string;
    from: 'config' | 'custom';
    disabled?: boolean;
  }[];
  CustomCategories: {
    name?: string;
    type: 'movie' | 'tv';
    query: string;
    from: 'config' | 'custom';
    disabled?: boolean;
  }[];
  SubscriptionConfig?: {
    subscriptionUrl?: string;
    autoUpdate?: boolean;
    updateInterval?: number; // seconds
    lastUpdated?: number; // timestamp in seconds
    importMode?: 'overwrite' | 'merge';
  };
  AdultAuthConfig?: {
    cards: AdultAuthCard[];
    grants: AdultAuthGrant[];
  };
}

export interface AdminConfigResult {
  Role: 'owner' | 'admin';
  Config: AdminConfig;
}

export type AdultAuthDuration = 'day' | 'week' | 'month' | 'year' | 'forever';

export interface AdultAuthCard {
  code: string;
  duration: AdultAuthDuration;
  createdAt: number;
  createdBy: string;
  disabled?: boolean;
  usedBy?: string;
  usedAt?: number;
}

export interface AdultAuthGrant {
  username: string;
  cardCode: string;
  grantedAt: number;
  grantedBy: string;
  expiresAt: number | null;
}
