# Supabase KV migrations and recovery gates

These scripts use the repository's existing sequential migration convention.
They are **not automatically applied by the application**. Review the target
project and table first. Do not apply them blindly to production.

## Deployment order

1. Verify that the configured `SUPABASE_URL` belongs to the intended project and
   confirm `SUPABASE_KV_TABLE` (default `moontv_kv`). Never paste service keys into
   a ticket or commit them. Verify the deployment's actual connection target,
   rather than inferring it from a similarly named connected project.
2. Verify recovery **before any operation that replaces data**, especially an
   actual restore. Obtain a current encrypted logical
   backup with restricted access and test restoration into a disposable database,
   or verify an actually available managed recovery point. A Free plan is not
   evidence of an available daily backup or PITR. Do not buy an upgrade silently.
   Installing `002` and applying `003` are schema/ACL-only, with no row mutations;
   a data export is not a prerequisite for these reversible changes if their exact
   before-state, approval and schema/ACL rollback have been verified. Installing
   a restore function is not authorization to execute a destructive restore.
3. Inspect existing table columns, PK, prefix index, RLS, grants and existing
   function signatures. Keep the before-state schema/ACL record. `001` creates the
   base table for a **new installation**; do not reset an existing database.
4. Obtain explicit approval for the exact function EXECUTE ACL changes in `002`
   and the separate table permission changes in `003`. `002` installs four
   `SECURITY INVOKER` functions, pins an empty `search_path`, revokes EXECUTE from
   PUBLIC/anon/authenticated and grants EXECUTE only to service_role, all within
   one transaction. It does not grant new table privileges or rewrite any row.
5. Apply `002_atomic_kv.sql` as one transaction using the approved migration
   channel. `003_server_only_kv_permissions.sql` explicitly supplies service_role
   CRUD for new installations, and removes existing anon/authenticated grants.
   Do not remove RLS or create a permissive policy to silence the no-policy INFO
   advisor: the application intentionally accesses this table server-side only.
6. Verify capabilities and ACLs read-only, then deploy application code. A missing
   RPC must produce a clear migration-required response **before any write**.
   Never fall back from atomic restore to `clearAllData` plus sequential inserts.
7. Test registration, backup round-trip, timeout/constraint-failure rollback and
   concurrent writers on a separate test database. Do not use real passwords or
   user records in test fixtures. Then rerun advisors and review production health.

## RPC contract, version 1

- `moontv_kv_capabilities()` → JSON object containing `api_version: 1`,
  `atomic_restore`, `atomic_registration`, and `snapshot` booleans. Read-only.
- `moontv_snapshot_kv(p_table text)` → `[{key, value}]`, ordered by key from one
  SQL/MVCC snapshot, not independently paginated SELECTs. Server-only output can
  contain credentials and must be encrypted in the application's backup flow.
- `moontv_restore_kv(p_table text, p_rows jsonb)` → inserted row count. Rejects
  malformed/duplicate keys and backups without exactly one object-valued
  `admin:config`. The application must still validate the full backup schema,
  ownership, encryption and size before calling. JSON `null` values remain valid.
  A `SHARE ROW EXCLUSIVE` table lock serializes the replacement with ordinary
  writes; reads continue against committed snapshots. DELETE+INSERT are in one
  transaction. An error or server-side timeout rolls them both back. A **network
  timeout is an unknown outcome**, not proof of rollback; do not automatically
  retry a destructive restore because that could erase intervening writes.
- `moontv_register_user(p_table, p_expected_config, p_next_config, p_username,
p_password_hash)` → boolean. False means configuration CAS conflict and no
  credential insertion. True means both membership and password committed. A
  duplicate credential fails and rolls back the membership update. The server
  remains responsible for registration-open checks, username validation and
  building the next configuration. Do not send cleartext passwords.

The deployed table allowlist is **only `public.moontv_kv`**. The `p_table` argument
is retained for the application contract, but every other value is rejected,
including other public tables. Identifiers are also safely quoted. A custom
`SUPABASE_KV_TABLE` needs a separately reviewed adjustment to this migration and
the permission migration; it is not implicitly allowed.
All calls retain the caller's table privileges/RLS. No SECURITY DEFINER function
or PUBLIC execution privilege is introduced.

## Operational caveats

- Full restore is intentionally replacement, not a merge. Schedule it for a quiet
  period. Writes completed before its lock are replaced; writers after it commits
  can change the restored state. A failed RPC leaves the previous state intact.
- Backup snapshots are materialized in database/application memory. Existing API
  size limits still apply; benchmark large backups in staging before production.
  Do not raise database-wide timeouts or memory settings without evidence.
- Restoring old password/session metadata must not reactivate revoked cookies.
  The application should invalidate prior sessions at restore time rather than
  blindly restoring an older revocation timestamp.
- Existing primary and prefix indexes are sufficient for current equality/prefix
  KV reads. Do not add a broad JSONB GIN index or normalize every row without
  actual query-plan/size evidence. Most identified races are application-level
  CAS/transaction problems, not missing indexes.

## Rollback

Revert application code that calls these RPCs **before** removing them. Dropping
the following functions is schema-only; it does not undo any successfully
completed restore or registration:

```sql
begin;
drop function if exists public.moontv_kv_capabilities();
drop function if exists public.moontv_snapshot_kv(text);
drop function if exists public.moontv_restore_kv(text, jsonb);
drop function if exists public.moontv_register_user(text, jsonb, jsonb, text, text);
notify pgrst, 'reload schema';
commit;
```

Do not automatically re-grant broad anon/authenticated rights when rolling back.
Any ACL rollback requires separate approval and the actual recorded before-state.
Recovery from a **successful unwanted restore** requires the verified backup;
transaction rollback only protects failed operations.

## Local SQL regression

PGlite 0.5.11 is pinned as a development dependency in the lockfile. After the
normal frozen-lockfile install, run all three local SQL regression suites:

```sh
pnpm test:sql
```

An optional `PGLITE_MODULE` absolute path can select a local PGlite build for
specialized debugging; ordinary development and CI use the repository dependency.
CI also runs `pnpm test:transport` on Node 22 to exercise actual local TCP/TLS
sockets against the pinned transport. After the production build, the mandatory
`pnpm test:built-transport` gate exercises authenticated local image/playlist/Range
requests and downstream cancellation through the built application. These tests
use synthetic local fixtures and do not contact production.

This uses an in-memory local PostgreSQL engine with synthetic data only. It
checks ACLs, invalid-input/no-side-effect behavior, post-DELETE insertion failure
rollback, registration CAS/duplicate rollback, snapshot and safe identifiers.
It does **not** validate PostgREST deployment behavior or true multi-connection
lock contention; those need a disposable full PostgreSQL/Supabase environment.

References: [Supabase backups](https://supabase.com/docs/guides/platform/backups),
[explicit API grants change](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically).

## Separate migration 004: atomic user deletion

`004_atomic_delete_user.sql` installs one additional function, requiring its own
explicit approval; approval for the original four functions does not cover it.
Installation changes no application row and does not delete any account.

`moontv_delete_user(p_table text, p_expected_config jsonb, p_next_config jsonb,
p_username text, p_expected_credential jsonb)` returns boolean. It is bound to
`public.moontv_kv`, SECURITY INVOKER, empty search_path, EXECUTE only service_role.
The application must authorize the administrator and protect the environment
owner before calling it; SQL also refuses a configured `owner` target.

The expected configuration must contain exactly one target. The next configuration
must equal the **raw database snapshot** with only that user's membership removed,
not a runtime-default-enriched config. The expected credential must be the whole
stored JSON value (legacy string or new credential+revocation object), not only
its hash. SQL/JSON null represents an absent credential for orphan cleanup.

The function acquires a write-intent table lock, then locks the config and
credential rows in registration-compatible order. Both expected values must
match or it returns false without modifying rows. It deletes only the exact
`u:<username>:` namespace and updates membership in the same transaction. A failure
in either step rolls everything back. Literal-prefix matching avoids `_` or `%`
acting as SQL wildcards. A new registration's salted credential prevents a stale
second deletion from deleting a same-name replacement account even if its config
has the same shape. Never automatically retry after an unknown network outcome.

Deploy the atomic-delete caller only after this migration is verified. A missing
function must fail clearly before any fallback staged deletion. To remove the
function after reverting the calling application:

```sql
begin;
drop function if exists public.moontv_delete_user(text, jsonb, jsonb, text, jsonb);
notify pgrst, 'reload schema';
commit;
```

This schema rollback does not recover an account from a successfully authorized
future deletion. Recovery still requires an actually verified backup; this audit
did not establish one. Local SQL tests cover stale config/credentials, ordered
A-delete/re-register/B-delete interleaving, missing credentials, owner rejection,
namespace isolation and post-delete config-write rollback. These are deterministic
single-engine interleavings, **not** a real concurrent multi-connection test.

## Separate migration 005: new-registration session generation

`005_registration_session_generation.sql` replaces the existing
`moontv_register_user(text, jsonb, jsonb, text, text)` body, preserving its boolean
return, table allowlist, CAS/transaction guarantees and service-only EXECUTE ACL.
It requires separate approval from the original installation. It does not invoke
registration, rewrite old credentials, or alter existing account rows.

Future calls insert `{hash, revokedBefore}` instead of a bare password-hash
string. `hash` is the application's exact supplied freshly salted hash;
`revokedBefore` is database wall-clock milliseconds. The new application derives
an opaque session version from username, its own generated hash and an optional
credential generation nonce. It must not obtain a newer concurrent password
reset's hash to mint a registration cookie. The database timestamp is metadata,
not a reason to adopt another request's session generation.

New registration/password-change input must always be hashed with fresh random
salt, even if the supplied plaintext resembles a stored PBKDF2 string. Only
backup-import normalization may preserve pre-existing hashes. Restore adds a
fresh random generation nonce even when the imported hash is unchanged, so an
old cookie cannot become valid again. Old bare-string credentials remain readable
by the application; this migration does not perform a bulk format conversion.

Apply and verify 005 before enabling the new registration caller. To roll back
schema behavior, restore only the original registration function body and ACL
from migration 002 (not the entire old migration). This affects only future
registrations and does not convert envelopes already created. Any application
rollback must retain compatibility with existing object credentials; reverting
to code that blindly treats every credential as a string can break logins.

## Follow-up: replace inherited service-role table grants

PostgreSQL default privileges can grant `service_role` ALL privileges on newly
created tables. A later `GRANT SELECT` or `GRANT ... CRUD` is additive; it does
not narrow those existing privileges. The phase-two fresh-install scripts now
explicitly revoke service-role table privileges before granting their intended
subset. Anonymous/authenticated denial and RLS remain unchanged.

Existing installations must apply the separately reviewed
`20261026125455_narrow_service_table_privileges.sql`, not rerun the old CREATE
TABLE migrations. It replaces service-role privileges on exactly three tables:

- `moontv_mutation_control`: SELECT only.
- `moontv_mutation_state` and `moontv_rate_buckets`: SELECT, INSERT, UPDATE, DELETE.

The correction changes no rows, RLS, function definitions/EXECUTE rights,
activation flag, schema default privileges, or existing `moontv_kv` privileges.
It is transactional and safe to reapply, but production ACL changes still require
explicit approval. Do not restore broad ALL grants as an automatic rollback.

`pnpm test:sql` reproduces default ALL grants before fresh installation and checks
all eight PostgreSQL table privileges, including MAINTAIN. The existing-install
regression checks exact grants, service-role operations, unchanged data/RLS/KV
ACLs, public denial, and idempotent reapplication using synthetic local data.
