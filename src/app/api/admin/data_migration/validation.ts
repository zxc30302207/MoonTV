import { z } from 'zod';

import { AdminConfig } from '@/lib/admin.types';
import {
  Favorite,
  Following,
  PlayRecord,
  SkipConfig,
  TodayUpdatedRecord,
} from '@/lib/types';
import { normalizeUsername } from '@/lib/username';

const count = z.number().finite().nonnegative();
const key = z
  .string()
  .max(1024)
  .refine((value) => {
    const parts = value.split('+');
    return parts.length === 2 && parts.every(Boolean);
  });
const username = z
  .string()
  .refine((value) => normalizeUsername(value) === value);
const media = z.object({
  title: z.string(),
  source_name: z.string(),
  year: z.string(),
  cover: z.string(),
  total_episodes: count,
  save_time: count,
  search_title: z.string().optional(),
});
const playRecord = media.extend({
  index: count,
  play_time: count,
  total_time: count,
});
const following = media.extend({
  watched_episodes: count,
  search_title: z.string(),
  source: z.string().optional(),
  id: z.string().optional(),
});
const skipConfig = z.object({
  enable: z.boolean(),
  intro_time: count,
  outro_time: z.number().finite(),
});
const todayUpdated = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  items: z.array(
    z.object({
      source: z.string().min(1),
      id: z.string().min(1),
      title: z.string(),
      poster: z.string(),
      episodes: count,
      watchedEpisodes: count,
      unwatchedEpisodes: count,
      source_name: z.string(),
      year: z.string(),
      save_time: count,
      oldEpisodes: count,
      newEpisodes: count,
    })
  ),
});

const adminConfig = z
  .object({
    ConfigFile: z.string().refine((value) => {
      try {
        const parsed: unknown = JSON.parse(value);
        return Boolean(
          parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        );
      } catch {
        return false;
      }
    }),
    SiteConfig: z
      .object({ SiteName: z.string(), DisableYellowFilter: z.boolean() })
      .passthrough(),
    UserConfig: z
      .object({
        AllowRegister: z.boolean(),
        Users: z.array(
          z
            .object({ username, role: z.enum(['owner', 'admin', 'user']) })
            .passthrough()
        ),
      })
      .passthrough(),
    SourceConfig: z.array(
      z
        .object({ key: z.string(), name: z.string(), api: z.string() })
        .passthrough()
    ),
    CustomCategories: z.array(
      z
        .object({ query: z.string(), type: z.enum(['movie', 'tv']) })
        .passthrough()
    ),
  })
  .passthrough();

const backupSchema = z.object({
  timestamp: z.string().optional(),
  serverVersion: z.string().optional(),
  data: z.object({
    adminConfig,
    userData: z.record(
      username,
      z.object({
        password: z.string().optional().nullable(),
        playRecords: z.record(key, playRecord).optional(),
        favorites: z.record(key, media).optional(),
        followings: z.record(key, following).optional(),
        searchHistory: z.array(z.string()).optional(),
        skipConfigs: z.record(key, skipConfig).optional(),
        todayUpdated: todayUpdated.optional().nullable(),
      })
    ),
  }),
});

export interface ImportUserData {
  password?: string | null;
  playRecords?: Record<string, PlayRecord>;
  favorites?: Record<string, Favorite>;
  followings?: Record<string, Following>;
  searchHistory?: string[];
  skipConfigs?: Record<string, SkipConfig>;
  todayUpdated?: TodayUpdatedRecord | null;
}

export function validateBackup(value: unknown): {
  data: { adminConfig: AdminConfig; userData: Record<string, ImportUserData> };
  timestamp?: string;
  serverVersion?: string;
} | null {
  const parsed = backupSchema.safeParse(value);
  return parsed.success
    ? (parsed.data as unknown as {
        data: {
          adminConfig: AdminConfig;
          userData: Record<string, ImportUserData>;
        };
        timestamp?: string;
        serverVersion?: string;
      })
    : null;
}
