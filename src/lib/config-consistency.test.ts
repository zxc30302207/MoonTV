import type { AdminConfig } from './admin.types';
import { markConfigSnapshot } from './config-snapshot';

let current: AdminConfig;
const save = jest.fn();
jest.mock('./db', () => ({
  getStorage: () => ({
    getAdminConfig: async () =>
      markConfigSnapshot(
        JSON.parse(JSON.stringify(current)),
        JSON.stringify(current)
      ),
    setAdminConfig: save,
    getAllUsers: async () => [],
  }),
}));
import { getConfig } from './config';

beforeEach(() => {
  process.env.NEXT_PUBLIC_STORAGE_TYPE = 'supabase';
  process.env.DOCKER_ENV = 'true';
  process.env.USERNAME = 'owner';
  jest.clearAllMocks();
  current = {
    ConfigFile: JSON.stringify({
      api_site: {},
      custom_category: [{ name: 'Saved', query: 'query', type: 'tv' }],
    }),
    SiteConfig: { SiteName: 'Old', DisableYellowFilter: false },
    UserConfig: {
      AllowRegister: false,
      Users: [{ username: 'owner', role: 'owner' }],
    },
    SourceConfig: [],
    CustomCategories: [
      {
        name: 'Saved',
        query: 'query',
        type: 'tv',
        from: 'config',
        disabled: true,
      },
    ],
    SubscriptionConfig: {},
  } as unknown as AdminConfig;
});
test('docker DB reads retain category disabled flags and observe another instance changes', async () => {
  const first = await getConfig();
  expect(first.CustomCategories[0].disabled).toBe(true);
  current.SiteConfig.SiteName = 'New';
  const second = await getConfig();
  expect(second.SiteConfig.SiteName).toBe('New');
  first.UserConfig.Users[0].banned = true;
  expect(second.UserConfig.Users[0].banned).not.toBe(true);
});
