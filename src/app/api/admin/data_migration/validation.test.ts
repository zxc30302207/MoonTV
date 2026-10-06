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
