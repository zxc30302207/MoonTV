import { AdminConfig } from './admin.types';
import {
  ConfigFileStruct,
  getAvailableApiSites,
  mergeRuntimeDefaultApiSites,
  refineConfig,
  setCachedConfig,
} from './config';
import runtimeConfig from './runtime';

function createAdminConfig(configFile: ConfigFileStruct): AdminConfig {
  return {
    ConfigFile: JSON.stringify(configFile),
    SiteConfig: {
      SiteName: 'MoonTV',
      Announcement: '',
      SearchDownstreamMaxPage: 5,
      SiteInterfaceCacheTime: 7200,
      DoubanProxyType: 'direct',
      DoubanProxy: '',
      DoubanImageProxyType: 'server',
      DoubanImageProxy: '',
      DisableYellowFilter: false,
    },
    UserConfig: {
      AllowRegister: false,
      Users: [],
      Groups: [],
    },
    SourceConfig: [
      {
        key: 'ruyi',
        name: 'Custom Movie Source',
        api: 'https://custom.example/api.php/provide/vod',
        from: 'config',
        disabled: true,
      },
    ],
    CustomCategories: [],
    SubscriptionConfig: {},
    AdultAuthConfig: {
      cards: [],
      grants: [],
    },
  };
}

describe('config runtime defaults', () => {
  it('adds maoyan without changing the existing fourteen sources or saved disabled switches', () => {
    const api_site = {
      ...runtimeConfig.api_site,
    } as unknown as ConfigFileStruct['api_site'];
    delete api_site.maoyan;
    expect(Object.keys(api_site)).toHaveLength(14);
    const config = createAdminConfig({ api_site });
    config.SourceConfig = Object.entries(api_site).map(([key, site]) => ({
      key,
      name: site.name,
      api: site.api,
      detail: site.detail,
      from: 'config',
      disabled: key === 'ffzynew',
    }));
    const before = config.SourceConfig.map((source) => ({ ...source }));
    const refined = refineConfig(config);
    const saved = JSON.parse(refined.ConfigFile) as ConfigFileStruct;
    expect(Object.keys(saved.api_site)).toHaveLength(15);
    expect(refined.SourceConfig).toHaveLength(15);
    before.forEach((source) => {
      expect(
        refined.SourceConfig.find((item) => item.key === source.key)
      ).toEqual(source);
      expect(saved.api_site[source.key]).toEqual(api_site[source.key]);
    });
    expect(
      refined.SourceConfig.find((source) => source.key === 'maoyan')
    ).toEqual({
      key: 'maoyan',
      name: '貓眼資源',
      api: 'https://api.maoyanapi.top/api.php/provide/vod',
      detail: '',
      from: 'config',
      disabled: false,
    });
    expect(refineConfig(refined).SourceConfig).toHaveLength(15);
  });

  it('removes the nine user-selected sources from saved config and preserves other switches', () => {
    const removed = [
      'lzi',
      'dyttzy',
      'zuid',
      'tyyszy',
      'bfzy',
      'yinghua',
      'ikun',
      'aivin',
      'ffzy',
    ];
    const api_site: ConfigFileStruct['api_site'] = {};
    [...removed, 'ffzynew', 'custom-kept'].forEach((key) => {
      api_site[key] = { key, name: key, api: `https://${key}.example/api` };
    });
    const config = createAdminConfig({ api_site });
    config.SourceConfig = Object.entries(api_site).map(([key, site]) => ({
      key,
      name: site.name,
      api: site.api,
      from: 'config',
      disabled: key === 'ffzynew',
    }));
    const refined = refineConfig(config);
    const saved = JSON.parse(refined.ConfigFile) as ConfigFileStruct;
    removed.forEach((key) => {
      expect(saved.api_site[key]).toBeUndefined();
      expect(refined.SourceConfig.some((source) => source.key === key)).toBe(
        false
      );
    });
    expect(saved.api_site.ffzynew).toEqual(api_site.ffzynew);
    expect(saved.api_site['custom-kept']).toEqual(api_site['custom-kept']);
    expect(
      refined.SourceConfig.find((source) => source.key === 'ffzynew')?.disabled
    ).toBe(true);
    expect(
      refined.SourceConfig.find((source) => source.key === 'custom-kept')
        ?.disabled
    ).toBe(false);
    expect(refineConfig(refined)).toEqual(refined);
  });

  it('adds missing runtime sources without overwriting saved api_site keys', () => {
    const savedConfig: ConfigFileStruct = {
      cache_time: 111,
      api_site: {
        ruyi: {
          key: 'ruyi',
          name: 'Custom Movie Source',
          api: 'https://custom.example/api.php/provide/vod',
        },
      },
    };

    const result = mergeRuntimeDefaultApiSites(savedConfig);

    expect(result.changed).toBe(true);
    expect(result.config.cache_time).toBe(111);
    expect(result.config.api_site.ruyi.api).toBe(
      'https://custom.example/api.php/provide/vod'
    );
    expect(result.config.api_site.ffzynew).toBeDefined();
    expect(result.config.api_site.ckzy).toBeUndefined();
  });

  it('refines old DB config with missing sources and preserves saved switches', () => {
    const adminConfig = createAdminConfig({
      api_site: {
        ruyi: {
          key: 'ruyi',
          name: 'Custom Movie Source',
          api: 'https://custom.example/api.php/provide/vod',
        },
      },
    });

    const refined = refineConfig(adminConfig);
    const ruyi = refined.SourceConfig.find((source) => source.key === 'ruyi');
    const yutu = refined.SourceConfig.find((source) => source.key === 'yutu');
    const configFile = JSON.parse(refined.ConfigFile) as ConfigFileStruct;

    expect(ruyi?.disabled).toBe(true);
    expect(ruyi?.api).toBe('https://custom.example/api.php/provide/vod');
    expect(yutu).toEqual(
      expect.objectContaining({
        key: 'yutu',
        from: 'config',
        disabled: false,
      })
    );
    expect(configFile.api_site.ckzy).toBeUndefined();
    expect(refined.SiteConfig.DisableYellowFilter).toBe(false);
  });

  it('preserves enabled adult access when it was saved explicitly', () => {
    const adminConfig = createAdminConfig({ api_site: {} });
    adminConfig.SiteConfig.DisableYellowFilter = true;

    const refined = refineConfig(adminConfig);

    expect(refined.SiteConfig.DisableYellowFilter).toBe(true);
  });

  it('removes confirmed dead sources when found in saved config', () => {
    const adminConfig = createAdminConfig({
      api_site: {
        wwzy: {
          key: 'wwzy',
          name: 'Audited Failing Source',
          api: 'https://wwzy.tv/api.php/provide/vod',
        },
      },
    });
    adminConfig.SourceConfig = [
      {
        key: 'wwzy',
        name: 'Audited Failing Source',
        api: 'https://wwzy.tv/api.php/provide/vod',
        from: 'custom',
        disabled: false,
      },
    ];

    const refined = refineConfig(adminConfig);

    const configFile = JSON.parse(refined.ConfigFile) as ConfigFileStruct;

    expect(refined.SourceConfig.some((source) => source.key === 'wwzy')).toBe(
      false
    );
    expect(configFile.api_site.wwzy).toBeUndefined();
  });

  it('repairs empty DB config files by seeding runtime sources', () => {
    const adminConfig = createAdminConfig({ api_site: {} });
    adminConfig.ConfigFile = '';

    const refined = refineConfig(adminConfig);
    const configFile = JSON.parse(refined.ConfigFile) as ConfigFileStruct;

    expect(Object.keys(configFile.api_site).length).toBe(15);
    expect(refined.SourceConfig.some((source) => source.key === 'ckzy')).toBe(
      false
    );
    expect(
      refined.SourceConfig.some((source) => source.key === 'yinghua')
    ).toBe(false);
    expect(refined.SiteConfig.DisableYellowFilter).toBe(false);
  });
});

describe('adult source visibility', () => {
  const originalStorageType = process.env.NEXT_PUBLIC_STORAGE_TYPE;
  const originalOwner = process.env.USERNAME;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'localstorage';
    process.env.USERNAME = 'owner';
  });

  afterEach(() => {
    if (originalStorageType === undefined) {
      delete process.env.NEXT_PUBLIC_STORAGE_TYPE;
    } else {
      process.env.NEXT_PUBLIC_STORAGE_TYPE = originalStorageType;
    }
    if (originalOwner === undefined) {
      delete process.env.USERNAME;
    } else {
      process.env.USERNAME = originalOwner;
    }
  });

  it('hides adult sources when no user is authorized', async () => {
    await setCachedConfig(createSourceVisibilityConfig(true));

    const sources = await getAvailableApiSites();

    expect(sources.map((source) => source.key)).toEqual(['normal']);
  });

  it('hides adult sources from users without adult grants', async () => {
    await setCachedConfig(createSourceVisibilityConfig(true));

    const sources = await getAvailableApiSites('alice');

    expect(sources.map((source) => source.key)).toEqual(['normal']);
  });

  it('allows adult sources for owner and admin users when adult mode is enabled', async () => {
    await setCachedConfig(createSourceVisibilityConfig(true));

    await expect(getAvailableApiSites('owner')).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'yutu' })])
    );
    await expect(getAvailableApiSites('admin')).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'yutu' })])
    );
  });

  it('allows adult sources for users with a valid adult grant', async () => {
    const config = createSourceVisibilityConfig(true);
    config.AdultAuthConfig = {
      cards: [],
      grants: [
        {
          username: 'alice',
          cardCode: 'ADULT-TEST',
          grantedAt: 1,
          grantedBy: 'admin',
          expiresAt: Date.now() + 60_000,
        },
      ],
    };
    await setCachedConfig(config);

    const sources = await getAvailableApiSites('alice');

    expect(sources.map((source) => source.key)).toEqual(['normal', 'yutu']);
  });

  it('keeps adult sources hidden when adult mode is disabled', async () => {
    await setCachedConfig(createSourceVisibilityConfig(false));

    const sources = await getAvailableApiSites('owner');

    expect(sources.map((source) => source.key)).toEqual(['normal']);
  });

  it('hides removed sources from available sites', async () => {
    const config = createSourceVisibilityConfig(false);
    config.SourceConfig.push({
      key: 'wwzy',
      name: 'Audited Failing Source',
      api: 'https://wwzy.tv/api.php/provide/vod',
      from: 'config',
      disabled: false,
    });
    await setCachedConfig(config);

    const sources = await getAvailableApiSites('owner');

    expect(sources.map((source) => source.key)).toEqual(['normal']);
  });
});

function createSourceVisibilityConfig(adultModeEnabled: boolean): AdminConfig {
  const config = createAdminConfig({ api_site: {} });
  config.SiteConfig.DisableYellowFilter = adultModeEnabled;
  config.UserConfig.Users = [
    { username: 'owner', role: 'owner' },
    { username: 'admin', role: 'admin' },
    { username: 'alice', role: 'user' },
  ];
  config.SourceConfig = [
    {
      key: 'normal',
      name: 'Normal Source',
      api: 'https://normal.example/api.php/provide/vod',
      from: 'config',
      disabled: false,
    },
    {
      key: 'yutu',
      name: 'Adult Source',
      api: 'https://adult.example/api.php/provide/vod',
      from: 'config',
      disabled: false,
    },
  ];
  config.AdultAuthConfig = {
    cards: [],
    grants: [],
  };
  return config;
}
