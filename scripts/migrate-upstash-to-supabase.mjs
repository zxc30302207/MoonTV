import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { Redis } from '@upstash/redis';
import { createClient } from '@supabase/supabase-js';

const TABLE = process.env.SUPABASE_KV_TABLE || 'moontv_kv';
const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 100;

loadEnvFile('.env');
loadEnvFile('.env.local');
loadEnvFile('.env.production.local');

const supabaseSecret =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const required = ['UPSTASH_URL', 'UPSTASH_TOKEN', 'SUPABASE_URL'];

const missing = required.filter((key) => !process.env[key]);
if (!supabaseSecret) {
  missing.push('SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY');
}

if (missing.length > 0) {
  throw new Error(`Missing required env vars: ${missing.join(', ')}`);
}

const redis = new Redis({
  url: process.env.UPSTASH_URL,
  token: process.env.UPSTASH_TOKEN,
});

const supabase = createClient(process.env.SUPABASE_URL, supabaseSecret, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const keys = await redis.keys('*');
const rows = [];

for (const key of keys) {
  const value = await readUpstashValue(key);
  if (value === null || value === undefined) continue;
  rows.push({
    key,
    value,
    updated_at: new Date().toISOString(),
  });
}

console.log(
  `Prepared ${rows.length} Upstash keys for Supabase table "${TABLE}".`
);

if (DRY_RUN) {
  const sampleKeys = rows.slice(0, 10).map((row) => row.key);
  console.log('Dry run only. Sample keys:', sampleKeys.join(', '));
  process.exit(0);
}

for (let index = 0; index < rows.length; index += BATCH_SIZE) {
  const batch = rows.slice(index, index + BATCH_SIZE);
  const { error } = await supabase
    .from(TABLE)
    .upsert(batch, { onConflict: 'key' });

  if (error) {
    throw new Error(`Supabase upsert failed: ${error.message}`);
  }

  console.log(
    `Migrated ${Math.min(index + BATCH_SIZE, rows.length)} / ${rows.length}`
  );
}

console.log('Upstash to Supabase migration completed.');

async function readUpstashValue(key) {
  if (/^u:.+?:sh$/.test(key)) {
    return redis.lrange(key, 0, -1);
  }

  return redis.get(key);
}

function loadEnvFile(fileName) {
  const path = resolve(process.cwd(), fileName);
  if (!existsSync(path)) return;

  const text = readFileSync(path, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key]) continue;

    process.env[key] = rawValue
      .trim()
      .replace(/^['"]|['"]$/g, '')
      .replace(/\\n/g, '\n');
  }
}
