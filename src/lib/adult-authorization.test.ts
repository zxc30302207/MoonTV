import { AdminConfig } from './admin.types';
import {
  createAdultAuthCard,
  getAdultAuthorizationStatus,
  grantAdultAuthToUser,
  redeemAdultAuthCard,
} from './adult-authorization';

describe('adult authorization cards', () => {
  const originalOwner = process.env.USERNAME;

  afterEach(() => {
    process.env.USERNAME = originalOwner;
  });

  it('creates and redeems a limited card for a user', () => {
    const config = createConfig();
    const card = createAdultAuthCard(config, 'week', 'admin', 1_000);
    const grant = redeemAdultAuthCard(config, 'alice', card.code, 2_000);

    expect(card.usedBy).toBe('alice');
    expect(grant).toMatchObject({
      username: 'alice',
      cardCode: card.code,
      grantedBy: 'admin',
      expiresAt: 2_000 + 7 * 24 * 60 * 60 * 1000,
    });
    expect(getAdultAuthorizationStatus(config, 'alice', 3_000).authorized).toBe(
      true
    );
  });

  it('supports permanent grants and blocks card reuse', () => {
    const config = createConfig();
    const card = createAdultAuthCard(config, 'forever', 'admin', 1_000);
    const grant = redeemAdultAuthCard(config, 'alice', card.code, 2_000);

    expect(grant.expiresAt).toBeNull();
    expect(() => redeemAdultAuthCard(config, 'bob', card.code, 3_000)).toThrow(
      '授權卡號已被使用'
    );
  });

  it('treats owner and admin users as authorized', () => {
    process.env.USERNAME = 'owner';
    const config = createConfig();

    expect(getAdultAuthorizationStatus(config, 'owner').authorized).toBe(true);
    expect(getAdultAuthorizationStatus(config, 'admin').authorized).toBe(true);
    expect(getAdultAuthorizationStatus(config, 'alice').authorized).toBe(false);
  });

  it('marks expired grants as unauthorized', () => {
    const config = createConfig();
    config.AdultAuthConfig = {
      cards: [],
      grants: [
        {
          username: 'alice',
          cardCode: 'ADULT-OLD',
          grantedAt: 1_000,
          grantedBy: 'admin',
          expiresAt: 2_000,
        },
      ],
    };

    expect(getAdultAuthorizationStatus(config, 'alice', 2_001)).toMatchObject({
      authorized: false,
      reason: 'expired',
      expiresAt: 2_000,
    });
  });

  it('grants adult access directly to a normal user', () => {
    const config = createConfig();
    const { card, grant } = grantAdultAuthToUser(
      config,
      'alice',
      'month',
      'admin',
      10_000
    );

    expect(card.usedBy).toBe('alice');
    expect(grant).toMatchObject({
      username: 'alice',
      cardCode: card.code,
      grantedBy: 'admin',
      expiresAt: 10_000 + 30 * 24 * 60 * 60 * 1000,
    });
    expect(
      getAdultAuthorizationStatus(config, 'alice', 11_000).authorized
    ).toBe(true);
  });

  it('does not directly grant cards to admin users', () => {
    const config = createConfig();

    expect(() =>
      grantAdultAuthToUser(config, 'admin', 'month', 'admin', 10_000)
    ).toThrow('管理員和站長已自動擁有成人權限');
  });
});

function createConfig(): AdminConfig {
  return {
    ConfigFile: '{}',
    SiteConfig: {
      SiteName: 'MoonTV',
      Announcement: '',
      SearchDownstreamMaxPage: 5,
      SiteInterfaceCacheTime: 7200,
      DoubanProxyType: 'direct',
      DoubanProxy: '',
      DoubanImageProxyType: 'server',
      DoubanImageProxy: '',
      DisableYellowFilter: true,
    },
    UserConfig: {
      AllowRegister: false,
      Users: [
        { username: 'admin', role: 'admin' },
        { username: 'alice', role: 'user' },
      ],
    },
    SourceConfig: [],
    CustomCategories: [],
    SubscriptionConfig: {},
    AdultAuthConfig: {
      cards: [],
      grants: [],
    },
  };
}
