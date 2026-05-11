import { AdminConfig } from './admin.types';
import {
  ConfigFileStruct,
  mergeRuntimeDefaultApiSites,
  refineConfig,
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

  it('refines old DB config with missing sources and preserves disabled state', () => {
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
    expect(refined.SiteConfig.DisableYellowFilter).toBe(true);
  });

  it('repairs empty DB config files by seeding runtime sources', () => {
    const adminConfig = createAdminConfig({ api_site: {} });
    adminConfig.ConfigFile = '';

    const refined = refineConfig(adminConfig);
    const configFile = JSON.parse(refined.ConfigFile) as ConfigFileStruct;

    expect(Object.keys(configFile.api_site).length).toBeGreaterThanOrEqual(39);
    expect(refined.SourceConfig.some((source) => source.key === 'ckzy')).toBe(
      true
    );
    expect(refined.SiteConfig.DisableYellowFilter).toBe(true);
  });
});
