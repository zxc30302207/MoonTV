<div align="center">
  <img src="./public/readme-banner.svg" alt="波波的秘密基地 MoonTV README banner" width="100%" />

  <h1>波波的秘密基地</h1>

  <p>
    一個偏私人、偏好用、偏不想浪費時間的 MoonTV 分支。
    搜片、追劇、換源、外部播放器、豆瓣短評、成人授權卡，全都收進同一個中控台。
  </p>

  <p>
    <img alt="Next.js" src="https://img.shields.io/badge/Next.js-15.5-000?logo=nextdotjs" />
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-4.9-3178c6?logo=typescript" />
    <img alt="Tailwind CSS" src="https://img.shields.io/badge/Tailwind_CSS-3.4-38bdf8?logo=tailwindcss" />
    <img alt="Supabase ready" src="https://img.shields.io/badge/Supabase-ready-3ecf8e?logo=supabase" />
    <img alt="Vercel" src="https://img.shields.io/badge/Vercel-auto_deploy-000?logo=vercel" />
    <img alt="License" src="https://img.shields.io/badge/License-MIT-22c55e" />
  </p>
</div>

## 這是什麼

這不是原版 README 的換皮版。這個分支的重點是把 MoonTV 變成一個更像「私人影音基地」的東西：

- 搜得到：多個 Apple CMS V10 片源聚合搜尋，支援來源篩選與後台管理。
- 播得順：內建網頁播放器，支援 HLS、換源、播放記錄、收藏、跳過片頭片尾。
- 接得出去：可把目前影片丟給 PotPlayer、VLC、MPV、MX Player、nPlayer、IINA 等外部播放器。
- 看得明白：豆瓣資訊與短評接到播放頁，沒有短評時不假裝成功。
- 管得住：成人推薦需要管理員授權卡，不讓未授權帳號誤觸。
- 放得穩：Vercel + Supabase 是主推部署路線，也保留 Docker、Redis、Upstash、D1 等選項。

本專案不內建影片、不儲存影片、不提供任何影片檔。它只是搜尋、整理與播放第三方來源資訊的前端與服務端工具。

## 目前這個分支加了什麼

| 模組        | 說明                                                                       |
| ----------- | -------------------------------------------------------------------------- |
| 成人授權卡  | 管理員可生成日、周、月、年、永久卡號；普通用戶無卡時無法載入成人推薦 API。 |
| 成人推薦頁  | `/adult` 獨立頁，支援來源篩選與下拉載入更多。                              |
| 豆瓣短評    | 播放頁可載入豆瓣短評，遇到反爬或失敗會顯示重試，不再誤報零評論。           |
| 外部播放器  | 播放頁可用常見播放器 URL scheme 啟動本機或手機播放器。                     |
| Supabase KV | 可用 Supabase 作為雲端儲存，適合 Vercel 部署。                             |
| 片源補齊    | 預設片源更新後，DB 內舊設定可補齊缺少的預設源。                            |

## 快速開始

需要：

- Node.js 20+
- pnpm 10+
- 一份 `.env.local`

```bash
corepack enable
corepack pnpm install
corepack pnpm dev
```

正式 build：

```bash
corepack pnpm build
corepack pnpm start
```

常用驗證：

```bash
corepack pnpm test --runInBand
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm build
```

## Vercel + Supabase 部署

這是目前最推薦的部署方式。Vercel 負責跑 Next.js，Supabase 負責保存用戶、收藏、播放記錄、後台設定與授權卡。

### 1. 準備 Supabase

在 Supabase SQL Editor 執行：

```sql
-- migrations/supabase/001_moontv_kv.sql
create table if not exists public.moontv_kv (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists moontv_kv_key_prefix_idx
  on public.moontv_kv (key text_pattern_ops);

alter table public.moontv_kv enable row level security;
```

然後到 Supabase 專案設定拿到：

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` 或新版 `SUPABASE_SECRET_KEY`

只把 service role/secret key 放在 Vercel 環境變數，不要放到前端公開變數，也不要 commit。

### 2. 設定 Vercel 環境變數

最小可用配置：

```env
NEXT_PUBLIC_STORAGE_TYPE=supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
USERNAME=admin
PASSWORD=your-admin-password
NEXT_PUBLIC_SITE_NAME=波波的秘密基地
```

可選配置：

```env
NEXT_PUBLIC_ENABLE_REGISTER=false
NEXT_PUBLIC_SEARCH_MAX_PAGE=5
NEXT_PUBLIC_DISABLE_YELLOW_FILTER=true
NEXT_PUBLIC_DOUBAN_PROXY_TYPE=direct
NEXT_PUBLIC_DOUBAN_IMAGE_PROXY_TYPE=server
NEXT_PUBLIC_DANMU_API_BASE_URL=
```

推送 `main` 後，Vercel 會自動部署。

### 3. 從 Upstash 搬到 Supabase

如果你之前已經用 Upstash，先在 `.env.local` 同時放入 Upstash 與 Supabase 變數，先 dry-run：

```bash
node scripts/migrate-upstash-to-supabase.mjs --dry-run
```

確認內容無誤後再搬：

```bash
node scripts/migrate-upstash-to-supabase.mjs
```

## 管理員玩法

後台路徑：

```text
/admin
```

你可以在後台做這些事：

- 站點配置：站名、公告、快取時間、豆瓣代理、TVBox、黃色內容過濾開關。
- 用戶配置：新增用戶、封禁、管理員、分組、來源權限。
- 成人授權卡：生成卡號，期限可選日、周、月、年、永久。
- 視頻源配置：新增、停用、排序、批量管理片源。
- 分類配置：自訂電影/劇集分類入口。
- 數據遷移：在支援的儲存後端間搬資料。

## 成人內容鎖

成人推薦不是只在前端藏起來，而是 API 層也會擋。

流程：

1. 管理員進 `/admin`。
2. 打開「用戶配置」。
3. 在「成人授權卡」選擇期限並生成卡號。
4. 把卡號給已確認年齡的用戶。
5. 用戶進 `/adult` 輸入卡號後才會載入成人內容。

行為：

- 站長與管理員不需要卡號。
- 普通用戶必須持有效卡號。
- 授權卡只能使用一次。
- 刪除授權卡會移除該卡帶來的授權。
- 未授權請求 `/api/adult/recommends` 會得到 `403`。
- 成人 API 使用 `private, no-store`，避免快取洩漏。

## 片源格式

MoonTV 使用標準 Apple CMS V10 API。`config.json` 裡的片源長這樣：

```json
{
  "api_site": {
    "example": {
      "api": "https://example.com/api.php/provide/vod",
      "name": "示例資源",
      "detail": "https://example.com"
    }
  }
}
```

要求：

- `api` 需要能回應 `?ac=videolist`。
- `key` 不要重複。
- 成人源會透過內部白名單識別，只在黃色過濾器允許且用戶授權時展示。
- 建議先在後台新增少量測試源，確認搜尋、詳情、播放都正常再批量加入。

## 播放與外部播放器

播放頁提供：

- 線上播放。
- 換源與選集。
- 收藏與播放記錄。
- 豆瓣短評。
- 複製播放網址。
- 外部播放器啟動。

支援的外部播放器：

| 平台         | 播放器              |
| ------------ | ------------------- |
| Windows      | PotPlayer、VLC、MPV |
| macOS        | IINA、VLC、MPV      |
| Android      | MX Player、VLC      |
| iOS / iPadOS | nPlayer、VLC        |

如果瀏覽器或系統不允許 URL scheme，仍可使用「複製播放網址」。

## TVBox

後台可開啟 TVBox 介面，生成配置地址與訪問密碼。

常見設定：

```text
/api/tvbox/config?un=...
```

TVBox 端需要帶上後台生成的 `x-tvbox-password` 或使用後台提供的完整配置地址。

## 儲存後端

| 後端            | 適合場景             | 備註                              |
| --------------- | -------------------- | --------------------------------- |
| Supabase        | Vercel 長期部署      | 目前推薦，配置清楚，資料好搬。    |
| Upstash Redis   | 已有 Redis KV 的部署 | 可用，但本分支目前主推 Supabase。 |
| Redis / Kvrocks | 自架 Docker          | 適合自己控伺服器的人。            |
| Cloudflare D1   | Cloudflare Pages     | 需要走 Pages 兼容配置。           |
| localstorage    | 純前端體驗           | 不支援完整雲端用戶與管理能力。    |

## 專案結構

```text
src/app            Next.js App Router 頁面與 API
src/components     共用 UI 組件
src/lib            搜尋、播放、配置、儲存、授權邏輯
public             靜態資產與 PWA 檔案
migrations         Supabase / D1 初始化 SQL
scripts            runtime、manifest、資料遷移工具
config.json        預設片源與分類種子
```

## 常用指令

| 指令                             | 用途                    |
| -------------------------------- | ----------------------- |
| `corepack pnpm dev`              | 本機開發                |
| `corepack pnpm build`            | 產生正式版              |
| `corepack pnpm lint`             | ESLint                  |
| `corepack pnpm typecheck`        | TypeScript 檢查         |
| `corepack pnpm test --runInBand` | Jest 測試               |
| `corepack pnpm gen:runtime`      | 重新生成 runtime config |
| `corepack pnpm gen:manifest`     | 重新生成 PWA manifest   |

## 安全提醒

- 一定要設定 `PASSWORD`。
- 公網部署時建議關閉註冊：`NEXT_PUBLIC_ENABLE_REGISTER=false`。
- Supabase service role key 只能放在服務端環境變數。
- 成人內容必須由管理員確認後發卡，不要開放匿名存取。
- 不要把未知來源的動態腳本接進核心播放流程。
- 本專案不提供、內建或儲存任何影片資源。

## 致謝

本分支基於 MoonTV / LunaTV 生態的既有成果繼續改造。感謝原作者與相關開源專案：

- Next.js
- Tailwind CSS
- ArtPlayer
- HLS.js
- Supabase
- danmu_api

## License

[MIT](LICENSE)
