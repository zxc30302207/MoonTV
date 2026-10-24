import { validateBackup } from './validation';

function backup() {
  return {
    data: {
      adminConfig: {
        ConfigFile: '{}',
        SiteConfig: {
          SiteName: 'Custom',
          DisableYellowFilter: true,
          DanmakuApiBaseUrl: 'https://example.test/danmaku',
        },
        UserConfig: {
          AllowRegister: false,
          Users: [{ username: 'alice', role: 'user' }],
        },
        SourceConfig: [],
        CustomCategories: [],
        AdultAuthConfig: {
          cards: [],
          grants: [{ username: 'alice', expiresAt: null }],
        },
      },
      userData: {
        alice: {
          followings: {
            'normal+1': {
              title: 'Show',
              source_name: 'Normal',
              year: '2026',
              cover: '',
              total_episodes: 10,
              watched_episodes: 2,
              save_time: 1,
              search_title: 'Show',
            },
          },
          todayUpdated: { date: '2026-10-06', items: [] },
          searchHistory: ['new', 'old'],
        },
      },
    },
  };
}

describe('backup preflight validation', () => {
  it('preserves custom settings, adult grants and new following categories', () => {
    const original = backup();
    expect(validateBackup(original)).toEqual(original);
  });

  it('rejects malformed records before destructive import can begin', () => {
    const value = backup();
    value.data.userData.alice.followings['normal+1'].watched_episodes = -1;
    expect(validateBackup(value)).toBeNull();
  });

  it('rejects invalid or non-normalized usernames', () => {
    const original = backup();
    for (const username of ['alice:other', ' alice ', 'Ａlice']) {
      expect(
        validateBackup({
          ...original,
          data: {
            ...original.data,
            userData: { [username]: original.data.userData.alice },
          },
        })
      ).toBeNull();
    }
  });

  it('accepts older backups with no following data', () => {
    const original = backup();
    expect(
      validateBackup({
        ...original,
        data: {
          ...original.data,
          userData: { alice: { searchHistory: ['old'] } },
        },
      })
    ).not.toBeNull();
  });
});

describe('backup schema compatibility', () => {
  it('round-trips every supported record category without changing values', () => {
    const original = backup();
    const media = {
      title: '節目',
      source_name: '來源',
      year: '2026',
      cover: 'https://example.test/poster',
      total_episodes: 12,
      save_time: 1234,
      search_title: '節目',
    };
    const value = {
      ...original,
      timestamp: '2026-10-24',
      serverVersion: '4.6.0',
      data: {
        ...original.data,
        userData: {
          alice: {
            ...original.data.userData.alice,
            password: 'encrypted-password',
            favorites: { 'normal+2': media },
            playRecords: {
              'normal+2': {
                ...media,
                index: 1,
                play_time: 1.5,
                total_time: 300,
              },
            },
            skipConfigs: {
              'normal+2': { enable: true, intro_time: 10, outro_time: -30 },
            },
            todayUpdated: {
              date: '2026-10-24',
              items: [
                {
                  source: 'normal',
                  id: '2',
                  title: '節目',
                  poster: '',
                  episodes: 12,
                  watchedEpisodes: 2,
                  unwatchedEpisodes: 10,
                  source_name: '來源',
                  year: '2026',
                  save_time: 1234,
                  oldEpisodes: 10,
                  newEpisodes: 12,
                },
              ],
            },
          },
        },
      },
    };
    expect(validateBackup(value)).toEqual(value);
  });

  it.each([NaN, Infinity, -Infinity, -1, '2', null])(
    'rejects invalid record counts: %s',
    (count) => {
      const value = backup();
      const record = value.data.userData.alice.followings['normal+1'];
      expect(
        validateBackup({
          ...value,
          data: {
            ...value.data,
            userData: {
              alice: {
                followings: {
                  'normal+1': { ...record, watched_episodes: count },
                },
              },
            },
          },
        })
      ).toBeNull();
    }
  );

  it.each(['normal', '+1', 'normal+', 'normal+1+2'])(
    'rejects invalid source/id keys: %s',
    (key) => {
      const value = backup();
      expect(
        validateBackup({
          ...value,
          data: {
            ...value.data,
            userData: {
              alice: {
                followings: {
                  [key]: value.data.userData.alice.followings['normal+1'],
                },
              },
            },
          },
        })
      ).toBeNull();
    }
  );

  it.each(['invalid JSON', 'null', '[]', 'true'])(
    'rejects invalid configuration JSON: %s',
    (ConfigFile) => {
      const value = backup();
      value.data.adminConfig.ConfigFile = ConfigFile;
      expect(validateBackup(value)).toBeNull();
    }
  );

  it('preserves nullable legacy fields and permits empty user data', () => {
    const value = backup();
    for (const userData of [
      {},
      { alice: { password: null, todayUpdated: null } },
    ]) {
      const input = { ...value, data: { ...value.data, userData } };
      expect(validateBackup(input)).toEqual(input);
    }
  });
});
