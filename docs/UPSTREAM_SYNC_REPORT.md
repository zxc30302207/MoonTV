# 觀影室上游相容整合（2026-11-10）

- 接續既有草稿 PR #18，在原提案分支整合，不合併 main 或部署正式服務。
- 上游範圍：`f6256a1f46dff80e121e7dce6521faffc535db84...0c484a9227cdc3db3436eb2cc52815240ccd1a05`。
- 採用五個觀影室檔案的三方增量差異；同步標記前進至 `0c484a9227cdc3db3436eb2cc52815240ccd1a05`，版本仍為 4.8.0。

## 整合內容

- 新房間預設 20 人，建立時可設定 1–100 人；舊房間沒有 maxMembers 時不新增功能性限制，既有儲存安全上限仍適用。
- 明確加入自己的持久房間，不在切換影片時自動啟用；加入、讀取與重試有明確狀態。
- 房主多分頁共用在線席位，離線接管持久化 hostId，離開單一分頁不立即註銷其他分頁；大廳跳轉共用成員快取。
- 房間卡片依即時 presence 顯示人數，手機按鈕與人數設定排版同步更新。
- 修補上游過期成員的容量漏洞：超過在線時限的舊成員必須重新檢查容量，不能利用較長的元資料時限擠入已滿房間。

## 客製與安全邊界

保留簽名登入、帳號綁定及身分切換隔離、同源 POST、來源／成人權限、邀請連結驗證、繁體介面與 Supabase 整體快照 CAS。未採用上游程序層房間清單／人數快取，避免跨帳號或交易快取。未修改去廣告、來源設定、私人 API 或資料庫架構。容量檢查和成員新增仍由既有交易原子提交。在既有 100 成員硬上限下，房主離線時最多容納 99 位其他成員，保留房主回歸席位，不踢人也不放寬儲存邊界。舊自動進房與重複快取實作已由上游設計取代。

## 驗證

以 Node 22 / pnpm 10.14.0、凍結鎖檔安裝驗證：

- TypeScript、strict lint 零警告、完整 Jest 133 套件／962 測試通過。
- production build、SQL 61 項、TCP/TLS 4 項、上游同步 6 項、版本／workflow 5 項與版本一致性通過。
- 實際本機 production proxy 七項 smoke checks 通過（登入隔離、圖片轉址、M3U8 重寫、Range、取消與協定限制）。
- production dependency audit 無已知漏洞。全依賴 audit 有一項既有開發依賴 `@svgr/webpack > @svgr/plugin-svgo > deepmerge` 低風險公告，無可用修補版： https://github.com/advisories/GHSA-gcqx-w48m-w2h4 。未為此無關開發工具改動鎖檔。
- 新測試涵蓋容量／舊房間／過期成員、滿房房主回歸、多分頁、離線接管、即時人數、帳號冒用、快取失效，以及載入／重試／登出後過期回應與重複點擊。

真實雙人播放、正式 Supabase、Vercel 預覽與桌面／手機畫面尚未驗收，不將編譯或模擬測試視為完成上線驗收。未合併 main。

---

## 先前已整合紀錄

# MoonTV 4.8.0 相容整合（2026-11-05）

- 正式分支基準：`d195edd30b8eb64ee35d87039dfe81d53c4537f1`
- 接續既有 PR #15：`8466a458d5da20291f9a7b96582c9da6fce93dfa`，不重複建立相同範圍提案。
- 新增上游範圍：`d25cef49bd0f45b3f6a36c8f5cf22f3370610662...f6256a1f46dff80e121e7dce6521faffc535db84`，10 個提交、28 個路徑。
- 同步標記與版本前進至上述 SHA／4.8.0；涵蓋自動提案 #16/#17，未自動關閉或合併其他 PR。

## 整合與保留

採三方增量套用，非整檔覆蓋。保留 Supabase、簽名 HttpOnly 登入、來源與成人權限、私人 API、不可信網址防護、自訂導航、繁體介面、安全去廣告及播放世代隔離。

- 新觀影室：房間、聊天、播放同步、成員同步模式及即時人數。補上本分支登入及儲存相容性，避免使用上游未簽名 cookie 或 serverless 程序記憶體當永久儲存。
- 導覽：整合拖曳排序、順序儲存與溢出捲動，保留自訂分類、精確路由高亮、手機箭頭與無障礙。
- TVBox：採用上游回傳結構檢查，保留明確密碼要求；不採用未提供密碼時自動填入伺服器 PASSWORD 的行為。
- 今日更新與 Bangumi：既有嚴格驗證、簽名登入、safeFetch 和私人快取比上游更完整，保留客製版本。上游變動為 unknown 型別／日誌清理，不以寬鬆字串轉換取代既有驗證。
- 延續 PR #15 彈幕季數與分片重試修正。仍不採用上游媒體尺寸／URL／短片段推測刪除廣告，以免誤刪正片。

## 驗證與限制

本次以 Node 22.23.0／pnpm 10.14.0 驗證。正式資料庫沒有遷移、資料清空或部署；D1 初始化檔只補充上游新表的建表定義，不執行 SQL。

- 觀影室在 Supabase 模式使用既有 server-only KV 表，透過 revision 比對重試，原子保存房間／聊天／在線狀態，設定遺失時不降級成程序記憶體。
- 此版本以小型私人部署為目標：最多 100 個房間、每房最多 100 位成員、單一狀態最多 4 MiB；整體快照 CAS 不適用大型公開服務。localstorage 沒有帳號身分，因此介面會說明需使用 Supabase 帳號登入。
- 已通過 production build、typecheck、production dependency audit、SQL 61 項、TCP/TLS 4 項、上游同步 6 項、版本與 workflow 5 項；完整 Jest 131 個套件、923 項測試全部通過，lint:strict 零警告。
- 本機 production build 的 7 項實際代理驗證通過，包括未登入拒絕、synthetic 登入、圖片轉址、M3U8 URL 重寫、Range 分片、取消連線及不合法協定。
- Supabase CAS 有模擬用戶端回歸測試，未連接正式 Supabase 驗證；未進行真實雙人瀏覽器播放／同步驗收，不把編譯或模擬通過當作完成上線驗收。

---

## 先前 PR #15 整合紀錄

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
