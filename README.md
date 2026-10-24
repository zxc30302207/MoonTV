<div align="center">

<img src="docs/assets/moontv-cinema.webp" alt="MoonTV 品牌概念圖：月光與透明膠卷交織的夜空，非產品截圖。" width="100%" />

# MoonTV

**波波的秘密基地 · 自己的站點，自己的觀影節奏。**

可自行部署的影視搜尋與播放介面。<br />
整合多來源搜尋、收藏追更與彈幕，延伸繁體中文體驗及獨立存取管理。

**Next.js** · **React** · **TypeScript** · **Supabase**

[部署指南](docs/DEPLOYMENT.md) · [更新紀錄](CHANGELOG) · [上游專案](https://github.com/Stardm0/MoonTV)

</div>

---

## 從找到，到接著看

- **跨來源搜尋** — 繁簡文字匹配、來源篩選，集中尋找想看的內容。
- **收藏與追更** — 播放紀錄、收藏及今日更新，接續自己的觀看進度。
- **播放更順手** — 選集、進度預覽、手機手勢與彈幕，也可交給已安裝的外部播放器。
- **資料與權限自主管理** — Supabase 保存帳號資料；後台管理來源、使用者與卡密授權。

繁體中文介面，搭配豆瓣評分與短評、桌面鍵盤操作及手機導覽。

## 建立自己的 MoonTV

推薦使用 **Vercel + Supabase**：

**Fork 專案 → 準備資料庫 → 設定環境變數 → 部署**

[依照部署指南開始 →](docs/DEPLOYMENT.md)

> 請設定高強度管理員密碼，並將伺服器金鑰留在環境變數中，不要提交到 Git。

## 致謝與授權

基於 [Stardm0/MoonTV](https://github.com/Stardm0/MoonTV) 持續整合與客製。感謝原作者與所有開源貢獻者。<br />
[MIT License](LICENSE) · Copyright (c) 2025 LunaTechLab

本專案不內建、託管或分發影片檔案。請只接入有權使用的來源；程式授權不包含第三方內容的使用權，來源可用性亦不由本專案保證。
