# 第一批修復驗證紀錄

本頁保留第一批的測試快照；第二階段另見 [追加實作與驗證界限](2026-10-26-phase-two.md)。

基準 main：`997caa806da0e5d889fe6e5dd9e7709a1961ccd9`。
本機工作分支：`fix/audit-correctness-20261026`。
程式驗證時最新程式 commit：`90fd2d8`（後續僅補本驗證文件；遠端 head 與 CI 以 PR 為準）。

## 已執行

| 檢查                                          | 結果                                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------ |
| 完整 Jest `--runInBand`                       | **117 suites／814 tests 通過**                                                       |
| TypeScript `tsc --noEmit --incremental false` | 通過                                                                                 |
| `eslint --max-warnings=0 src`                 | 通過                                                                                 |
| Next.js production build                      | 通過（Node 24 本機；CI 另使用 Node 22）                                              |
| `pnpm audit --json`                           | 0 info／low／moderate／high／critical；lockfile 未修改                               |
| release workflow Node 測試                    | 3 通過                                                                               |
| changelog/version generation Node 測試        | 1 通過；版本同步檢查通過                                                             |
| upstream proposal safety Python 測試          | 6 通過                                                                               |
| SQL 本機 PGlite 合成測試                      | 27 通過：CAS、交易回滾、帳號 ABA、namespace、ACL、重複套用、generation               |
| 獨立 diff 審閱                                | 審閱提出 cancellation、刪帳號重入及重註冊 session 復活三項阻擋，均修復後重新審閱通過 |
| `git diff --check`                            | 通過                                                                                 |

## HTTP 執行期 smoke（不連接 production DB）

使用 production standalone build、合成固定密碼、強制 localstorage、空 Supabase 連線設定與臨時 localhost port：

- `POST /api/login`：200、簽章 cookie。
- 帶 cookie `GET /`：200。
- 帶 cookie `GET /api/search/resources`：200，回傳來源清單。
- 帶 cookie、未允許的彈幕 API 路徑：404，未轉送。
- 無 cookie `GET /api/search/resources`：401。

另核對沒有 PASSWORD 時仍依原 middleware 導向 `/warning`，沒有新增匿名模式。測試後停止本機服務。

## DB 驗證界限

公開測試使用本機合成資料驗證五個 RPC（capabilities、snapshot、restore、register、delete）、invoker／空 search_path、service-only EXECUTE、固定 `public.moontv_kv` 與 ACL。部署前應依 migration runbook 核對實際環境，保留 RLS 及必要 service CRUD，確認安裝前後筆數一致。

SQL 回滾、帳號 generation 與 ABA 測試不代表已做 production 交易壓力測試；不要在真實資料庫執行測試性帳號刪除、改密碼或還原。特定環境的批准、安裝與資料盤點紀錄應保存在私有操作紀錄，不隨公開 PR 發布。

## 尚未驗證或仍需決策

- 尚未完成真瀏覽器／實機完整影音解碼、分離音軌、quota 極限、輔助科技與多連線 DB 故障演練。
- F09 未知傳輸最後落盤順序／跨裝置一致性，以及 F21 分散限流／DNS-to-socket pinning，仍是明列的部分修復，不以此分支宣稱全站零漏洞。
- MAP/fMP4／非 AES-128 下載明確報不支援；播放器與原始預取保留。
- 完整 F01–F23 處置、相容策略與回退限制見同目錄 `2026-10-26-repair-disposition.md`。
- 此紀錄不授權 main 合併或 production 應用部署；Draft PR 的遠端精確 SHA 與 CI 還須核對。
