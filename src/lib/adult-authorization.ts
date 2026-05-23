import crypto from 'crypto';

import {
  AdminConfig,
  AdultAuthCard,
  AdultAuthDuration,
  AdultAuthGrant,
} from '@/lib/admin.types';

export type AdultAuthorizationStatus = {
  authorized: boolean;
  reason?: 'missing_user' | 'missing_grant' | 'expired' | 'admin';
  expiresAt?: number | null;
};

const DURATION_MS: Record<Exclude<AdultAuthDuration, 'forever'>, number> = {
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  year: 365 * 24 * 60 * 60 * 1000,
};

export const ADULT_AUTH_DURATION_LABELS: Record<AdultAuthDuration, string> = {
  day: '1 日',
  week: '1 周',
  month: '1 個月',
  year: '1 年',
  forever: '永久',
};

export function ensureAdultAuthConfig(config: AdminConfig) {
  if (!config.AdultAuthConfig) {
    config.AdultAuthConfig = {
      cards: [],
      grants: [],
    };
  }

  if (!Array.isArray(config.AdultAuthConfig.cards)) {
    config.AdultAuthConfig.cards = [];
  }

  if (!Array.isArray(config.AdultAuthConfig.grants)) {
    config.AdultAuthConfig.grants = [];
  }

  return config.AdultAuthConfig;
}

export function isAdminUser(
  config: AdminConfig,
  username: string | undefined
): boolean {
  if (!username) return false;
  if (username === process.env.USERNAME) return true;

  const user = config.UserConfig.Users.find(
    (entry) => entry.username === username
  );
  return Boolean(user && !user.banned && user.role === 'admin');
}

export function getAdultAuthorizationStatus(
  config: AdminConfig,
  username: string | undefined,
  now = Date.now()
): AdultAuthorizationStatus {
  if (!username) {
    return { authorized: false, reason: 'missing_user' };
  }

  if (isAdminUser(config, username)) {
    return { authorized: true, reason: 'admin', expiresAt: null };
  }

  const user = config.UserConfig.Users.find(
    (entry) => entry.username === username
  );
  if (!user || user.banned) {
    return { authorized: false, reason: 'missing_user' };
  }

  const adultAuth = ensureAdultAuthConfig(config);
  const grant = adultAuth.grants.find((entry) => entry.username === username);
  if (!grant) {
    return { authorized: false, reason: 'missing_grant' };
  }

  if (grant.expiresAt !== null && grant.expiresAt <= now) {
    return { authorized: false, reason: 'expired', expiresAt: grant.expiresAt };
  }

  return { authorized: true, expiresAt: grant.expiresAt };
}

export function createAdultAuthCard(
  config: AdminConfig,
  duration: AdultAuthDuration,
  createdBy: string,
  now = Date.now()
): AdultAuthCard {
  if (!isAdultAuthDuration(duration)) {
    throw new Error('授權時長不正確');
  }

  const adultAuth = ensureAdultAuthConfig(config);
  let code = generateAdultAuthCode();
  while (adultAuth.cards.some((card) => card.code === code)) {
    code = generateAdultAuthCode();
  }

  const card: AdultAuthCard = {
    code,
    duration,
    createdAt: now,
    createdBy,
  };
  adultAuth.cards.unshift(card);
  return card;
}

export function redeemAdultAuthCard(
  config: AdminConfig,
  username: string,
  code: string,
  now = Date.now()
): AdultAuthGrant {
  const adultAuth = ensureAdultAuthConfig(config);
  const normalizedCode = normalizeAdultAuthCode(code);
  const card = adultAuth.cards.find((entry) => entry.code === normalizedCode);

  if (!card) {
    throw new Error('授權卡號不存在');
  }

  if (card.disabled) {
    throw new Error('授權卡號已停用');
  }

  if (card.usedBy) {
    throw new Error('授權卡號已被使用');
  }

  const expiresAt =
    card.duration === 'forever' ? null : now + DURATION_MS[card.duration];

  card.usedBy = username;
  card.usedAt = now;

  const existingGrant = adultAuth.grants.find(
    (entry) => entry.username === username
  );
  const grant: AdultAuthGrant = {
    username,
    cardCode: card.code,
    grantedAt: now,
    grantedBy: card.createdBy,
    expiresAt,
  };

  if (existingGrant) {
    Object.assign(existingGrant, grant);
    return existingGrant;
  }

  adultAuth.grants.push(grant);
  return grant;
}

export function grantAdultAuthToUser(
  config: AdminConfig,
  username: string,
  duration: AdultAuthDuration,
  grantedBy: string,
  now = Date.now()
): { card: AdultAuthCard; grant: AdultAuthGrant } {
  const user = config.UserConfig.Users.find(
    (entry) => entry.username === username
  );
  if (!user || user.banned) {
    throw new Error('目標用戶不存在或已封禁');
  }

  if (user.role !== 'user') {
    throw new Error('管理員和站長已自動擁有成人權限');
  }

  const card = createAdultAuthCard(config, duration, grantedBy, now);
  const grant = redeemAdultAuthCard(config, username, card.code, now);
  return { card, grant };
}

export function setAdultAuthCardDisabled(
  config: AdminConfig,
  code: string,
  disabled: boolean
): AdultAuthCard {
  const adultAuth = ensureAdultAuthConfig(config);
  const card = adultAuth.cards.find(
    (entry) => entry.code === normalizeAdultAuthCode(code)
  );

  if (!card) {
    throw new Error('授權卡號不存在');
  }

  card.disabled = disabled;
  return card;
}

export function deleteAdultAuthCard(config: AdminConfig, code: string): void {
  const adultAuth = ensureAdultAuthConfig(config);
  const normalizedCode = normalizeAdultAuthCode(code);
  const cardIndex = adultAuth.cards.findIndex(
    (entry) => entry.code === normalizedCode
  );

  if (cardIndex === -1) {
    throw new Error('授權卡號不存在');
  }

  adultAuth.cards.splice(cardIndex, 1);
  adultAuth.grants = adultAuth.grants.filter(
    (grant) => grant.cardCode !== normalizedCode
  );
}

export function normalizeAdultAuthCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, '');
}

export function isAdultAuthDuration(value: string): value is AdultAuthDuration {
  return ['day', 'week', 'month', 'year', 'forever'].includes(value);
}

function generateAdultAuthCode(): string {
  const token = crypto.randomBytes(9).toString('hex').toUpperCase();
  return `ADULT-${token.slice(0, 4)}-${token.slice(4, 8)}-${token.slice(
    8,
    12
  )}-${token.slice(12, 18)}`;
}
