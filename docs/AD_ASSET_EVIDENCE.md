# Verified asset refresh: 2026-10-22

## Reproduction and root cause

Public source `mdzy`, title 李熊猫, id `87089`, episode 4:
`https://play.modujx17.com/20260805/PNZBa1cp/962kb/hls/index.m3u8`.

The existing filter is active but returns zero: this source supplies no CUE markers and the exact verified asset registry still contains older 2026-09-17 sequences. The current inserted asset is a different 2026-10-09 path/filename sequence. The user's screenshot at 12:29 shows programme animation, not an advertisement; this investigation separately established advertisements later in the captured playlist.

Captured media playlist: 610 segments, 1232.567 seconds. The same six-segment asset occurs twice:

- 1144.411–1162.051 seconds (19:04.411–19:22.051).
- 1214.927–1232.567 seconds (20:14.927–20:32.567).

All six downloaded segment samples show gambling promotion: the first three show a live-action presenter with gambling-brand/domain overlays, the final three show slot-game/app-download promotion. The last segment's trailing frame still shows the promotion. The immediately preceding and following programme samples show anime closing credits; both remain intact. Only this 17.64-second asset and two neighbouring programme segments were sampled; no full episode was downloaded.

## Exact identity and evidence

Prefix: `/20261009/Bjf6z0RU/10152kb/hls/`. SHA-256 values below describe the **downloaded media bytes**, retained as audit evidence. The runtime rule currently matches the complete ordered path/duration sequence, not the hashes; it does not fetch/decode arbitrary media at playback time.

| File        | Seconds | SHA-256                                                          |
| ----------- | ------: | ---------------------------------------------------------------- |
| 6JFnQsqe.ts |       3 | 96e9600a8fe4ac391aca30ca833ea03e9c11918efa798412878be84aa3be534f |
| WfGR4xIS.ts |       3 | 6db18de33f28e7d8e7b113105f188ed21546f4ed148e7e14b71ce5f9a2a649f0 |
| KMplaxXV.ts |       5 | deef326e10da2b128fa06e4e0c0c525b6c1347128d2d9544649b4e9409d4c063 |
| 0ONtLMnT.ts |       3 | 68f41c7cd0f55c6b7356f99caa0067680d21a3320497edc0ceb930f3b153994a |
| auT4G7cp.ts |       3 | 8b77da79334f2a16bc5c9705ca6101a73a06521091af98510648c402ddaf8f91 |
| j2XNBmNk.ts |    0.64 | d506ab7d33382ae8e6fe23cfcfbff5b0f1dd7531f2d4f50fc6c42246ca9fde04 |

## Candidate behavior

On the actual captured playlist: remove 12 segments / 35.28 seconds; retain 598 segments / 1197.287 seconds (19:57.287). Both adjacent programme URIs and ENDLIST remain. The matcher is not tied to source name, title, episode or fixed timestamps: other sources reusing the exact verified assets are covered, including rotated CDN hosts and query strings.

Negative tests preserve missing, reordered, renamed, other-path and timing-mismatched sequences, as well as an all-ad playlist that would otherwise be emptied. Existing encryption/init/byte-range/timeline protections remain. The nine-source cleanup from base commit `fa31ae6be7dc027814306794a4f20ca638a58dd6` is unchanged.

## Limits

This is a verified asset refresh, not a classifier for every new advertising creative. An unrelated 17.64-second clip, minority folder, new domain, discontinuity or high bitrate is not sufficient evidence and is not removed. Future asset rotation requires new evidence; in-place replacement at the same paths remains an upstream identity risk. Screenshots/media are not committed. Zero/initial status now reads “已啟用”, actual removal reads “已移除 35.3 秒”, and disabled reads “已關閉”. Episode/source switches reset stale removal statistics. None of these labels claims that all advertisements are absent.

## Second source: 360 four-segment packaging

A separate retained source (`zy360`) exposes the same gambling creative packaged differently at `/20261008/2DExGZYA/hls/`. All four segment first frames were independently viewed: two promotional live-action frames, then two slot-machine/app-promotion frames. The entire exact ordered sequence is required, independently of CDN host. Observed in public metadata/manifests for 李熊猫 (id102493, episode 4), 芝加哥烈焰第十五季 (id107336, episode 1), and 芝加哥警署第十四季 (id107335, episode 1), twice each. This is not an inference that other uninspected clips are ads.

| File        | Seconds | Downloaded sample SHA-256                                        |
| ----------- | ------: | ---------------------------------------------------------------- |
| wTYCABLc.ts |       5 | 10c16f6d283eecf35c6039e563416b5e0e90b78aa7a9f5f7c387fad41c8a8790 |
| HJKFKNWX.ts |       5 | 40e4cec5064589ce982f65565b35924ac800bbbb270b4a2b43d14e882d94bb19 |
| tem9H9Vu.ts |       5 | d3c77ab4d82ddfb79b8e554cb9f196d7c69cd14bbadec088b677823028ad56a3 |
| Y2VXzNPO.ts |   2.567 | aa6dee5a33278734eba6eb3f775faa361fcd23c2ec2d09b32eaa7511d8113ba4 |

For 李熊猫 the observed windows are 136.200–153.767 and 1214.927–1232.494 seconds; 8 segments / 35.134 seconds removed. The same positive, partial-sequence, reorder, rename, unrelated-path, timing-mismatch, empty-playlist and encryption-preservation regression cases run against both newly verified families.

The final ad segment was additionally checked at 2.2 seconds (still gambling promotion). The immediately preceding and following programme segments show the continuing animated scene. On all three captured 360 playlists, every retained programme URI, ordering and active AES key/explicit IV state are identical before/after filtering; ENDLIST and idempotence also hold.

## Follow-up: byte-identical six-segment alias

Separately from the two-family release, the public mdzy id9299 (超人回来了), first playback entry labeled 第 20240102 期, contains four inserted copies under `/20261009/pjEiiKbZ/10152kb/hls/` on play.modujx12.com (master: `https://play.modujx12.com/20240627/Ejgb80Bs/index.m3u8`). Exact ordered files: `nahMNf8r.ts`, `ZFz9RQeM.ts`, `cHqkizsC.ts`, `jYruJ6ZL.ts`, `7j1ossEx.ts`, `ZTQzdtRR.ts`; durations `[3,3,5,3,3,0.64]`. Each downloaded file is byte-for-byte identical to its corresponding Bjf6z0RU sample above (all six SHA-256 values match). All six first frames and the last segment at 0.5 seconds were also viewed. The captured windows start at 74.673, 2001.995, 2779.038 and 3717.550 seconds; each is 17.64 seconds, totaling 24 segments / 70.56 seconds.

**Important preservation limit:** immediately adjacent before/after frames show a continuing programme car scene with a burned-in gambling sponsor text overlay. These are programme, not separate inserted ads, and are retained unchanged. A playlist segment-removal filter cannot erase those pixels without removing or modifying programme footage; this patch makes no such claim and does not trim those scenes. All exact-sequence positive and negative tests also run for this alias, without widening to arbitrary sibling paths or duration-only matches.

## Reviewed Maoyan source addition and three-segment insertion compatibility

This follow-up recognizes only `/20260818/JMQDkGOL/hls/` with ordered `9OG1QJKR.ts` (5s), `Dgaf3EqV.ts` (5s), `Nr4MRgx5.ts` (3.2s). All three bounded TS samples were decoded and their 2-fps contact sheets viewed; the final segment was checked again at 3.08 seconds and at its exact last decoded video frame (frame index 95 of 96); both still show gambling promotion. Adjacent programme before/after are the same continuing animation scene and subtitle. Sample SHA-256 values in order: `e24b4ef6af87dc9698bef61cd864c2e9d5b6bc921e6209eb423b40ae1216f5cf`, `9534b2cd87e7e239920f3d07747839c74fd76857912d75fce0ec94b2e49ca89c`, `577a60247d16a842175f27ddbe16c9a89f6f96eea8c01fa6c9a0d07b6c4d13b2`.

Captured candidate source samples: 李熊猫 id157485, 第 04 集, media `https://play.maoyanplay.top/20260805/t3HFUELH/2201kb/hls/index.m3u8`, contains two 13.2-second inserts beginning at 690.697 and 1249.916 seconds (26.4s total); 流浪地球 id123736 contains the same complete sequence nine times (118.8s total). Exact-sequence negatives and encryption/init-state regression tests apply to this family as well. Source metadata may have incorrect year fields; that is not ad evidence.

The combined release candidate adds Maoyan with explicit user approval, increasing configured sources from 14 to 15 while preserving all 14 existing source entries and their saved switches. Source addition and the narrow ad-filter compatibility patch have been reviewed together; production playback validation is still pending. No host-wide or bitrate/duration-only deletion was introduced.
