# Upstream proposal — review required

**MANUAL INTEGRATION REQUIRED — report only; no upstream code applied.**

- Previously integrated: `0c484a9227cdc3db3436eb2cc52815240ccd1a05`
- Proposed upstream: `5e61c5dd98545fbcf210974ea8d1ad57a7033574`
- Compare: https://github.com/Stardm0/MoonTV/compare/0c484a9227cdc3db3436eb2cc52815240ccd1a05...5e61c5dd98545fbcf210974ea8d1ad57a7033574

Three-way application conflicted. All partial changes were discarded; custom code and the integrated base are unchanged.

Review every custom feature and security boundary before merging. Never merge this proposal automatically.

## Required verification

Run typecheck, strict lint, tests, dependency audit and production build on the exact reviewed commit. Check Vercel preview and desktop/mobile playback.

PRs created by GITHUB_TOKEN may not trigger pull_request CI. A maintainer must manually dispatch the existing CI workflow on this branch (Actions → CI → Run workflow), then verify checks belong to the exact commit. No PAT or extra secret is required.

## Changed upstream paths

```json
[
  "src/components/AddDownloadModal.tsx",
  "src/components/DownloadManager.tsx",
  "src/lib/download-directory.ts",
  "src/lib/m3u8-downloader.ts",
  "src/lib/stream-saver-fallback.ts"
]
```
