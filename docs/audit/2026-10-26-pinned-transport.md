# Scoped outbound DNS pinning

## Scope and behavior

Only Node-side `safeFetch` callers use this transport: image and M3U8 proxies,
subscription import, and Bangumi requests. Browser fetching, Next's global fetch,
Supabase, and other application requests are not replaced.

Each hop parses and validates the URL, resolves all candidate addresses once,
rejects an empty/unsafe set, and passes a copied set to a dedicated Undici Agent.
The socket's lookup callback can return only those addresses and rejects a
hostname mismatch. Node's family autoselection can try approved IPv4/IPv6
candidates, but cannot perform a second DNS lookup. Literal IPs are validated
before reaching the transport. Existing explicitly configured private-network
allowance remains explicit; it does not disable pinning or TLS checks.

Requests retain their original hostname, signed query ordering/encoding, and
Range headers. TLS uses the original hostname for SNI and certificate hostname
verification, with `rejectUnauthorized: true`. Each redirect is resolved and
validated again, redirect bodies are cancelled, and cross-origin redirects drop
Authorization, Proxy-Authorization, cookies and Referer. Host headers are derived
from the URL rather than caller input. Only GET/HEAD without a request body are
supported; all current callers are read-only.

A total 60-second default deadline covers DNS, redirect hops and streamed body;
callers can supply a bounded deadline up to 300 seconds. Existing shorter caller
signals still apply. Connection timeout is 10 seconds, headers/body inactivity
limits are 30 seconds. Downstream cancellation, caller abort, EOF and errors
release the per-request dispatcher. Disposal does not await a potentially stalled
body cancellation. Callers that discard non-success responses cancel their body.

There is no global dispatcher mutation, insecure fetch fallback, certificate
verification bypass or environment-proxy fallback. Deployments that require an
outbound forward proxy need a separately validated pinned connector; this direct
transport will fail rather than delegate DNS to an unverified proxy.

## Runtime compatibility

Undici is now a production dependency at the already-locked version 8.12.3.
It requires Node >=22.19.0. The application engines range is >=22.19.0 <23, and all
Docker stages use Node 22 Alpine with the declared pnpm 10.14.0. This avoids an unbounded range selecting a
future major release on Vercel. No live project settings are changed by these
files. Vercel selects major versions and updates their minor/patch versions:
https://vercel.com/docs/functions/runtimes/node-js/node-js-versions

## Local verification

The local TCP/TLS harness also passed on the minimum Node 22.19.0 runtime.

- `node node_modules/jest/bin/jest.js src/lib/url-safety.test.ts --runInBand`
  tests unsafe literals/DNS answers, same-host rebinding between redirects,
  signed URL and Range preservation, redirect credential stripping, redirect
  body cancellation, bounded stalled DNS and abort propagation.
- `node --test scripts/pinned-fetch.test.cjs` runs actual local TCP/TLS sockets
  against the checked-in transport. It proves an otherwise-unresolvable hostname
  reaches only the pinned loopback test address, retains Host/query/Range,
  ignores a deliberately failing global dispatcher and closes on cancellation.
  A temporary self-signed fixture is rejected by default. A fresh child process
  trusts only that test CA to prove correct-host TLS success while a different
  hostname is rejected. The fixture CA is never installed or persisted.

- `node scripts/pinned-proxy-build-smoke.cjs` runs the completed Next production
  build on loopback with synthetic localstorage authentication and a controlled
  fixture server. It passed under Node 22.19.0: anonymous requests are blocked
  before upstream traffic, login issues a working cookie, redirected images
  retain exact bytes, redirected playlists resolve signed relative segments
  correctly, Range returns exact 206 bytes/metadata, downstream abort closes
  the actual upstream connection, and non-HTTP targets are rejected. It refuses
  dotenv files and never uses production credentials. Private-network allowance
  is set only in this local test child to reach its loopback fixtures.

These tests do not prove Vercel networking, Alpine image execution, actual
third-party source availability, or browser video decode. Before promotion,
verify the exact preview build and Node runtime, one authorized image/playlist
request including redirects and a Range segment, plus cancellation. Do not
claim complete production compatibility from mocked API tests or anonymous
401 responses. If preview transport is blocked, do not silently fall back to
un-pinned fetch; diagnose it before rollout.

## Rollback

This transport has no database migration and adds no credentials. Reverting it
restores the former DNS check/connect race and is not a security-equivalent
fallback. Prefer a forward fix; do not downgrade unrelated credential-generation
or mutation-version changes when isolating a transport issue.
