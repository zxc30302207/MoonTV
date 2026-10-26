// Local-only PGlite regression; never connects to a remote database.
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
async function test(name, fn) {
  await fn();
  console.log(`ok ${++passed} - ${name}`);
}
const hash = 'a'.repeat(64);
const consume = async (scope = 'login', subject = hash) =>
  (
    await db.query('select public.moontv_consume_rate_limit($1,$2) as result', [
      scope,
      subject,
    ])
  ).rows[0].result;
try {
  await db.exec(
    'create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to service_role;'
  );
  await db.exec(
    await readFile(
      new URL('../20261026100617_shared_rate_limits.sql', import.meta.url),
      'utf8'
    )
  );
  await test('grants deny public consumers and enable service only', async () => {
    for (const role of ['anon', 'authenticated']) {
      const { rows } = await db.query(
        `select has_table_privilege('${role}', 'public.moontv_rate_buckets', 'select') as table_access, has_function_privilege('${role}', 'public.moontv_consume_rate_limit(text,text)', 'execute') as rpc_access`
      );
      assert.equal(rows[0].table_access, false);
      assert.equal(rows[0].rpc_access, false);
    }
    const { rows } = await db.query(
      "select relrowsecurity from pg_class where oid='public.moontv_rate_buckets'::regclass"
    );
    assert.equal(rows[0].relrowsecurity, true);
  });
  await db.exec('set role service_role');
  await test('first request has database expiry and remaining count', async () => {
    const r = await consume();
    assert.equal(r.allowed, true);
    assert.equal(r.remaining, 9);
    assert.equal(r.limit, 10);
    assert.ok(r.reset_at_ms > Date.now());
  });
  await test('exactly ten total login requests pass even through independent invocations', async () => {
    const r = await Promise.all(Array.from({ length: 20 }, () => consume()));
    assert.equal(r.filter((x) => x.allowed).length, 9);
    assert.equal(r.filter((x) => !x.allowed).length, 11);
    const { rows } = await db.query(
      'select count from public.moontv_rate_buckets'
    );
    assert.equal(rows[0].count, 11);
  });
  await test('scope and subject counters are separate', async () => {
    assert.equal((await consume('register')).remaining, 4);
    assert.equal((await consume('login', 'b'.repeat(64))).remaining, 9);
    assert.equal((await consume('m3u8-proxy')).remaining, 1199);
  });
  await test('expiry resets counter without adding duplicate rows', async () => {
    await db.query(
      "update public.moontv_rate_buckets set reset_at=clock_timestamp()-interval '1 second' where scope='login' and subject_hash=$1",
      [hash]
    );
    assert.equal((await consume()).remaining, 9);
    const { rows } = await db.query(
      "select count(*)::int as n from public.moontv_rate_buckets where scope='login' and subject_hash=$1",
      [hash]
    );
    assert.equal(rows[0].n, 1);
  });
  await test('unknown scopes and raw IPs are rejected', async () => {
    await assert.rejects(consume('attacker'));
    await assert.rejects(consume('login', '203.0.113.1'));
    await assert.rejects(consume('login', null));
  });
  console.log(
    `${passed} tests passed (single-connection PGlite; not a production load/lock test)`
  );
} finally {
  await db.close();
}
