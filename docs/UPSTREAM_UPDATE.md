# MoonTV 4.6.0 update

This update integrates upstream v4.6.0 and subsequent improvements through commit `12a4b9a50849b350846acebecc58af72e55f8a9b`.

## Highlights

- Mobile player gestures, queued notices, improved seeking and quality selection.
- Cache scheduling improvements, optional navigation auto-hide, and on-demand descriptions.
- Existing custom interface, playback options, source preferences, subtitles, comments, and storage integration retained.
- Dependency maintenance, request lifecycle improvements, and additional regression coverage.
- Upstream automation now creates draft proposals for review instead of changing the default branch directly. Conflicting updates require manual integration. Execution logs are retained.

## Validation

- Node 22, pnpm 10.14, Next.js 15.5.28.
- Type checking, strict lint, formatting, and production build passed.
- 79 Jest suites / 534 tests and 6 isolated upstream proposal tests passed.
- Isolated local HTTP smoke checks passed. Browser playback checks are separate deployment verification.

Review each future proposal and run CI on its exact commit before merging. Token-created proposals may require manual CI dispatch. No automatic merge is configured.
