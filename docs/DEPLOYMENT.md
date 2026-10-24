# 部署指南

[← 返回 README](../README.md)

本指南對應此客製分支，採用 **Vercel + Supabase**。請勿直接套用其他分支的 Redis、D1 或資料庫設定：目前程式的儲存選項為 `supabase` 與 `localstorage`，後者只適合單機體驗，不提供完整的伺服器端帳號與管理功能。

## 1. 準備 Supabase

1. 建立供本站使用的 Supabase 專案。
2. 在 SQL Editor 執行 [`001_moontv_kv.sql`](../migrations/supabase/001_moontv_kv.sql)。此檔建立 `public.moontv_kv`、索引並啟用 RLS。
3. 取得專案 URL 與伺服器端 secret key。此金鑰權限高，只能存於伺服器環境，不可提供給瀏覽器或提交到 Git。

新部署建議使用 `SUPABASE_SECRET_KEY`。程式仍接受舊版 `SUPABASE_SERVICE_ROLE_KEY`；同時設定時會優先使用後者，切換時請避免殘留錯誤舊值。不要用 anon／publishable key 取代伺服器金鑰，也不要為了排錯而關閉 RLS。詳見 [Supabase 金鑰說明](https://supabase.com/docs/guides/getting-started/api-keys)。

已有資料的站點請先備份。本指南不要求清空、重建或搬移既有資料。

## 2. 在 Vercel 匯入倉庫

Fork 專案後，在 Vercel 匯入自己的 GitHub 倉庫：

| 設定             | 值                                                  |
| :--------------- | :-------------------------------------------------- |
| Framework Preset | Next.js                                             |
| Root Directory   | 倉庫根目錄                                          |
| Node.js          | 22.x（與專案 CI 一致）                              |
| 套件管理器       | pnpm 10.14.0，見 `package.json` 的 `packageManager` |
| Install Command  | `pnpm install --frozen-lockfile`                    |
| Build Command    | `pnpm build`                                        |
| Output Directory | 使用 Next.js 預設值，不另行覆寫                     |

保留 `pnpm-lock.yaml`。本專案使用 API 與伺服器功能，不能以純靜態 HTML 匯出取代部署。

## 3. 設定環境變數

以下為**範本，不是真實憑證**。在 Vercel 的環境變數介面逐項填入；本機則寫入 `.env.local`。

```env
NEXT_PUBLIC_STORAGE_TYPE=supabase
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SECRET_KEY=REPLACE_WITH_SERVER_SIDE_KEY
USERNAME=YOUR_ADMIN_USERNAME
PASSWORD=REPLACE_WITH_A_LONG_RANDOM_PASSWORD
NEXT_PUBLIC_SITE_NAME=波波的秘密基地
NEXT_PUBLIC_ENABLE_REGISTER=false
```

- 務必替換範本值，尤其是 `PASSWORD`。本分支以它驗證管理員並簽署登入憑證；變更後既有登入可能失效，需重新登入。
- `NEXT_PUBLIC_*` 是可公開設定，不可用來存放密碼、金鑰或私密 URL。
- 環境變數要套用到正確環境。Production 使用正式資料庫；Preview／Development 建議使用獨立測試資料庫與憑證。
- 修改環境變數後重新部署。已有資料庫設定時，註冊等站點選項也需在 `/admin` 檢查，不能只看環境變數。
- 可選的 `SUPABASE_KV_TABLE` 用於指定表名，預設 `moontv_kv`。只有已準備對應結構與權限時才調整。

### 彈幕後端（選用）

使用自架、相容的 `danmu_api`／`misaka` 服務時，在 `/admin` 的彈幕 API 設定填入相容根地址，並確認後端實際支援本站使用的 API 路徑。

**此設定會傳入瀏覽器，必須是可公開的 URL，不可包含私密 token 或金鑰。** 不要用 `NEXT_PUBLIC_DANMU_API_BASE_URL` 存放憑證。現有 `DANMU_API_BASE_URL` 只是伺服器 fallback，會受站點設定與預設值優先序影響，不應當成可靠的主要設定方式。

也可為內建代理設定官方 dandanplay API 憑證：

```env
DANDANPLAY_APP_ID=YOUR_APP_ID
DANDANPLAY_APP_SECRET=YOUR_APP_SECRET
```

是否可用取決於後端相容性、憑證及服務限制；設定完成後應實測載入、選集切換與手動來源。

### 定時工作（選用）

[`vercel.json`](../vercel.json) 已宣告 `/api/cron` 每日 `01:00 UTC` 的排程（UTC+8 為 09:00）。若要使用，設定高強度的 `CRON_SECRET`；端點會驗證授權，未設定或不匹配不會執行正常刷新。

```env
CRON_SECRET=REPLACE_WITH_A_SEPARATE_RANDOM_SECRET
```

Vercel 會將 `CRON_SECRET` 作為 Bearer token 傳入排程請求；不要把這個值放進公開網址。參考 [Vercel Cron 管理文件](https://vercel.com/docs/cron-jobs/manage-cron-jobs)。以 Vercel 的排程記錄確認請求與執行結果；不要僅因一般網頁可開啟就判定排程正常。

## 4. 設定站點與來源

部署成功後登入 `/admin`，確認站名、使用者、註冊開關、來源分組與存取權限。站點若不開放註冊，請由管理員建立帳號。

來源可在後台管理；[`config.json`](../config.json) 是程式設定輸入之一。以下只展示 Apple CMS V10 結構，`example.com` 不是可用來源：

```json
{
  "api_site": {
    "example": {
      "api": "https://example.com/api.php/provide/vod",
      "name": "示例來源",
      "detail": "https://example.com"
    }
  }
}
```

不要用範例整份覆蓋已有設定。只加入你有權使用的來源，保留既有來源停用狀態；更新程式不應重置站點權限或資料。

卡密授權是獨立存取權限，不等於一般帳號註冊。請分別驗證一般使用者、已授權使用者與管理員；未授權帳號不應藉由直接請求 API 取得受限資料。

後台啟用 TVBox 後，使用系統產生的配置地址。不要公開分享個人配置 URL 或將其當成無權限限制的公共訂閱。

## 5. 上線驗收

- [ ] Vercel 部署為 Ready，正式網域確實指向目標版本。
- [ ] 管理員可登入；一般使用者不可進入管理功能。
- [ ] 註冊開關符合預期；未授權帳號無法取得獨立授權區資料。
- [ ] 以有權使用的來源測試搜尋、選集、播放與外部播放器。
- [ ] 收藏與播放紀錄在重新登入後仍存在，登出後不殘留上一個帳號的私人資料。
- [ ] 在手機與桌面檢查導覽、篩選、鍵盤焦點和表單錯誤提示。
- [ ] 版本檢查能取得上游結果；網路錯誤不被顯示成「已更新」。
- [ ] 若有設定彈幕或排程，另行檢查其服務與執行記錄。

## 常見排查

| 現象                     | 先檢查                                                                     |
| :----------------------- | :------------------------------------------------------------------------- |
| Supabase 存取失敗        | URL、伺服器金鑰、KV 表是否存在、Vercel 環境是否選對；不要關閉 RLS 當解法。 |
| 設定修改後未生效         | 是否已重新部署，以及後台／資料庫是否已有對應設定。                         |
| 搜尋成功但無法播放       | 來源回應、格式與網路限制；搜尋 API 可用不代表每個影片連結都可播放。        |
| 彈幕載入失敗             | 後端 URL／前綴、憑證、後端相容性及服務記錄。                               |
| 上游已更新但本站仍為舊版 | 更新檢查不會代替合併；先完成相容整合、CI 與正式部署，再確認網域版本。      |

排錯時分享錯誤訊息與經遮蔽的記錄即可，不要提供密碼、Cookie、卡密、service role key 或含 token 的完整 URL。
