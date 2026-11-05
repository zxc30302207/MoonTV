# Upstream proposal — review required

**MANUAL INTEGRATION REQUIRED — report only; no upstream code applied.**

- Previously integrated: `f6256a1f46dff80e121e7dce6521faffc535db84`
- Proposed upstream: `0c484a9227cdc3db3436eb2cc52815240ccd1a05`
- Compare: https://github.com/Stardm0/MoonTV/compare/f6256a1f46dff80e121e7dce6521faffc535db84...0c484a9227cdc3db3436eb2cc52815240ccd1a05

Three-way application conflicted. All partial changes were discarded; custom code and the integrated base are unchanged.

Review every custom feature and security boundary before merging. Never merge this proposal automatically.

## Required verification

Run typecheck, strict lint, tests, dependency audit and production build on the exact reviewed commit. Check Vercel preview and desktop/mobile playback.

PRs created by GITHUB_TOKEN may not trigger pull_request CI. A maintainer must manually dispatch the existing CI workflow on this branch (Actions → CI → Run workflow), then verify checks belong to the exact commit. No PAT or extra secret is required.

## Changed upstream paths

```json
[
  "src/app/watch-room/page.tsx",
  "src/components/WatchRoomPanel.tsx",
  "src/lib/watch-room/client.ts",
  "src/lib/watch-room/service.ts",
  "src/lib/watch-room/types.ts"
]
```
