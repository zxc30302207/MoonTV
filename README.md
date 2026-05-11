# MoonTV(Branch)

原項目地址https://github.com/MoonTechLab/LunaTV

<div align="center">
  <img src="public/logo.png" alt="LibreTV Logo" width="120">
</div>

> 🎬 **MoonTV** 是一個開箱即用的、跨平臺的影視聚合播放器。它基於 **Next.js 14** + **Tailwind&nbsp;CSS** + **TypeScript** 構建，支持多資源搜索、在線播放、收藏同步、播放記錄、本地/雲端存儲，讓你可以隨時隨地暢享海量免費影視內容。

<div align="center">

![Next.js](https://img.shields.io/badge/Next.js-14-000?logo=nextdotjs)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-3-38bdf8?logo=tailwindcss)
![TypeScript](https://img.shields.io/badge/TypeScript-4.x-3178c6?logo=typescript)
![License](https://img.shields.io/badge/License-MIT-green)
![Docker Ready](https://img.shields.io/badge/Docker-ready-blue?logo=docker)

</div>

---

## ✨ 功能特性

- 🔍 **多源聚合搜索**：快速返回結果。
- 📄 **豐富詳情頁**：支持劇集列表、演員、年份、簡介等完整信息展示。
- ▶️ **流暢在線播放**：集成 HLS.js & ArtPlayer。
- 📥 **視頻下載**：支持 M3U8 視頻下載，多線程並發加速，邊下邊存功能（Chrome/Edge）。
- ❤️ **收藏 + 繼續觀看**：支持 Redis/Upstash 存儲，多端同步進度。
- 📱 **PWA**：離線緩存、安裝到桌面/主屏，移動端原生體驗。
- 🌗 **響應式佈局**：桌面側邊欄 + 移動底部導航，自適應各種屏幕尺寸。
- 🚀 **極簡部署**：一條 Docker 命令即可將完整服務跑起來，或免費部署到 Vercel、Netlify、cloudflare。
- 👿 **智能去廣告**：自動跳過視頻中的切片廣告（實驗性）
- 💬 **彈幕支持**：以[danmu_api](https://github.com/huangxd-/danmu_api)為後端, 需自行部署

### 注意：部署後項目為空殼項目，無內置播放源，需要自行收集，需要彈幕請自行部署後端

<details>
  <summary>點擊查看項目截圖</summary>
  <img src="public/screenshot1.png" alt="項目截圖" style="max-width:600px">
</details>

## 🗺 目錄

- [MoonTV(Branch)](#moontvbranch)
  - [✨ 功能特性](#-功能特性)
    - [注意：部署後項目為空殼項目，無內置播放源，需要自行收集，需要彈幕請自行部署後端](#注意部署後項目為空殼項目無內置播放源需要自行收集需要彈幕請自行部署後端)
  - [🗺 目錄](#-目錄)
  - [技術棧](#技術棧)
  - [部署](#部署)
    - [Vercel 部署](#vercel-部署)
      - [普通部署（localstorage）](#普通部署localstorage)
      - [Upstash Redis 支持](#upstash-redis-支持)
    - [Netlify 部署(推薦)](#netlify-部署推薦)
      - [普通部署（localstorage）](#普通部署localstorage-1)
      - [Upstash Redis 支持](#upstash-redis-支持-1)
    - [Cloudflare 部署](#cloudflare-部署)
      - [普通部署（localstorage）](#普通部署localstorage-2)
      - [D1 支持](#d1-支持)
    - [Docker 部署](#docker-部署)
      - [直接運行（最簡單，localstorage）](#直接運行最簡單localstorage)
      - [Docker Compose](#docker-compose)
        - [local storage 存儲](#local-storage-存儲)
        - [Kvrocks 存儲（推薦）](#kvrocks-存儲推薦)
        - [Redis 存儲（有一定的丟數據風險）](#redis-存儲有一定的丟數據風險)
        - [Upstash 存儲](#upstash-存儲)
  - [環境變量](#環境變量)
  - [配置說明](#配置說明)
  - [管理員配置](#管理員配置)
  - [AndroidTV 使用](#androidtv-使用)
  - [TVBox 對接](#tvbox-對接)
    - [本地存儲(localstorage)模式](#本地存儲localstorage模式)
  - [Selene 使用](#selene-使用)
  - [安全與隱私提醒](#安全與隱私提醒)
    - [請設置密碼保護並關閉公網註冊](#請設置密碼保護並關閉公網註冊)
    - [部署要求](#部署要求)
    - [重要聲明](#重要聲明)
  - [License](#license)
  - [致謝](#致謝)
  - [⭐ Star 趨勢](#-star-趨勢)

## 技術棧

| 分類      | 主要依賴                                                                                              |
| --------- | ----------------------------------------------------------------------------------------------------- |
| 前端框架  | [Next.js 14](https://nextjs.org/) · App Router                                                        |
| UI & 樣式 | [Tailwind&nbsp;CSS 3](https://tailwindcss.com/)                                                       |
| 語言      | TypeScript 4                                                                                          |
| 播放器    | [ArtPlayer](https://github.com/zhw2590582/ArtPlayer) · [HLS.js](https://github.com/video-dev/hls.js/) |
| 代碼質量  | ESLint · Prettier · Jest                                                                              |
| 部署      | Docker · Vercel · pages                                                                               |

## 部署

本項目**支持 Vercel、Docker、Netlify、Cloudflare** 部署。

存儲支持矩陣

|               | Docker | Vercel | Netlify | Cloudflare |
| :-----------: | :----: | :----: | :-----: | :--------: |
| localstorage  |   ✅   |   ✅   |   ✅    |     ✅     |
|  原生 redis   |   ✅   |        |         |            |
| Cloudflare D1 |        |        |         |     ✅     |
| Upstash Redis |   ☑️   |   ✅   |   ✅    |     ✅     |
|   Supabase    |   ☑️   |   ✅   |         |            |

✅：經測試支持

☑️：理論上支持，未測試

### Vercel 部署

#### 普通部署（localstorage）

1. **Fork** 本倉庫到你的 GitHub 賬戶。
2. 登陸 [Vercel](https://vercel.com/)，點擊 **Add New → Project**，選擇 Fork 後的倉庫。
3. 設置 PASSWORD 環境變量。
4. 保持默認設置完成首次部署。
5. 如需自定義 `config.json`，請直接修改 Fork 後倉庫中該文件。
6. 每次 Push 到 `main` 分支將自動觸發重新構建。

部署完成後即可通過分配的域名訪問，也可以綁定自定義域名。

#### Upstash Redis 支持

0. 完成普通部署並成功訪問。
1. 在 [upstash](https://upstash.com/) 註冊賬號並新建一個 Redis 實例，名稱任意。
2. 復制新數據庫的 **HTTPS ENDPOINT 和 TOKEN**
3. 返回你的 Vercel 項目，新增環境變量 **UPSTASH_URL 和 UPSTASH_TOKEN**，值為第二步復制的 endpoint 和 token
4. 設置環境變量 NEXT_PUBLIC_STORAGE_TYPE，值為 **upstash**；設置 USERNAME 和 PASSWORD 作為站長賬號
5. 重試部署

#### Supabase 支持

0. 完成普通部署並成功訪問。
1. 在 Supabase SQL Editor 執行 `migrations/supabase/001_moontv_kv.sql`。
2. 返回 Vercel 項目，新增環境變量 **SUPABASE_URL** 和 **SUPABASE_SERVICE_ROLE_KEY**（或新版 **SUPABASE_SECRET_KEY**）。
3. 設置環境變量 NEXT_PUBLIC_STORAGE_TYPE，值為 **supabase**；設置 USERNAME 和 PASSWORD 作為站長賬號。
4. 如需從 Upstash 搬資料，先在本機 `.env.local` 放入 Upstash 與 Supabase 變量，執行 `node scripts/migrate-upstash-to-supabase.mjs --dry-run` 確認，再執行 `node scripts/migrate-upstash-to-supabase.mjs`。
5. 重試部署。

### Netlify 部署(推薦)

#### 普通部署（localstorage）

1. **Fork** 本倉庫到你的 GitHub 賬戶。
2. 登陸 [Netlify](https://www.netlify.com/)，點擊 **Add New project → Importing an existing project**，授權 Github，選擇 Fork 後的倉庫。
3. 設置 PASSWORD 環境變量。
4. 保持默認設置完成首次部署。
5. 每次 Push 到 `main` 分支將自動觸發重新構建。

部署完成後即可通過分配的域名訪問，也可以綁定自定義域名。

#### Upstash Redis 支持

0. 完成普通部署並成功訪問。
1. 在 [upstash](https://upstash.com/) 註冊賬號並新建一個 Redis 實例，名稱任意。
2. 復制新數據庫的 **HTTPS ENDPOINT 和 TOKEN**
3. 返回你的 Netlify 項目，**Project Configuration → Environment variables** 新增環境變量 **UPSTASH_URL 和 UPSTASH_TOKEN**，值為第二步復制的 endpoint 和 token
4. 設置環境變量 NEXT_PUBLIC_STORAGE_TYPE，值為 **upstash**；設置 USERNAME 和 PASSWORD 作為站長賬號
5. 重試部署

### Cloudflare 部署

**Cloudflare Pages 的環境變量盡量設置為密鑰而非文本**

#### 普通部署（localstorage）

1. **Fork** 本倉庫到你的 GitHub 賬戶。
2. 登陸 [Cloudflare](https://cloudflare.com)，點擊 **計算（Workers）-> Workers 和 Pages**，點擊創建
3. 選擇 Pages，導入現有的 Git 存儲庫，選擇 Fork 後的倉庫
4. 構建命令填寫 **pnpm run pages:build**，預設框架為無，**構建輸出目錄**為 `.vercel/output/static`
5. 保持默認設置完成首次部署。進入設置，將兼容性標志設置為 `nodejs_compat`，無需選擇，直接粘貼
6. 首次部署完成後進入設置，新增 PASSWORD 密鑰（變量和機密下），而後重試部署。
7. 如需自定義 `config.json`，請直接修改 Fork 後倉庫中該文件。
8. 每次 Push 到 `main` 分支將自動觸發重新構建。

#### D1 支持

0. 完成普通部署並成功訪問
1. 點擊 **存儲和數據庫 -> D1 SQL 數據庫**，創建一個新的數據庫，名稱隨意
2. 進入剛創建的數據庫，點擊左上角的 Explore Data，將[d1-init](d1-init.sql) 中的內容粘貼到 Query 窗口後點擊 **Run All**，等待運行完成
3. 返回你的 pages 項目，進入 **設置 -> 綁定**，添加綁定 D1 數據庫，選擇你剛創建的數據庫，變量名稱填 **DB**
4. 設置環境變量 NEXT_PUBLIC_STORAGE_TYPE，值為 **d1**；設置 USERNAME 和 PASSWORD 作為站長賬號
5. 重試部署

### Docker 部署

#### 直接運行（最簡單，localstorage）

```bash
# 拉取預構建鏡像
# 或拉取最新版本
docker pull ghcr.io/stardm0/moontv:latest

# 運行容器
# -d: 後臺運行  -p: 映射端口 3000 -> 3000
docker run -d --name moontv -p 3000:3000 --env PASSWORD=your_password ghcr.io/stardm0/moontv:latest
```

#### Docker Compose

##### local storage 存儲

```yaml
services:
  startv-core:
    image: ghcr.io/stardm0/moontv:latest
    container_name: startv-core
    restart: on-failure
    ports:
      - '3000:3000'
    environment:
      - PASSWORD=password
```

##### Kvrocks 存儲（推薦）

```yml
services:
  moontv-core:
    image: ghcr.io/stardm0/moontv:latest
    container_name: moontv-core
    restart: on-failure
    ports:
      - '3000:3000'
    environment:
      - USERNAME=admin
      - PASSWORD=admin_password
      - NEXT_PUBLIC_STORAGE_TYPE=kvrocks
      - KVROCKS_URL=redis://moontv-kvrocks:6666
    networks:
      - moontv-network
    depends_on:
      - moontv-kvrocks
  moontv-kvrocks:
    image: apache/kvrocks
    container_name: moontv-kvrocks
    restart: unless-stopped
    volumes:
      - kvrocks-data:/var/lib/kvrocks
    networks:
      - moontv-network
networks:
  moontv-network:
    driver: bridge
volumes:
  kvrocks-data:
```

##### Redis 存儲（有一定的丟數據風險）

```yml
services:
  moontv-core:
    image: ghcr.io/stardm0/moontv:latest
    container_name: moontv-core
    restart: on-failure
    ports:
      - '3000:3000'
    environment:
      - USERNAME=admin
      - PASSWORD=admin_password
      - NEXT_PUBLIC_STORAGE_TYPE=redis
      - REDIS_URL=redis://moontv-redis:6379
    networks:
      - moontv-network
    depends_on:
      - moontv-redis
  moontv-redis:
    image: redis:alpine
    container_name: moontv-redis
    restart: unless-stopped
    networks:
      - moontv-network
    # 請開啟持久化，否則升級/重啟後數據丟失
    volumes:
      - ./data:/data
networks:
  moontv-network:
    driver: bridge
```

##### Upstash 存儲

```yaml
services:
  startv-core:
    image: ghcr.io/stardm0/moontv:latest
    container_name: startv-core
    restart: on-failure
    ports:
      - '3000:3000'
    environment:
      - USERNAME=admin
      - PASSWORD=admin_password
      - NEXT_PUBLIC_STORAGE_TYPE=upstash
      - UPSTASH_URL= https 開頭的 HTTPS ENDPOINT
      - UPSTASH_TOKEN= TOKEN
```

## 環境變量

| 變量                                | 說明                                         | 可選值                                     | 默認值                                                                                                                     |
| ----------------------------------- | -------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| USERNAME                            | 非 localstorage 部署時的管理員賬號           | 任意字符串                                 | （空）                                                                                                                     |
| PASSWORD                            | 非 localstorage 部署時為管理員密碼           | 任意字符串                                 | （空）                                                                                                                     |
| NEXT_PUBLIC_SITE_NAME               | 站點名稱                                     | 任意字符串                                 | MoonTV                                                                                                                     |
| ANNOUNCEMENT                        | 站點公告                                     | 任意字符串                                 | 本網站僅提供影視信息搜索服務，所有內容均來自第三方網站。本站不存儲任何視頻資源，不對任何內容的準確性、合法性、完整性負責。 |
| NEXT_PUBLIC_STORAGE_TYPE            | 播放記錄/收藏的存儲方式                      | localstorage、redis、d1、upstash、supabase | localstorage                                                                                                               |
| REDIS_URL                           | redis 連接 url                               | 連接 url                                   | 空                                                                                                                         |
| UPSTASH_URL                         | upstash redis 連接 url                       | 連接 url                                   | 空                                                                                                                         |
| UPSTASH_TOKEN                       | upstash redis 連接 token                     | 連接 token                                 | 空                                                                                                                         |
| SUPABASE_URL                        | Supabase project URL                         | 連接 url                                   | 空                                                                                                                         |
| SUPABASE_SERVICE_ROLE_KEY           | Supabase server-side 高權限 key              | service_role 或 secret key                 | 空                                                                                                                         |
| SUPABASE_SECRET_KEY                 | Supabase 新版 server-side secret key         | secret key                                 | 空                                                                                                                         |
| SUPABASE_KV_TABLE                   | Supabase KV 表名                             | 表名                                       | moontv_kv                                                                                                                  |
| NEXT_PUBLIC_ENABLE_REGISTER         | 是否開放註冊，僅在非 localstorage 部署時生效 | true / false                               | false                                                                                                                      |
| NEXT_PUBLIC_SEARCH_MAX_PAGE         | 搜索接口可拉取的最大頁數                     | 1-50                                       | 5                                                                                                                          |
| NEXT_PUBLIC_DOUBAN_PROXY_TYPE       | 豆瓣數據源請求方式                           | 見下方                                     | direct                                                                                                                     |
| NEXT_PUBLIC_DOUBAN_PROXY            | 自定義豆瓣數據代理 URL                       | url prefix                                 | (空)                                                                                                                       |
| NEXT_PUBLIC_DOUBAN_IMAGE_PROXY_TYPE | 豆瓣圖片代理類型                             | 見下方                                     | server                                                                                                                     |
| NEXT_PUBLIC_DOUBAN_IMAGE_PROXY      | 自定義豆瓣圖片代理 URL                       | url prefix                                 | (空)                                                                                                                       |
| NEXT_PUBLIC_DISABLE_YELLOW_FILTER   | 關閉色情內容過濾                             | true/false                                 | false                                                                                                                      |
| NEXT_PUBLIC_DANMU_API_BASE_URL      | 彈幕接口地址                                 | 接口地址                                   | (空)                                                                                                                       |

NEXT_PUBLIC_DOUBAN_PROXY_TYPE 選項解釋：

- direct: 由服務器直接請求豆瓣源站
- cors-proxy-zwei: 瀏覽器向 cors proxy 請求豆瓣數據，該 cors proxy 由 [Zwei](https://github.com/bestzwei) 搭建
- cmliussss-cdn-tencent: 瀏覽器向豆瓣 CDN 請求數據，該 CDN 由 [CMLiussss](https://github.com/cmliu) 搭建，並由騰訊雲 cdn 提供加速
- cmliussss-cdn-ali: 瀏覽器向豆瓣 CDN 請求數據，該 CDN 由 [CMLiussss](https://github.com/cmliu) 搭建，並由阿裡雲 cdn 提供加速

- custom: 用戶自定義 proxy，由 NEXT_PUBLIC_DOUBAN_PROXY 定義

NEXT_PUBLIC_DOUBAN_IMAGE_PROXY_TYPE 選項解釋：

- direct：由瀏覽器直接請求豆瓣分配的默認圖片域名
- server：由服務器代理請求豆瓣分配的默認圖片域名
- img3：由瀏覽器請求豆瓣官方的精品 cdn（阿裡雲）
- cmliussss-cdn-tencent：由瀏覽器請求豆瓣 CDN，該 CDN 由 [CMLiussss](https://github.com/cmliu) 搭建，並由騰訊雲 cdn 提供加速
- cmliussss-cdn-ali：由瀏覽器請求豆瓣 CDN，該 CDN 由 [CMLiussss](https://github.com/cmliu) 搭建，並由阿裡雲 cdn 提供加速
- custom: 用戶自定義 proxy，由 NEXT_PUBLIC_DOUBAN_IMAGE_PROXY 定義

## 配置說明

如果為 localstorage 模式所有可自定義項集中在根目錄的 `config.json` 中(localstorage 模式)
非 localstorage 可在部署好的網頁中直接配置

```json
{
  "cache_time": 7200,
  "api_site": {
    "dyttzy": {
      "api": "http://caiji.dyttzyapi.com/api.php/provide/vod",
      "name": "電影天堂資源",
      "detail": "http://caiji.dyttzyapi.com"
    }
    // ...更多站點
  },
  "custom_category": [
    {
      "name": "華語",
      "type": "movie",
      "query": "華語"
    }
  ]
}
```

- `cache_time`：接口緩存時間（秒）。
- `api_site`：你可以增刪或替換任何資源站，字段說明：
  - `key`：唯一標識，保持小寫字母/數字。
  - `api`：資源站提供的 `vod` JSON API 根地址。
  - `name`：在人機界面中展示的名稱。
  - `detail`：（可選）部分無法通過 API 獲取劇集詳情的站點，需要提供網頁詳情根 URL，用於爬取。
- `custom_category`：自定義分類配置，用於在導航中添加個性化的影視分類。以 type + query 作為唯一標識。支持以下字段：
  - `name`：分類顯示名稱（可選，如不提供則使用 query 作為顯示名）
  - `type`：分類類型，支持 `movie`（電影）或 `tv`（電視劇）
  - `query`：搜索關鍵詞，用於在豆瓣 API 中搜索相關內容

custom_category 支持的自定義分類已知如下：

- movie：熱門、最新、經典、豆瓣高分、冷門佳片、華語、歐美、韓國、日本、動作、喜劇、愛情、科幻、懸疑、恐怖、治癒
- tv：熱門、美劇、英劇、韓劇、日劇、國產劇、港劇、日本動畫、綜藝、紀錄片

也可輸入如 "哈利波特" 效果等同於豆瓣搜索

MoonTV 支持標準的蘋果 CMS V10 API 格式。

修改後 **無需重新構建**，服務會在啟動時讀取一次。

## 管理員配置

**該特性目前僅支持通過非 localstorage 存儲的部署方式使用**

支持在運行時動態變更服務配置

設置環境變量 USERNAME 和 PASSWORD 即為站長用戶，站長可設置用戶為管理員

站長或管理員訪問 `/admin` 即可進行管理員配置

## AndroidTV 使用

目前該項目可以配合 [OrionTV](https://github.com/zimplexing/OrionTV) 在 Android TV 上使用，可以直接作為 OrionTV 後端

## TVBox 對接

- 在首頁右上角的「設置」中，開啟「啟用 TVBox 接口」。
- 可選擇「隨機」生成訪問密碼，或自定義後點擊「保存」。
- 系統會生成可直接復制的接口地址，形式為：`https://你的域名/api/tvbox/config?pwd=你的口令`。
- 將該地址填入 TVBox 的訂閱/配置接口即可使用。
- 如需關閉對接，關閉開關即可。

### 本地存儲(localstorage)模式

- 開關由環境變量控制：`TVBOX_ENABLED=true|false`（默認 true，未設置即開啟）
- 接口訪問口令使用登錄密碼：`PASSWORD`
- 生成的訂閱地址示例：`https://你的域名/api/tvbox/config?pwd=$PASSWORD`
- 設置面板中的開關與保存在本地模式下僅用於展示（被禁用），請通過環境變量控制。

## Selene 使用

該項目已兼容 [Selene](https://github.com/MoonTechLab/Selene) 在移動端上使用，可以直接作為 Selene 後端(本地存儲不支持)

## 安全與隱私提醒

### 請設置密碼保護並關閉公網註冊

為了您的安全和避免潛在的法律風險，我們要求在部署時設置密碼保護並**強烈建議關閉公網註冊**：

- **避免公開訪問**：不設置密碼的實例任何人都可以訪問，可能被惡意利用
- **防範版權風險**：公開的視頻搜索服務可能面臨版權方的投訴舉報
- **保護個人隱私**：設置密碼可以限制訪問範圍，保護您的使用記錄

### 部署要求

1. **設置環境變量 `PASSWORD`**：為您的實例設置一個強密碼
2. **僅供個人使用**：請勿將您的實例鏈接公開分享或傳播
3. **遵守當地法律**：請確保您的使用行為符合當地法律法規

### 重要聲明

- 本項目僅供學習和個人使用
- 請勿將部署的實例用於商業用途或公開服務
- 如因公開分享導致的任何法律問題，用戶需自行承擔責任
- 項目開發者不對用戶的使用行為承擔任何法律責任

## License

[MIT](LICENSE) © 2025 MoonTV & Contributors

## 致謝

- [ts-nextjs-tailwind-starter](https://github.com/theodorusclarence/ts-nextjs-tailwind-starter) — 項目最初基於該腳手架。
- [LibreTV](https://github.com/LibreSpark/LibreTV) — 由此啟發，站在巨人的肩膀上。
- [ArtPlayer](https://github.com/zhw2590582/ArtPlayer) — 提供強大的網頁視頻播放器。
- [HLS.js](https://github.com/video-dev/hls.js) — 實現 HLS 流媒體在瀏覽器中的播放支持。
- [Zwei](https://github.com/bestzwei) — 提供獲取豆瓣數據的 cors proxy
- [CMLiussss](https://github.com/cmliu) — 提供豆瓣 CDN 服務
- 感謝所有提供免費影視接口的站點。

---

## ⭐ Star 趨勢

[![Stargazers over time](https://starchart.cc/stardm0/MoonTV.svg?variant=adaptive)](https://starchart.cc/stardm0/MoonTV)
