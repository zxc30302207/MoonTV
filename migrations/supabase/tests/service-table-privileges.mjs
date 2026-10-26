// Synthetic local existing-install ACL correction; never connects to Supabase.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(
  process.env.PGLITE_MODULE
    ? pathToFileURL(process.env.PGLITE_MODULE).href
    : '@electric-sql/pglite'
);
const db = new PGlite();
const privileges = [
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'TRUNCATE',
  'REFERENCES',
  'TRIGGER',
  'MAINTAIN',
];
const tables = [
  'moontv_mutation_control',
  'moontv_mutation_state',
  'moontv_rate_buckets',
];
const scalar = async (sql, params = []) =>
  Object.values((await db.query(sql, params)).rows[0])[0];
const allowed = (table, privilege) =>
  scalar('select has_table_privilege($1,$2,$3)', [
    'service_role',
    `public.${table}`,
    privilege,
  ]);
let passed = 0;
async function test(name, fn) {
  await fn();
  console.log(`ok ${++passed} - ${name}`);
}
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to service_role;
    alter default privileges in schema public grant all on tables to service_role;
    create table public.moontv_kv(key text primary key, value jsonb);
    insert into public.moontv_kv values('synthetic', '{"unchanged":true}');
  `);
  for (const table of tables) {
    await db.exec(`create table public.${table}(id integer primary key, value jsonb);
      alter table public.${table} enable row level security;
      revoke all on public.${table} from public, anon, authenticated;
      insert into public.${table} values(1,'{"unchanged":true}');`);
  }
  await test('reproduces all eight default service privileges on existing tables', async () => {
    for (const table of tables)
      for (const privilege of privileges)
        assert.equal(await allowed(table, privilege), true);
  });
  const before = await scalar(
    "select jsonb_agg(jsonb_build_array(c.relname,c.relacl::text,c.relrowsecurity) order by c.relname) from pg_class c where c.oid='public.moontv_kv'::regclass"
  );
  const correction = await readFile(
    new URL(
      '../20261026125455_narrow_service_table_privileges.sql',
      import.meta.url
    ),
    'utf8'
  );
  await db.exec(correction);
  await test('additive correction replaces ALL with SELECT-only control and CRUD-only state/rate', async () => {
    for (const table of tables) {
      const expected =
        table === 'moontv_mutation_control'
          ? ['SELECT']
          : ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
      for (const privilege of privileges)
        assert.equal(
          await allowed(table, privilege),
          expected.includes(privilege),
          `${table} ${privilege}`
        );
    }
  });
  await test('correction preserves every row, RLS, public denial and pre-existing KV ACL', async () => {
    for (const table of tables) {
      assert.deepEqual((await db.query(`select * from public.${table}`)).rows, [
        { id: 1, value: { unchanged: true } },
      ]);
      assert.equal(
        await scalar(
          'select relrowsecurity from pg_class where oid=$1::regclass',
          [`public.${table}`]
        ),
        true
      );
      for (const role of ['anon', 'authenticated'])
        for (const privilege of privileges)
          assert.equal(
            await scalar('select has_table_privilege($1,$2,$3)', [
              role,
              `public.${table}`,
              privilege,
            ]),
            false
          );
    }
    assert.deepEqual(
      await scalar(
        "select jsonb_agg(jsonb_build_array(c.relname,c.relacl::text,c.relrowsecurity) order by c.relname) from pg_class c where c.oid='public.moontv_kv'::regclass"
      ),
      before
    );
    assert.deepEqual((await db.query('select * from public.moontv_kv')).rows, [
      { key: 'synthetic', value: { unchanged: true } },
    ]);
  });
  await test('control is readable but not writable by the service role', async () => {
    await db.exec('set role service_role');
    assert.equal(
      await scalar(
        'select count(*)::integer from public.moontv_mutation_control'
      ),
      1
    );
    await assert.rejects(
      db.exec("update public.moontv_mutation_control set value='{}'"),
      /permission denied/
    );
    for (const table of ['moontv_mutation_state', 'moontv_rate_buckets']) {
      await db.exec(
        `insert into public.${table} values(2,'{}'); update public.${table} set value='{"ok":true}' where id=2; delete from public.${table} where id=2;`
      );
    }
    await db.exec('reset role');
  });
  await test('reapplication is idempotent and does not revoke existing KV permissions', async () => {
    await db.exec(correction);
    assert.equal(await allowed('moontv_mutation_control', 'UPDATE'), false);
    assert.equal(await allowed('moontv_mutation_state', 'UPDATE'), true);
    assert.equal(await allowed('moontv_rate_buckets', 'TRUNCATE'), false);
    for (const privilege of privileges)
      assert.equal(await allowed('moontv_kv', privilege), true);
  });
  console.log(`${passed} existing-install privilege tests passed`);
} finally {
  await db.close();
}
