# 廣告片段辨識與保護範圍

本次改動不依賴片源名稱、CDN 網域、路徑中的 `ad` 字樣或短片段比例。
同一套解析適用於提供下列訊號的 HLS 點播來源：

- `EXT-X-CUE-OUT` + `EXT-X-CUE-IN` 明確區間。
- 純數字或屬性式（包含引號）的 `DURATION`。
- `EXT-X-CUE-OUT-CONT:ElapsedTime=...,Duration=...`。
- `EXT-X-CUE-OUT-CONT:elapsed/duration`。
- 從廣告中途開始的已結束點播清單：只有開頭且可驗證剩餘時長的 continuation 才能建立廣告區間。

移除前驗證完整數值、區間順序、累積時長與分段邊界；矛盾、巢狀、無法結束或跨越正片邊界的 cue 不作猜測。不同網域/相對路徑/帶查詢參數的片段使用同樣規則。既有兩組已驗證資產序列維持相容，沒有增加新的網域或檔名黑名單。

## 播放保護

- 保留原有 AES-128 原始 IV、KEY/MAP 繼承與 byte-range 修正。
- 校驗序列號及 byte-range 終點，避免例外或整數失真。
- 將 `EXT-X-START` 正/負起播位移映射到刪除後時間軸；落在被刪區間時對齊保留內容邊界。
- 保留主清單、live、未支援加密、DATERANGE 及多音軌/多畫質清單既有防護，未解除 API 的跨 rendition 時間軸保護。

## 未宣稱覆蓋的情境

這是來源無關的 **manifest 訊號辨識**，不是視訊畫面的廣告分類器。沒有廣告標記、畫面內燒錄廣告、以 PTS 指定且落在片段內部的 Adobe cue、未解碼的 SCTE-35、DATERANGE 語意與跨 rendition 共用切除圖，仍需要實際樣本與額外實作。不能把 generic interstitial、`SCTE35-CMD` 或 discontinuity 一律當成廣告。

後續來源驗證應記錄：來源、影片與集數、原始 manifest（先移除 token）、廣告起迄、正片邊界、移除結果、音畫同步與 seek。正例與容易誤判的正片反例都要納入。單元測試使用合成清單，不代表所有片源已完成實播驗收。

## 格式依據

- [AWS MediaLive HLS sample manifests](https://docs.aws.amazon.com/medialive/latest/ug/sample-manifests-hls.html)
- [AWS MediaPackage HLS CUE tag ad markers](https://docs.aws.amazon.com/mediapackage/latest/userguide/ext-x-cue-ad-marker.html)
- [RFC 8216: EXT-X-START](https://www.rfc-editor.org/rfc/rfc8216.html#section-4.3.5.2)
