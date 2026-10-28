# MoonTV 上游增量整合（涵蓋提案 #10 與 #12）

- Previously integrated: `4641419363b8b9daaf1bfd89231d86d57121cec7`
- Proposed upstream: `d25cef49bd0f45b3f6a36c8f5cf22f3370610662`
- 上游差異：https://github.com/Stardm0/MoonTV/compare/4641419363b8b9daaf1bfd89231d86d57121cec7...d25cef49bd0f45b3f6a36c8f5cf22f3370610662
- 同步標記：`.github/upstream-base.txt` 前進到上述上游提交。下一次 upstream-sync 以此為「previously integrated」。

`26c7aa9bff420f1aa92270c726905081f1bc5a20`（草稿 #10）是 `d25cef49bd0f45b3f6a36c8f5cf22f3370610662`（草稿 #12，也是目前上游 main）的祖先。兩者之間上游只再改了彈幕季數解析。以目前 main 的已整合基準 `46414193` 三方套用，範圍就是 #12 列出的 7 個路徑；#10 多出來的版本、榜單與導覽檔案已在 PR #9 整合過。本提案涵蓋 #10 與 #12 的上游範圍。未合併、未關閉這兩個草稿。

## 衝突與處理

三方套用在下列檔案產生衝突。`src/lib/ad-filter.ts` 在本分支已刪除，上游對它的修改無法套用；`src/lib/segment-media-probe.ts` 是這次新增、只服務該刪除規則的檔案。

### `src/lib/danmaku.client.ts`（採用上游行為，保留客製文案）

衝突是簡體引號／錯誤文案，以及 `extractSeasonFromTitle`。保留繁體錯誤訊息與既有簽名代理、取消與結果隔離。季數解析改為：

- 中文數字一到九十九，含簡體「两」與繁體「兩」
- 「第 X 季／期／部」、`2nd Season`、有邊界的 `Season`／`Sxx`
- 「第二季 S1E1」以中文季數為準，不再被尾端 `S1` 蓋掉
- `Transformers 2` 這類單字結尾的 `s` 不再誤判成季數

### `src/lib/video-prefetcher.ts`（只移植斷流重試）

播放列表衝突：上游在 `parseM3U8` 打開 `probeMediaProfile`。本分支改走同源 `/api/m3u8/filter`，並保留登入 cookie、`X-MoonTV-Upstream-URL` 與 `blockAd` 對齊。不把預取改回上游的 `dropAds` 直連解析。

分片讀取衝突：回應主體讀到一半丟出的 `TypeError` 改成可重試的一般錯誤，同一路徑先重試，不立刻標 `noRetry` 改走代理。`fetch` 本身的 CORS／DNS `TypeError`、401／403／404／410、截止時間與取消流程維持原樣。

### `src/app/play/play-utils.ts`、`src/lib/m3u8-downloader.ts`、`src/lib/video-cache.ts`（保留本分支）

上游這三處以及 `ad-filter.ts`、新檔 `segment-media-probe.ts` 是同一套「結構特徵 + 分片 SPS 畫面尺寸」刪除：

- 廣告 URL 特徵或短塊即刪
- 被較長內容夾住的短塊即刪
- 讀取分片頭，畫面尺寸或幀率與多數塊不同即刪
- 再與上述規則取聯集

這和本分支「只刪已驗證素材或有可靠邊界的明確廣告標記」不相容。畫面尺寸不同、短片段、路徑字樣都不是充分證據，可能刪到正片、片頭片尾或多段轉碼。播放器仍用 `filterAdsFromM3U8WithStats`、世代隔離與已過濾代理報告；下載仍用呼叫端的 `transformPlaylist`，不讀任意分片頭。不恢復 `ad-filter.ts`，不加入 `segment-media-probe.ts`，也不在快取層增加只為該探測服務的讀頭函式。

## 明確保留

繁體介面、Supabase、來源設定、成人授權、簽名登入、同源寫入、SSRF 與私人回應策略、已驗證廣告素材與 cue 邊界、KEY／MAP／BYTERANGE、去廣告偏好均未改。無資料庫遷移或正式服務操作。版本號仍為 4.7.5；這兩個上游提交沒有改 `VERSION.txt` 或 `CHANGELOG`。
