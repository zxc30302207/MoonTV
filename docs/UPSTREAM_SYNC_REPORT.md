# Upstream proposal — review required

**MANUAL INTEGRATION REQUIRED — report only; no upstream code applied.**

- Previously integrated: `4641419363b8b9daaf1bfd89231d86d57121cec7`
- Proposed upstream: `9a0e6e2edf78a301959945d91bec851adb593798`
- Compare: https://github.com/Stardm0/MoonTV/compare/4641419363b8b9daaf1bfd89231d86d57121cec7...9a0e6e2edf78a301959945d91bec851adb593798

Three-way application conflicted. All partial changes were discarded; custom code and the integrated base are unchanged.

Review every custom feature and security boundary before merging. Never merge this proposal automatically.

## Required verification

Run typecheck, strict lint, tests, dependency audit and production build on the exact reviewed commit. Check Vercel preview and desktop/mobile playback.

PRs created by GITHUB_TOKEN may not trigger pull_request CI. A maintainer must manually dispatch the existing CI workflow on this branch (Actions → CI → Run workflow), then verify checks belong to the exact commit. No PAT or extra secret is required.

## Changed upstream paths

```json
[
  "d1-init.sql",
  "src/app/api/bangumi/calendar/route.ts",
  "src/app/api/today-updated/route.ts",
  "src/app/api/tvbox/categories/route.ts",
  "src/app/api/watch-room/route.ts",
  "src/app/globals.css",
  "src/app/page.tsx",
  "src/app/play/PlayClient.tsx",
  "src/app/play/play-utils.ts",
  "src/app/play/usePlayEngine.ts",
  "src/app/watch-room/page.tsx",
  "src/components/EpisodeSelector.tsx",
  "src/components/MobileBottomNav.tsx",
  "src/components/NavScrollContainer.tsx",
  "src/components/TopNav.tsx",
  "src/components/UserOnlineUpdate.tsx",
  "src/components/WatchRoomPanel.tsx",
  "src/components/useDragScroll.ts",
  "src/lib/ad-filter.ts",
  "src/lib/config.client.ts",
  "src/lib/danmaku.client.ts",
  "src/lib/m3u8-downloader.ts",
  "src/lib/nav-settings.ts",
  "src/lib/segment-media-probe.ts",
  "src/lib/video-cache.ts",
  "src/lib/video-prefetcher.ts",
  "src/lib/watch-room/client.ts",
  "src/lib/watch-room/d1-store.ts",
  "src/lib/watch-room/service.ts",
  "src/lib/watch-room/store.ts",
  "src/lib/watch-room/types.ts"
]
```
