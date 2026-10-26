# Upstream proposal — review required

**MANUAL INTEGRATION REQUIRED — report only; no upstream code applied.**

- Previously integrated: `4641419363b8b9daaf1bfd89231d86d57121cec7`
- Proposed upstream: `d25cef49bd0f45b3f6a36c8f5cf22f3370610662`
- Compare: https://github.com/Stardm0/MoonTV/compare/4641419363b8b9daaf1bfd89231d86d57121cec7...d25cef49bd0f45b3f6a36c8f5cf22f3370610662

Three-way application conflicted. All partial changes were discarded; custom code and the integrated base are unchanged.

Review every custom feature and security boundary before merging. Never merge this proposal automatically.

## Required verification

Run typecheck, strict lint, tests, dependency audit and production build on the exact reviewed commit. Check Vercel preview and desktop/mobile playback.

PRs created by GITHUB_TOKEN may not trigger pull_request CI. A maintainer must manually dispatch the existing CI workflow on this branch (Actions → CI → Run workflow), then verify checks belong to the exact commit. No PAT or extra secret is required.

## Changed upstream paths

```json
[
  "src/app/play/play-utils.ts",
  "src/lib/ad-filter.ts",
  "src/lib/danmaku.client.ts",
  "src/lib/m3u8-downloader.ts",
  "src/lib/segment-media-probe.ts",
  "src/lib/video-cache.ts",
  "src/lib/video-prefetcher.ts"
]
```
