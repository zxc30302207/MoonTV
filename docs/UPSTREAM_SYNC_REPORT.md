# Upstream proposal — review required

**MANUAL INTEGRATION REQUIRED — report only; no upstream code applied.**

- Previously integrated: `e4c0732cf907a1ae4e0bf1d0d446b7c8aeea2234`
- Proposed upstream: `c5ba812f33efbcc1485e52160861621995c48aee`
- Compare: https://github.com/Stardm0/MoonTV/compare/e4c0732cf907a1ae4e0bf1d0d446b7c8aeea2234...c5ba812f33efbcc1485e52160861621995c48aee

Three-way application conflicted. All partial changes were discarded; custom code and the integrated base are unchanged.

Review every custom feature and security boundary before merging. Never merge this proposal automatically.

## Required verification

Run typecheck, strict lint, tests, dependency audit and production build on the exact reviewed commit. Check Vercel preview and desktop/mobile playback.

PRs created by GITHUB_TOKEN may not trigger pull_request CI. A maintainer must manually dispatch the existing CI workflow on this branch (Actions → CI → Run workflow), then verify checks belong to the exact commit. No PAT or extra secret is required.

## Changed upstream paths

```json
[
  "src/app/play/play-utils.ts",
  "src/app/play/usePlayEngine.ts",
  "src/lib/ad-filter.ts",
  "src/lib/m3u8-downloader.ts",
  "src/lib/video-prefetcher.ts"
]
```
