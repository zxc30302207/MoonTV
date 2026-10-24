<div align="center">

<img src="docs/assets/moontv-cinema.webp" alt="月光映照銀幕般的地平線，透明膠卷在夜空中延展；MoonTV 原創品牌概念圖，非產品截圖。" width="100%" />

# MoonTV

**波波的秘密基地 · 把搜尋、收藏與觀影，留在自己的空間。**

一個可自行部署的影視搜尋與播放介面。<br />
在 MoonTV 上游基礎上，延伸繁體中文體驗、Supabase 儲存與細緻的存取管理。

**Next.js 15** · **React 18** · **TypeScript** · **Tailwind CSS**

[開始部署](#開始部署) · [功能導覽](#功能導覽) · [本機開發](#本機開發) · [更新與維護](#更新與維護)

</div>

---

## 一個入口，接續你的觀影日常

**找得到。** 聚合已設定的來源，支援繁簡搜尋與來源篩選。<br />
**接著看。** 收藏、播放紀錄與追更集中管理，搭配豆瓣評分及短評。<br />
**自己掌握。** 站點、帳號、來源與授權由管理者配置，不把部署交給黑盒。

> 本專案提供搜尋與播放介面，不內建、託管或分發影片檔案。來源須由部署者確認可合法使用；實際可用性、畫質與速度取決於來源及網路環境。

## 功能導覽

| 使用情境       | 這個分支提供的體驗                                                                            |
| :------------- | :-------------------------------------------------------------------------------------------- |
| **搜尋與發現** | 多來源搜尋、繁簡文字匹配、來源篩選及可調搜尋併發；簡介請求去重與快取。                        |
| **收藏與追更** | 播放紀錄、收藏、追更與今日更新；使用 Supabase 時由伺服器保存帳號資料。                        |
| **播放與彈幕** | 選集、進度預覽、截圖、手機手勢、預取與快取管理；彈幕密度及手動來源設定。                      |
| **外部播放器** | 支援 PotPlayer、VLC、MPV、MX Player、nPlayer、IINA 等開啟方式，需裝置已安裝對應播放器。       |
| **站點與權限** | `/admin` 管理使用者、來源、分組與分類；卡密驗證的獨立授權區由伺服器檢查權限，不只是隱藏入口。 |
| **日常操作**   | 繁體中文介面、鍵盤可操作的卡片與篩選、手機導覽；搭配豆瓣短評及受權限控管的 TVBox 設定。       |

### 保留客製，而不停止更新

目前整合上游 **v4.7.0**。本分支保留 Supabase KV、繁體介面、授權隔離、簽名彈幕代理與安全防護，同時持續增量整合上游。

- **版本提示是真的檢查。** 同版顯示已更新；上游有新版本仍會提示，檢查失敗不偽裝成最新。
- **私人資料有邊界。** 登入使用簽名 HttpOnly Cookie；私人 API 採不快取策略，寫入與代理請求另有驗證。
- **過濾以保留正片為先。** HLS 僅移除可可靠辨識的廣告標記或已核實素材，不承諾所有來源都能去廣告。[了解判定原則](docs/AD_FILTER_PRECISION.md)

詳見 [v4.7.0 整合紀錄](docs/UPSTREAM_UPDATE.md)與[歷次相容紀錄](docs/UPSTREAM_COMPATIBILITY.md)。

## 開始部署

推薦組合：**Vercel + Supabase**。程式由 Vercel 執行，帳號與站點資料使用 Supabase KV 表保存。

### 01 · 準備資料庫

建立 Supabase 專案，在 SQL Editor 執行本專案的[初始化 SQL](migrations/supabase/001_moontv_kv.sql)。保留表格的 RLS 設定；資料存取由伺服器端金鑰處理。

### 02 · 匯入 GitHub 專案

Fork 本倉庫，在 Vercel 匯入自己的 Fork，選擇 **Next.js**，使用 **Node.js 22**。套件管理器使用專案指定的 **pnpm 10.14.0**，安裝時保留 lockfile。

### 03 · 設定環境變數並部署

在 Vercel 專案設定中填入下列值，再建立部署：

| 變數                          | 用途／設定值                       |
| :---------------------------- | :--------------------------------- |
| `NEXT_PUBLIC_STORAGE_TYPE`    | `supabase`                         |
| `SUPABASE_URL`                | 你的 Supabase 專案 URL             |
| `SUPABASE_SECRET_KEY`         | 伺服器端 secret key，**不可公開**  |
| `USERNAME`                    | 自訂管理員帳號                     |
| `PASSWORD`                    | 自訂高強度管理員密碼，**不可省略** |
| `NEXT_PUBLIC_SITE_NAME`       | 自訂站名，例如 `波波的秘密基地`    |
| `NEXT_PUBLIC_ENABLE_REGISTER` | 私人站點建議設為 `false`           |

> **金鑰只放在部署平台的環境變數或本機 `.env.local`。** 不要提交到 Git、貼進 README，或加上 `NEXT_PUBLIC_` 前綴。Preview 建議連接獨立測試資料庫，避免測試寫入正式資料。

部署完成後，以管理員帳號登入並前往 `/admin`，檢查來源、註冊設定與帳號權限。

**[閱讀完整部署指南 →](docs/DEPLOYMENT.md)**<br />
包含環境變數、彈幕後端、定時工作、來源設定與部署後驗收。

## 本機開發

使用 **Node.js 22** 與 **pnpm 10.14.0**。將上方環境變數寫入未追蹤的 `.env.local`；開發與測試請使用獨立資料庫。

```bash
git clone https://github.com/zxc30302207/MoonTV.git
cd MoonTV
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

開啟 `http://localhost:3000`。若在自己的 Fork 開發，請將 clone URL 換成自己的倉庫。

<details>
<summary><strong>提交前檢查與目錄導覽</strong></summary>

```bash
corepack pnpm check:version
corepack pnpm typecheck
corepack pnpm lint:strict
corepack pnpm test --runInBand
corepack pnpm build
```

| 路徑                                         | 內容                         |
| :------------------------------------------- | :--------------------------- |
| [`src/app`](src/app)                         | 頁面、路由與 API             |
| [`src/components`](src/components)           | 共用介面與播放器元件         |
| [`src/lib`](src/lib)                         | 儲存、搜尋、權限與播放邏輯   |
| [`scripts`](scripts)                         | 版本、執行設定及維護工具     |
| [`migrations/supabase`](migrations/supabase) | Supabase 初始化 SQL          |
| [`docs`](docs)                               | 部署、上游整合與過濾規則紀錄 |

</details>

## 更新與維護

**更新提示、整合提案、正式部署是三件不同的事。** 看到上游更新，不代表客製功能已完成相容整合。

1. **先備份。** 保存資料庫、站點設定與目前可回復的程式版本；不要用清空資料庫處理升級問題。
2. **看增量。** 依 [上游基準](.github/upstream-base.txt) 比較變動，保留客製功能與來源停用狀態，避免整個覆蓋上游。
3. **走審查。** [上游提案工作流程](.github/workflows/upstream-sync.yml)僅建立草稿 PR，不會自動合併。Fork 使用者需先啟用 Actions 並確認工作流程權限。
4. **驗證後發布。** 通過型別、lint、測試及正式建置，再檢查 Preview 的登入、搜尋、播放與授權隔離；確認後才合併正式分支。

Vercel 若已將 `main` 設為 Production Branch，合併會觸發正式部署。請以部署狀態與實際驗收為準，不把「已合併」當成「已上線」。

<details>
<summary><strong>版本檔案與回復方式</strong></summary>

版本資訊由 `CHANGELOG` 產生；修改後執行 `corepack pnpm gen:version`，再以 `corepack pnpm check:version` 校驗並一併提交。CI 僅驗證同步，不會直接寫入 `main`。

需要回復時，回退程式提交或選用先前 Vercel 部署；資料庫另行備份與評估，不隨程式回退清空。建置成功亦不保證所有第三方來源或播放器可用。

</details>

## 致謝與使用邊界

本分支延續 [Stardm0/MoonTV](https://github.com/Stardm0/MoonTV) 的上游工作，並保留原始專案的授權與版權聲明。感謝 MoonTV 原作者及所有開源貢獻者。

- 程式碼採用 **[MIT License](LICENSE)**；原版權聲明為 **Copyright (c) 2025 LunaTechLab**。
- 軟體授權不等於取得影片、海報、字幕、評論或其他第三方資料的使用權。
- 請只接入有權使用的來源，遵守所在地法律、資料來源條款及部署平台規範；不得用於侵權傳播。
- 本專案依 MIT 條款按現狀提供，不保證第三方服務的穩定性或內容正確性。

<div align="center">

<sub>MoonTV · 自己的站點，自己的觀影節奏。</sub>

</div>
