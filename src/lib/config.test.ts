import { AdminConfig } from './admin.types';
import {
  ConfigFileStruct,
  getAvailableApiSites,
  mergeRuntimeDefaultApiSites,
  refineConfig,
  setCachedConfig,
} from './config';

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
        key: 'dyttzy',
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
  it('adds missing runtime sources without overwriting saved api_site keys', () => {
    const savedConfig: ConfigFileStruct = {
      cache_time: 111,
      api_site: {
        dyttzy: {
          key: 'dyttzy',
          name: 'Custom Movie Source',
          api: 'https://custom.example/api.php/provide/vod',
        },
      },
    };

    const result = mergeRuntimeDefaultApiSites(savedConfig);

    expect(result.changed).toBe(true);
    expect(result.config.cache_time).toBe(111);
    expect(result.config.api_site.dyttzy.api).toBe(
      'https://custom.example/api.php/provide/vod'
    );
    expect(result.config.api_site.ffzynew).toBeDefined();
    expect(result.config.api_site.ckzy).toBeDefined();
  });

  it('refines old DB config with missing sources and preserves saved switches', () => {
    const adminConfig = createAdminConfig({
      api_site: {
        dyttzy: {
          key: 'dyttzy',
          name: 'Custom Movie Source',
          api: 'https://custom.example/api.php/provide/vod',
        },
      },
    });

    const refined = refineConfig(adminConfig);
    const dyttzy = refined.SourceConfig.find(
      (source) => source.key === 'dyttzy'
    );
    const ckzy = refined.SourceConfig.find((source) => source.key === 'ckzy');
    const configFile = JSON.parse(refined.ConfigFile) as ConfigFileStruct;

    expect(dyttzy?.disabled).toBe(true);
    expect(dyttzy?.api).toBe('https://custom.example/api.php/provide/vod');
    expect(ckzy).toEqual(
      expect.objectContaining({
        key: 'ckzy',
        from: 'config',
        disabled: false,
      })
    );
    expect(configFile.api_site.ckzy).toBeDefined();
    expect(refined.SiteConfig.DisableYellowFilter).toBe(false);
  });

  it('preserves enabled adult access when it was saved explicitly', () => {
    const adminConfig = createAdminConfig({ api_site: {} });
    adminConfig.SiteConfig.DisableYellowFilter = true;

    const refined = refineConfig(adminConfig);

    expect(refined.SiteConfig.DisableYellowFilter).toBe(true);
  });

  it('marks audited failing sources as disabled when found in saved config', () => {
    const adminConfig = createAdminConfig({
      api_site: {
        dbzy: {
          key: 'dbzy',
          name: 'Retired Source',
          api: 'https://dbzy.tv/api.php/provide/vod',
        },
      },
    });
    adminConfig.SourceConfig = [
      {
        key: 'dbzy',
        name: 'Retired Source',
        api: 'https://dbzy.tv/api.php/provide/vod',
        from: 'custom',
        disabled: false,
      },
    ];

    const refined = refineConfig(adminConfig);

    expect(
      refined.SourceConfig.find((source) => source.key === 'dbzy')
    ).toEqual(
      expect.objectContaining({
        disabled: true,
      })
    );
  });

  it('repairs empty DB config files by seeding runtime sources', () => {
    const adminConfig = createAdminConfig({ api_site: {} });
    adminConfig.ConfigFile = '';

    const refined = refineConfig(adminConfig);
    const configFile = JSON.parse(refined.ConfigFile) as ConfigFileStruct;

    expect(Object.keys(configFile.api_site).length).toBeGreaterThanOrEqual(31);
    expect(refined.SourceConfig.some((source) => source.key === 'ckzy')).toBe(
      true
    );
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
      expect.arrayContaining([expect.objectContaining({ key: 'ckzy' })])
    );
    await expect(getAvailableApiSites('admin')).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'ckzy' })])
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

    expect(sources.map((source) => source.key)).toEqual(['normal', 'ckzy']);
  });

  it('keeps adult sources hidden when adult mode is disabled', async () => {
    await setCachedConfig(createSourceVisibilityConfig(false));

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
      key: 'ckzy',
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
