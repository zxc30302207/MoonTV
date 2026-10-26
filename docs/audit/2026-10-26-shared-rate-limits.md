# Shared rate limits

## Deployment order and compatibility

Apply `migrations/supabase/20261026100617_shared_rate_limits.sql` before deploying the application. This migration is prepared, not proof of production execution. It creates an empty server-only table, expiry index and one RPC; it does not read or modify `moontv_kv` or user data. The application uses this RPC whenever `NEXT_PUBLIC_STORAGE_TYPE=supabase`. Missing migration, credentials, malformed response, timeout or database error returns HTTP 503 with a 30-second Retry-After, never a local allowance. Existing localstorage installations retain process-local limits only; they are not distributed-safe.

Each governed request makes one no-store POST to the existing Supabase Data API, without automatic retry. The RPC atomically inserts/increments a fixed-window counter using the database clock and saturates at limit+1. Limits are fixed inside the RPC, not supplied by request callers:

- login: 10/minute
- register: 5/minute
- image-proxy: 300/minute
- m3u8-parse and m3u8-filter: 60/minute
- m3u8-proxy (GET segments): 1200/minute, preserving the existing limit

A lost RPC response may consume one token and returns 503. The next request does not receive an extra allowance. This intentionally trades availability for enforcement. Additional database writes, latency and usage apply, particularly images and media segments. It is not a DDoS shield and does not replace platform-level protections. Fixed-window boundaries can admit bursts across adjacent windows.

## Permissions requiring deployment approval

- Create `public.moontv_rate_buckets(scope, subject_hash, count, reset_at)` with composite primary key and expiry index, RLS enabled and no public policies.
- Revoke table privileges from PUBLIC, anon and authenticated; grant SELECT, INSERT, UPDATE, DELETE only to existing service_role.
- Create SECURITY INVOKER `public.moontv_consume_rate_limit(text,text)` with empty search_path and 1-second lock timeout, fixed scopes and fixed table.
- Revoke function EXECUTE from PUBLIC, anon and authenticated; grant EXECUTE only to service_role.
- No credentials, extensions, paid scheduler, grants on other tables, or public exposure are created.

## Subject privacy and trusted ingress

The server hashes scope+client IP with HMAC-SHA256 using the existing server-only PASSWORD; raw IPs are not persisted. Hashes are pseudonymous, not a guarantee of anonymity. Password rotation changes the namespace and effectively resets current limits.

On Vercel only `x-vercel-forwarded-for` is trusted when VERCEL=1. The official request-header documentation states that Vercel overwrites X-Forwarded-For to prevent spoofing and describes x-vercel-forwarded-for as the equivalent platform header, unlike a proxy-overwritten X-Forwarded-For. This is the documented trust model, not an observation of this production deployment; verify actual header delivery in staging before rollout. It must contain one valid IP; lists, malformed values and missing headers share the conservative `unknown` bucket. IPv6 spellings are normalized. Arbitrary X-Forwarded-For, CF and True-Client-IP headers are ignored.

Self-hosted deployments may explicitly set RATE_LIMIT_TRUSTED_IP_HEADER to a header that their trusted ingress always strips/replaces. Do not set it when clients can directly reach the app or control the header. Without that operator configuration, clients share `unknown`, which may limit legitimate aggregate traffic. No such environment or ingress security setting is automatically changed by this patch.

Reference: https://vercel.com/docs/headers/request-headers (platform overwrite behavior); https://supabase.com/docs/guides/database/functions (function permissions); https://supabase.com/docs/reference/javascript/rpc (Data API RPC).

## Cleanup and rollback

One percent of RPC calls attempt a shared advisory cleanup lock, then delete at most 1000 buckets expired more than one day ago using indexed selection and SKIP LOCKED. This is bounded opportunistic cleanup, not a strict retention SLA: idle installations retain expired hashes until traffic resumes. No user data is removed. Keep migration/table/RPC installed during application rollback. Rolling back application code removes distributed protection and must not be described as equivalent security. No destructive down migration is supplied.

## Verification boundaries

Focused Jest tests cover RPC hashing, no-cache behavior, no mutation retry, configuration failures, timeout abort, malformed responses, localstorage compatibility, trusted IP selection and fail-closed login/image routes. PGlite tests verify SQL permissions/RLS, counts, scopes, expiry, saturation and invalid inputs. PGlite is single-connection and does not establish multi-connection lock behavior, actual production latency or Vercel header delivery. Those remain deployment/staging verification requirements; no production user credentials or records are exercised.
