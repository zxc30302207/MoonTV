// Local-only PostgreSQL (PGlite) regression. NEVER connects to a remote database.
// Uses the exact repo dev dependency; PGLITE_MODULE optionally selects a local build.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const { PGlite } = await import(
  process.env.PGLITE_MODULE
    ? pathToFileURL(process.env.PGLITE_MODULE).href
    : '@electric-sql/pglite'
);
const db = new PGlite();
let passed = 0;
async function test(name, run) {
  await run();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}
async function scalar(sql, params = []) {
  return Object.values((await db.query(sql, params)).rows[0])[0];
}
const config = { UserConfig: { AllowRegister: true, Users: [] } };
const next = {
  UserConfig: {
    AllowRegister: true,
    Users: [{ username: 'alice', role: 'user' }],
  },
};
const snapshot = (table = 'moontv_kv') =>
  scalar('select public.moontv_snapshot_kv($1)', [table]);
const restore = (rows, table = 'moontv_kv') =>
  scalar('select public.moontv_restore_kv($1,$2::jsonb)', [
    table,
    JSON.stringify(rows),
  ]);
const register = (expected = config, target = next, user = 'alice') =>
  scalar('select public.moontv_register_user($1,$2::jsonb,$3::jsonb,$4,$5)', [
    'moontv_kv',
    JSON.stringify(expected),
    JSON.stringify(target),
    user,
    'synthetic-test-hash',
  ]);

try {
  await db.exec(
    'create role anon; create role authenticated; create role service_role bypassrls;'
  );
  await db.exec(
    await readFile(new URL('../001_moontv_kv.sql', import.meta.url), 'utf8')
  );
  await db.exec(
    'grant usage on schema public to service_role; grant select,insert,update,delete on public.moontv_kv to service_role;'
  );
  const migration = await readFile(
    new URL('../002_atomic_kv.sql', import.meta.url),
    'utf8'
  );
  await db.exec(migration);

  await test('functions are invoker with pinned search path and private execute ACL', async () => {
    const result = await db.query(
      "select proname,prosecdef,proconfig,has_function_privilege('anon',p.oid,'execute') a,has_function_privilege('authenticated',p.oid,'execute') u,has_function_privilege('service_role',p.oid,'execute') s from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname like 'moontv_%'"
    );
    assert.equal(result.rows.length, 4);
    for (const row of result.rows) {
      assert.equal(row.prosecdef, false);
      assert.ok(
        row.proconfig.some((value) => value.startsWith('search_path='))
      );
      assert.equal(row.a, false);
      assert.equal(row.u, false);
      assert.equal(row.s, true);
    }
  });
  await test('capabilities are read-only and versioned', async () => {
    assert.deepEqual(await scalar('select public.moontv_kv_capabilities()'), {
      api_version: 1,
      atomic_restore: true,
      atomic_registration: true,
      snapshot: true,
    });
  });
  await test('service_role can atomically restore and take ordered complete snapshot', async () => {
    await db.exec('set role service_role');
    assert.equal(
      await restore([
        { key: 'z', value: null },
        { key: 'admin:config', value: config },
      ]),
      2
    );
    assert.deepEqual(await snapshot(), [
      { key: 'admin:config', value: config },
      { key: 'z', value: null },
    ]);
    await db.exec('reset role');
  });
  await test('invalid backups fail without changing any row', async () => {
    const before = await snapshot();
    for (const bad of [
      null,
      {},
      [],
      [{ key: 'only', value: 1 }],
      [
        { key: 'admin:config', value: config },
        { key: 'admin:config', value: config },
      ],
      [
        { key: 'admin:config', value: config },
        { key: '', value: 1 },
      ],
      [{ key: 'admin:config', value: config }, { key: 'missing-value' }],
    ]) {
      await assert.rejects(restore(bad));
      assert.deepEqual(await snapshot(), before);
    }
  });
  await test('INSERT failure AFTER DELETE rolls back replacement completely', async () => {
    await db.exec(
      "alter table public.moontv_kv add constraint synthetic_failure check (key <> 'reject');"
    );
    const before = await snapshot();
    await assert.rejects(
      restore([
        { key: 'admin:config', value: config },
        { key: 'reject', value: 1 },
      ])
    );
    assert.deepEqual(await snapshot(), before);
    await db.exec(
      'alter table public.moontv_kv drop constraint synthetic_failure'
    );
  });
  await test('table allowlist rejects other tables, schema changes and SQL injection', async () => {
    for (const table of [
      'another_kv',
      'public.moontv_kv',
      'moontv_kv;drop table public.moontv_kv',
      '',
      null,
    ]) {
      await assert.rejects(snapshot(table));
      await assert.rejects(
        restore([{ key: 'admin:config', value: config }], table)
      );
    }
    assert.equal((await snapshot()).length, 2);
  });
  await test('registration CAS mismatch does not create credential or alter config', async () => {
    const before = await snapshot();
    assert.equal(await register({ stale: true }), false);
    assert.deepEqual(await snapshot(), before);
  });
  await test('registration commits membership and credential together', async () => {
    await db.exec('set role service_role');
    assert.equal(await register(), true);
    await db.exec('reset role');
    const rows = await snapshot();
    assert.deepEqual(
      rows.find((row) => row.key === 'admin:config').value,
      next
    );
    assert.equal(
      rows.find((row) => row.key === 'u:alice:pwd').value,
      'synthetic-test-hash'
    );
  });
  await test('duplicate credential rolls back preceding config CAS update', async () => {
    const before = await snapshot();
    await assert.rejects(register(next, { ...next, synthetic: true }));
    assert.deepEqual(await snapshot(), before);
  });
  await test('invalid registration namespace is rejected without writes', async () => {
    const before = await snapshot();
    for (const user of [' alice', 'alice ', 'a:b', 'a\nb', '']) {
      await assert.rejects(register(next, config, user));
    }
    assert.deepEqual(await snapshot(), before);
  });
  await test('anon and authenticated cannot call private functions', async () => {
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(snapshot());
      await assert.rejects(scalar('select public.moontv_kv_capabilities()'));
      await db.exec('reset role');
    }
  });
  await test('reapplying migration preserves existing rows and function ACLs', async () => {
    const before = await snapshot();
    await db.exec(migration);
    assert.deepEqual(await snapshot(), before);
    assert.equal(
      await scalar(
        "select has_function_privilege('anon','public.moontv_restore_kv(text,jsonb)','execute')"
      ),
      false
    );
  });
  await test('separate table hardening preserves rows and service CRUD, removes client grants', async () => {
    const before = await snapshot();
    await db.exec('grant all on public.moontv_kv to anon, authenticated;');
    await db.exec(
      await readFile(
        new URL('../003_server_only_kv_permissions.sql', import.meta.url),
        'utf8'
      )
    );
    assert.deepEqual(await snapshot(), before);
    for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
      assert.equal(
        await scalar(
          "select has_table_privilege('service_role','public.moontv_kv',$1)",
          [privilege]
        ),
        true
      );
    }
    for (const role of ['anon', 'authenticated']) {
      for (const privilege of [
        'SELECT',
        'INSERT',
        'UPDATE',
        'DELETE',
        'TRUNCATE',
        'REFERENCES',
        'TRIGGER',
      ]) {
        assert.equal(
          await scalar("select has_table_privilege($1,'public.moontv_kv',$2)", [
            role,
            privilege,
          ]),
          false
        );
      }
    }
    assert.equal(
      await scalar(
        "select relrowsecurity from pg_class where oid='public.moontv_kv'::regclass"
      ),
      true
    );
  });
  const deletionMigration = await readFile(
    new URL('../004_atomic_delete_user.sql', import.meta.url),
    'utf8'
  );
  await db.exec(deletionMigration);
  const deleteUser = (
    expected = next,
    expectedCredential = 'synthetic-test-hash',
    after = config,
    user = 'alice',
    table = 'moontv_kv'
  ) =>
    scalar(
      'select public.moontv_delete_user($1,$2::jsonb,$3::jsonb,$4,$5::jsonb)',
      [
        table,
        JSON.stringify(expected),
        JSON.stringify(after),
        user,
        JSON.stringify(expectedCredential),
      ]
    );
  const seedDeletion = async (credential = 'synthetic-test-hash') => {
    const rows = [
      { key: 'admin:config', value: next },
      { key: 'u:alice:pr:source+id', value: { synthetic: true } },
      { key: 'u:alice:future-namespace', value: 7 },
      { key: 'u:alice2:pr:source+id', value: 8 },
    ];
    if (credential !== null)
      rows.push({ key: 'u:alice:pwd', value: credential });
    await restore(rows);
  };
  await test('atomic delete RPC is invoker, table-bound and service-role-only', async () => {
    const row = (
      await db.query(
        "select prosecdef,proconfig,has_function_privilege('anon',p.oid,'execute') a,has_function_privilege('authenticated',p.oid,'execute') u,has_function_privilege('service_role',p.oid,'execute') s from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname='moontv_delete_user'"
      )
    ).rows[0];
    assert.equal(row.prosecdef, false);
    assert.equal(row.a, false);
    assert.equal(row.u, false);
    assert.equal(row.s, true);
    assert.ok(row.proconfig.some((value) => value.startsWith('search_path=')));
    await assert.rejects(
      deleteUser(next, 'synthetic-test-hash', config, 'alice', 'other_kv')
    );
  });
  await test('delete atomically removes only the exact user namespace and membership', async () => {
    await seedDeletion();
    await db.exec('set role service_role');
    assert.equal(await deleteUser(), true);
    await db.exec('reset role');
    assert.deepEqual(await snapshot(), [
      { key: 'admin:config', value: config },
      { key: 'u:alice2:pr:source+id', value: 8 },
    ]);
  });
  await test('stale config or changed credential makes deletion a no-op', async () => {
    await seedDeletion('new-password-hash');
    const before = await snapshot();
    assert.equal(await deleteUser(), false);
    const staleConfig = { ...next, stale: true };
    assert.equal(
      await deleteUser(staleConfig, 'new-password-hash', {
        ...config,
        stale: true,
      }),
      false
    );
    assert.deepEqual(await snapshot(), before);
  });
  await test('A-delete then same-name re-registration blocks B stale delete even with identical config', async () => {
    await seedDeletion();
    assert.equal(await deleteUser(), true);
    assert.equal(
      await scalar(
        'select public.moontv_register_user($1,$2::jsonb,$3::jsonb,$4,$5)',
        [
          'moontv_kv',
          JSON.stringify(config),
          JSON.stringify(next),
          'alice',
          'different-salted-hash',
        ]
      ),
      true
    );
    const before = await snapshot();
    assert.equal(await deleteUser(), false);
    assert.deepEqual(await snapshot(), before);
  });
  await test('missing credential supports orphan cleanup but never matches a newly created credential', async () => {
    await seedDeletion(null);
    assert.equal(await deleteUser(next, null), true);
    await seedDeletion('new-account-credential');
    const before = await snapshot();
    assert.equal(await deleteUser(next, null), false);
    assert.deepEqual(await snapshot(), before);
  });
  await test('config UPDATE failure after namespace DELETE rolls back every deletion', async () => {
    await seedDeletion();
    const before = await snapshot();
    await db.exec(
      "create function public.synthetic_fail_config() returns trigger language plpgsql as $$ begin raise exception 'synthetic config write failure'; end; $$; create trigger synthetic_fail before update on public.moontv_kv for each row when (old.key='admin:config') execute function public.synthetic_fail_config();"
    );
    await assert.rejects(deleteUser());
    assert.deepEqual(await snapshot(), before);
    await db.exec(
      'drop trigger synthetic_fail on public.moontv_kv; drop function public.synthetic_fail_config();'
    );
  });
  await test('owner, duplicate target, unrelated config mutation and invalid username are rejected', async () => {
    await seedDeletion();
    const before = await snapshot();
    await assert.rejects(
      deleteUser(next, 'synthetic-test-hash', { ...config, unrelated: true })
    );
    const ownerConfig = {
      UserConfig: {
        AllowRegister: true,
        Users: [{ username: 'alice', role: 'owner' }],
      },
    };
    await assert.rejects(deleteUser(ownerConfig));
    const duplicates = {
      UserConfig: {
        AllowRegister: true,
        Users: [...next.UserConfig.Users, ...next.UserConfig.Users],
      },
    };
    await assert.rejects(deleteUser(duplicates));
    await assert.rejects(
      deleteUser(next, 'synthetic-test-hash', config, 'a:b')
    );
    assert.deepEqual(await snapshot(), before);
  });
  await test('underscore usernames are literal, not wildcard deletion prefixes', async () => {
    const expected = {
      UserConfig: { Users: [{ username: 'a_b', role: 'user' }] },
    };
    const after = { UserConfig: { Users: [] } };
    await restore([
      { key: 'admin:config', value: expected },
      { key: 'u:a_b:pwd', value: 'hash' },
      { key: 'u:acb:pwd', value: 'neighbor' },
    ]);
    assert.equal(await deleteUser(expected, 'hash', after, 'a_b'), true);
    assert.deepEqual(await snapshot(), [
      { key: 'admin:config', value: after },
      { key: 'u:acb:pwd', value: 'neighbor' },
    ]);
  });
  await test('reapplying 004 preserves records and client denial', async () => {
    const before = await snapshot();
    await db.exec(deletionMigration);
    assert.deepEqual(await snapshot(), before);
    assert.equal(
      await scalar(
        "select has_function_privilege('anon','public.moontv_delete_user(text,jsonb,jsonb,text,jsonb)','execute')"
      ),
      false
    );
  });
  const generationMigration = await readFile(
    new URL('../005_registration_session_generation.sql', import.meta.url),
    'utf8'
  );
  await test('005 changes no rows and retains registration RPC signature and private ACL', async () => {
    const before = await snapshot();
    await db.exec(generationMigration);
    assert.deepEqual(await snapshot(), before);
    assert.equal(
      await scalar(
        "select pg_get_function_result('public.moontv_register_user(text,jsonb,jsonb,text,text)'::regprocedure)"
      ),
      'boolean'
    );
    assert.equal(
      await scalar(
        "select has_function_privilege('anon','public.moontv_register_user(text,jsonb,jsonb,text,text)','execute')"
      ),
      false
    );
    assert.equal(
      await scalar(
        "select has_function_privilege('service_role','public.moontv_register_user(text,jsonb,jsonb,text,text)','execute')"
      ),
      true
    );
  });
  let capturedCredential;
  await test('registration stores exact caller hash in a new epoch-bearing envelope', async () => {
    await restore([{ key: 'admin:config', value: config }]);
    await db.exec('set role service_role');
    assert.equal(await register(), true);
    await db.exec('reset role');
    capturedCredential = (await snapshot()).find(
      (row) => row.key === 'u:alice:pwd'
    ).value;
    assert.equal(capturedCredential.hash, 'synthetic-test-hash');
    assert.equal(Number.isSafeInteger(capturedCredential.revokedBefore), true);
    assert.ok(capturedCredential.revokedBefore > 0);
  });
  await test('005 CAS and duplicate rollback remain atomic with credential envelopes', async () => {
    const before = await snapshot();
    assert.equal(await register(), false);
    await assert.rejects(register(next, { ...next, anotherSetting: true }));
    assert.deepEqual(await snapshot(), before);
  });
  await test('004 checks entire envelope, not just its password hash', async () => {
    const before = await snapshot();
    assert.equal(await deleteUser(next, capturedCredential.hash), false);
    assert.equal(
      await deleteUser(next, {
        ...capturedCredential,
        revokedBefore: capturedCredential.revokedBefore + 1,
      }),
      false
    );
    assert.deepEqual(await snapshot(), before);
    assert.equal(await deleteUser(next, capturedCredential), true);
  });
  await test('new registration generation rejects stale envelope after same-name reuse', async () => {
    assert.equal(
      await scalar(
        'select public.moontv_register_user($1,$2::jsonb,$3::jsonb,$4,$5)',
        [
          'moontv_kv',
          JSON.stringify(config),
          JSON.stringify(next),
          'alice',
          'fresh-random-salt-hash',
        ]
      ),
      true
    );
    const before = await snapshot();
    assert.equal(await deleteUser(next, capturedCredential), false);
    assert.deepEqual(await snapshot(), before);
    const actual = before.find((row) => row.key === 'u:alice:pwd').value;
    assert.equal(actual.hash, 'fresh-random-salt-hash');
  });
  console.log(`PASS ${passed} local SQL tests. No remote database writes.`);
} finally {
  await db.close();
}
