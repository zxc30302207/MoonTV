# Versioned namespace protocol (phase two)

## Install and explicit activation

`20261026100735_namespace_mutations.sql` is a **dormant schema installation**.
It creates no application records and changes no existing `moontv_kv` values.
It adds two tables: `moontv_mutation_control` (one disabled flag), and
`moontv_mutation_state` (at most four namespace states per live account).
Both have RLS enabled, no anonymous/authenticated policies or grants.
`service_role` gets SELECT on control and SELECT/INSERT/UPDATE/DELETE on state.
There is no client-facing API key change, new credential, supplier or subscription.

It adds four SECURITY INVOKER functions with empty search_path:

- `moontv_namespace_guard()` (trigger only).
- `moontv_prepare_namespace(text,text,text,boolean)` (internal lock/state helper).
- `moontv_read_namespace(text,text,text,boolean)` (atomic data/version snapshot).
- `moontv_mutate_namespace(text,text,text,uuid,bigint,uuid,text,text,jsonb,boolean)`.

EXECUTE is revoked from PUBLIC/anon/authenticated and granted to service_role.
The boolean owner argument is supplied only by the server after exact comparison
with the configured environment owner. It is never accepted from an HTTP client.
This supports an owner intentionally absent from persisted credentials/config.
All functions remain restricted to `public.moontv_kv` and the four named user
namespaces. Service-role privileges remain a trusted server boundary.

The migration installs one BEFORE INSERT/UPDATE/DELETE trigger on `moontv_kv`,
and replaces the existing restore/register/delete function bodies without
changing their signatures or ACLs. Their existing validation and transactions
remain. Registration/deletion adopt the shared per-user lock order; deletion
and restore use a transaction-local guard marker and discard affected version
states so subsequent reads get fresh epochs. Password changes do not change
namespace epochs. New credential INSERT or DELETE also invalidates state.

Obtain approval for this exact schema/ACL scope and a separate cutover before
applying. Verify metadata and that the flag is false after installation.
Deploy/test the compatible application, then execute the explicit activation
transaction in `tests/namespace-activation.sql` during a quiet cutover.
The new versioned endpoints fail closed while disabled. At activation the
relation lock drains old writes and rotates any previously used version states;
thereafter old instances cannot bypass ordering. The activation uses transaction-local
5-second lock and 15-second statement deadlines; timeout rolls the entire cutover
back without changing the enforcement state.
This can briefly make collection writes unavailable during rollout. Do not claim
zero downtime. No silent compatibility mode remains once active.

## Concurrency and cost

Every RPC acquires a ROW EXCLUSIVE relation lock (compatible with other normal
writers, but incompatible with full restore), then a per-user transaction
advisory lock, then a namespace state row lock. Different accounts can proceed
concurrently. One account's namespace requests serialize, including its cron
refresh and lifecycle operations. Full restore retains its existing stronger
relation lock; it is not added to every request. Hash collisions can only cause
extra serialization, never identity confusion, because all row access still uses
exact username/namespace keys.

GET aggregates one namespace plus its version under the same locks. A regular
record mutation is an exact-key write plus small state updates; it does not scan
or serialize the entire playback history. Search history is capped at 20 entries.
Mutations increment a decimal-string bigint revision, retaining only the latest
operation UUID, SHA-256 request fingerprint, and result version summary.
Repeating that exact latest operation is a no-op. A reused UUID with different
arguments is rejected. An older retry after another committed operation returns
conflict and is not replayed. Namespace clear keeps its tombstone/version.
Unknown network outcome must retain the original operation/version; never mint
a new operation and blindly replay it against a freshly fetched version.

Cron/refresh updates use versions attached to the original server-side read.
They do not fetch a fresh version for stale data. A conflict skips that refresh;
there is no max-timestamp merge or resurrection after unfollow/delete/recreate.
Records from one snapshot share a cursor advanced only by successful writes from
that snapshot, allowing a sequential cron refresh without making later devices'
updates disappear. Legacy direct managed writes are rejected by the DB guard.
The dangerous staged `deleteUser` and `clearAllData` storage methods now refuse
before any write; callers must use reviewed atomic lifecycle functions.

## Verification and rollback

Run local synthetic SQL tests:

    node migrations/supabase/tests/namespace-mutations.mjs

These cover dormant failures, ACL/RLS, legacy-writer rejection, exact retries,
stale writes, tombstones, namespace isolation, history behavior, marker cleanup,
transaction rollback, restore generation rotation, delete/re-register, owner
compatibility and password-change stability. PGlite is a single engine: it is
not evidence of real multi-connection contention, PostgREST behavior, or production
restore validation. Never execute a destructive restore on real data as a test.

A rollback to phase-one code while the guard stays active will fail managed
writes. Disabling enforcement explicitly gives up the ordering guarantee and
requires a reviewed operational decision. Do not silently disable the trigger or
flag on errors. A rollback must retain the phase-one credential envelope reader;
very old application versions cannot safely read newly created credentials.
Dropping schema objects is not a recovery of successfully changed user data.
Any destructive recovery still requires an actually verified backup.
