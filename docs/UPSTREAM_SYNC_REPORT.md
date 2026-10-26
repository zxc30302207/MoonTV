# Upstream proposal — review required

**MANUAL INTEGRATION REQUIRED — report only; no upstream code applied.**

- Previously integrated: `e4c0732cf907a1ae4e0bf1d0d446b7c8aeea2234`
- Proposed upstream: `26c7aa9bff420f1aa92270c726905081f1bc5a20`
- Compare: https://github.com/Stardm0/MoonTV/compare/e4c0732cf907a1ae4e0bf1d0d446b7c8aeea2234...26c7aa9bff420f1aa92270c726905081f1bc5a20

Three-way application conflicted. All partial changes were discarded; custom code and the integrated base are unchanged.

Review every custom feature and security boundary before merging. Never merge this proposal automatically.

## Required verification

Run typecheck, strict lint, tests, dependency audit and production build on the exact reviewed commit. Check Vercel preview and desktop/mobile playback.

PRs created by GITHUB_TOKEN may not trigger pull_request CI. A maintainer must manually dispatch the existing CI workflow on this branch (Actions → CI → Run workflow), then verify checks belong to the exact commit. No PAT or extra secret is required.

## Changed upstream paths

```json
[
  "CHANGELOG",
  "VERSION.txt",
  "src/app/play/play-utils.ts",
  "src/app/play/usePlayEngine.ts",
  "src/app/ranking/page.tsx",
  "src/components/MobileBottomNav.tsx",
  "src/lib/ad-filter.ts",
  "src/lib/changelog.ts",
  "src/lib/m3u8-downloader.ts",
  "src/lib/segment-media-probe.ts",
  "src/lib/version.ts",
  "src/lib/video-cache.ts",
  "src/lib/video-prefetcher.ts"
]
```
