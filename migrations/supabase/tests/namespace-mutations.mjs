// Synthetic local PostgreSQL engine only; never connects to Supabase.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(
  process.env.PGLITE_MODULE
    ? pathToFileURL(process.env.PGLITE_MODULE).href
    : '@electric-sql/pglite'
);
const db = new PGlite();
let passed = 0;
const test = async (name, fn) => {
  await fn();
  console.log(`ok ${++passed} - ${name}`);
};
const scalar = async (sql, params = []) =>
  Object.values((await db.query(sql, params)).rows[0])[0];
const config = {
  UserConfig: {
    AllowRegister: true,
    Users: [
      { username: 'alice', role: 'user' },
      { username: 'owner', role: 'owner' },
    ],
  },
};
const read = (ns = 'pr', user = 'alice') =>
  scalar('select public.moontv_read_namespace($1,$2,$3)', [
    'moontv_kv',
    user,
    ns,
  ]);
const mutate = (
  snap,
  action = 'set',
  key = 's+1',
  value = { index: 1 },
  op = randomUUID(),
  ns = 'pr',
  user = 'alice'
) =>
  scalar('select public.moontv_mutate_namespace($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
    'moontv_kv',
    user,
    ns,
    snap.version.epoch,
    snap.version.revision,
    op,
    action,
    key,
    JSON.stringify(value),
  ]);
try {
  await db.exec(
    'create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to service_role; alter default privileges in schema public grant all on tables to service_role;'
  );
  for (const name of [
    '001_moontv_kv.sql',
    '002_atomic_kv.sql',
    '003_server_only_kv_permissions.sql',
    '004_atomic_delete_user.sql',
    '005_registration_session_generation.sql',
    '20261026100735_namespace_mutations.sql',
  ])
    await db.exec(
      await readFile(new URL('../' + name, import.meta.url), 'utf8')
    );
  await db.query(
    'insert into public.moontv_kv(key,value) values ($1,$2),($3,$4)',
    [
      'admin:config',
      JSON.stringify(config),
      'u:alice:pwd',
      JSON.stringify('synthetic-hash'),
    ]
  );
  await test('dormant RPC fails closed without row mutation', async () => {
    await assert.rejects(() => read(), /not activated/);
    assert.equal(
      await scalar('select count(*)::int from public.moontv_mutation_state'),
      0
    );
  });
  await db.exec(
    'update public.moontv_mutation_control set enabled=true where singleton'
  );
  await test('new tables use RLS and server-only grants', async () => {
    const rows = (
      await db.query(
        "select relname,relrowsecurity,has_table_privilege('anon',oid,'select') a,has_table_privilege('authenticated',oid,'insert') u from pg_class where relname in ('moontv_mutation_control','moontv_mutation_state')"
      )
    ).rows;
    assert.equal(rows.length, 2);
    for (const r of rows) {
      assert.equal(r.relrowsecurity, true);
      assert.equal(r.a, false);
      assert.equal(r.u, false);
    }
    assert.equal(
      await scalar(
        "select has_table_privilege('service_role','public.moontv_mutation_control','update')"
      ),
      false
    );
  });
  await test('default service ALL is narrowed to exact control SELECT and state CRUD', async () => {
    for (const table of ['moontv_mutation_control', 'moontv_mutation_state']) {
      const expected =
        table === 'moontv_mutation_control'
          ? ['SELECT']
          : ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
      for (const privilege of [
        'SELECT',
        'INSERT',
        'UPDATE',
        'DELETE',
        'TRUNCATE',
        'REFERENCES',
        'TRIGGER',
        'MAINTAIN',
      ]) {
        assert.equal(
          await scalar('select has_table_privilege($1,$2,$3)', [
            'service_role',
            `public.${table}`,
            privilege,
          ]),
          expected.includes(privilege),
          `${table} ${privilege}`
        );
      }
    }
  });
  await test('functions are invoker and EXECUTE restricted', async () => {
    const functions = (
      await db.query(
        "select proname,prosecdef,proconfig,has_function_privilege('anon',oid,'execute') a,has_function_privilege('authenticated',oid,'execute') u,has_function_privilege('service_role',oid,'execute') s from pg_proc where proname in ('moontv_read_namespace','moontv_mutate_namespace','moontv_namespace_guard','moontv_prepare_namespace')"
      )
    ).rows;
    assert.equal(functions.length, 4);
    for (const r of functions) {
      assert.equal(r.prosecdef, false);
      assert.equal(r.a, false);
      assert.equal(r.u, false);
      assert.equal(r.s, true);
      assert.ok(r.proconfig.includes('search_path=""'));
    }
  });
  await test('unversioned writes blocked even from service role', async () => {
    await db.exec('set role service_role');
    await assert.rejects(
      () =>
        db.query(
          "insert into public.moontv_kv(key,value) values ('u:alice:pr:s+1','{}')"
        ),
      /Versioned namespace mutation required/
    );
    await db.exec('reset role');
  });
  let initial, first;
  const op = randomUUID();
  await test('snapshot and versioned mutation succeed with exact revision', async () => {
    initial = await read();
    assert.deepEqual(initial.data, {});
    first = await mutate(initial, 'set', 's+1', { index: 1 }, op);
    assert.equal(first.version.revision, '1');
    assert.deepEqual((await read()).data, { 's+1': { index: 1 } });
  });
  await test('duplicate retry is not applied twice', async () => {
    const duplicate = await mutate(initial, 'set', 's+1', { index: 1 }, op);
    assert.equal(duplicate.duplicate, true);
    assert.deepEqual(duplicate.version, first.version);
  });
  await test('operation reuse with changed content rejected', async () => {
    await assert.rejects(
      () => mutate(initial, 'set', 's+1', { index: 2 }, op),
      /reused/
    );
  });
  await test('stale devices rejected without replacing new value', async () => {
    await assert.rejects(() => mutate(initial), /NAMESPACE_CONFLICT/);
    assert.deepEqual((await read()).data, { 's+1': { index: 1 } });
  });
  let cleared;
  await test('clear retains revision tombstone and rejects old retry', async () => {
    cleared = await mutate(first, 'clear');
    assert.deepEqual(cleared.data, {});
    await assert.rejects(
      () => mutate(initial, 'set', 's+1', { index: 1 }, op),
      /NAMESPACE_CONFLICT/
    );
    assert.equal(cleared.version.revision, '2');
  });
  await test('namespace and account isolation', async () => {
    const f = await read('fav');
    assert.equal(f.version.revision, '0');
    assert.notEqual(f.version.epoch, cleared.version.epoch);
    await assert.rejects(
      () => read('pr', 'missing'),
      /Account no longer exists/
    );
    const owner = await read('pr', 'owner');
    assert.deepEqual(owner.data, {});
  });
  await test('history add deduplicates and delete/clear use same version contract', async () => {
    let sh = await read('sh');
    sh = await mutate(sh, 'add', 'one', null, randomUUID(), 'sh');
    sh = await mutate(sh, 'add', 'two', null, randomUUID(), 'sh');
    sh = await mutate(sh, 'add', 'one', null, randomUUID(), 'sh');
    assert.deepEqual(sh.data, ['one', 'two']);
    sh = await mutate(sh, 'delete', 'one', null, randomUUID(), 'sh');
    assert.deepEqual(sh.data, ['two']);
    sh = await mutate(sh, 'clear', null, null, randomUUID(), 'sh');
    assert.deepEqual(sh.data, []);
  });
  await test('invalid namespace and table rejected', async () => {
    await assert.rejects(() => read('pwd'), /Invalid namespace/);
    await assert.rejects(
      () => scalar("select public.moontv_read_namespace('other','alice','pr')"),
      /Invalid namespace/
    );
  });
  await test('marker does not escape RPC, direct update/delete still rejected', async () => {
    await mutate(await read());
    await assert.rejects(
      () => db.exec("delete from public.moontv_kv where key='u:alice:pr:s+1'"),
      /Versioned/
    );
    await assert.rejects(
      () =>
        db.exec(
          "update public.moontv_kv set key='u:alice:skip:x' where key='u:alice:pr:s+1'"
        ),
      /key moves/
    );
  });
  await test('statement failure rolls back data and revision', async () => {
    const before = await read();
    await db.exec(
      "alter table public.moontv_kv add constraint fixture_failure check (key<>'u:alice:pr:fail')"
    );
    await assert.rejects(() => mutate(before, 'set', 'fail'));
    assert.deepEqual(await read(), before);
    await db.exec(
      'alter table public.moontv_kv drop constraint fixture_failure'
    );
  });
  await test('restore rotates epochs even with identical restored data', async () => {
    const before = await read();
    const rows = await scalar("select public.moontv_snapshot_kv('moontv_kv')");
    await scalar("select public.moontv_restore_kv('moontv_kv',$1)", [
      JSON.stringify(rows),
    ]);
    const after = await read();
    assert.deepEqual(after.data, before.data);
    assert.notEqual(after.version.epoch, before.version.epoch);
    await assert.rejects(() => mutate(before), /NAMESPACE_CONFLICT/);
  });
  await test('delete/re-register cannot reuse previous namespace generation', async () => {
    const before = await read();
    const next = {
      UserConfig: {
        ...config.UserConfig,
        Users: config.UserConfig.Users.filter((x) => x.username !== 'alice'),
      },
    };
    assert.equal(
      await scalar(
        "select public.moontv_delete_user('moontv_kv',$1,$2,'alice',$3)",
        [
          JSON.stringify(config),
          JSON.stringify(next),
          JSON.stringify('synthetic-hash'),
        ]
      ),
      true
    );
    assert.equal(
      await scalar(
        "select count(*)::int from public.moontv_mutation_state where username='alice'"
      ),
      0
    );
    assert.equal(
      await scalar(
        "select public.moontv_register_user('moontv_kv',$1,$2,'alice','new-hash')",
        [JSON.stringify(next), JSON.stringify(config)]
      ),
      true
    );
    const after = await read();
    assert.notEqual(after.version.epoch, before.version.epoch);
    await assert.rejects(() => mutate(before), /NAMESPACE_CONFLICT/);
  });
  await test('environment owner need not be persisted in config', async () => {
    const owner = await scalar(
      "select public.moontv_read_namespace('moontv_kv','environment-owner','pr',true)"
    );
    assert.deepEqual(owner.data, {});
    await assert.rejects(
      () => read('pr', 'environment-owner'),
      /Account no longer exists/
    );
  });
  await test('normal password change does not reset mutation epoch', async () => {
    const before = await read();
    await db.exec(
      "update public.moontv_kv set value='\"newer-password-hash\"' where key='u:alice:pwd'"
    );
    assert.deepEqual((await read()).version, before.version);
  });
  await test('credential upsert preserves epoch when it updates an existing account', async () => {
    const before = await read();
    await db.exec(
      "insert into public.moontv_kv(key,value) values ('u:alice:pwd','\"upsert-hash\"') on conflict(key) do update set value=excluded.value"
    );
    assert.deepEqual((await read()).version, before.version);
  });
  await test('duplicate credential INSERT DO NOTHING and unchanged upsert preserve epochs', async () => {
    const before = await read();
    await db.exec(
      "insert into public.moontv_kv(key,value) values ('u:alice:pwd','\"ignored\"') on conflict(key) do nothing"
    );
    assert.deepEqual((await read()).version, before.version);
    await db.exec(
      "insert into public.moontv_kv(key,value) select key,value from public.moontv_kv where key='u:alice:pwd' on conflict(key) do update set value=excluded.value"
    );
    assert.deepEqual((await read()).version, before.version);
  });
  await test('reviewed reactivation rotates metadata after compatibility rollback', async () => {
    const before = await read();
    await db.exec(
      'update public.moontv_mutation_control set enabled=false where singleton'
    );
    await db.exec(
      "insert into public.moontv_kv(key,value) values ('u:alice:pr:legacy','{}')"
    );
    await db.exec(
      await readFile(
        new URL('./namespace-activation.sql', import.meta.url),
        'utf8'
      )
    );
    const after = await read();
    assert.notEqual(after.version.epoch, before.version.epoch);
    assert.deepEqual(after.data, { legacy: {} });
    await assert.rejects(() => mutate(before), /NAMESPACE_CONFLICT/);
  });
  console.log(`${passed} namespace SQL tests passed`);
} finally {
  await db.close();
}
