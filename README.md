# YouTube 即時翻譯字幕系統

結合 Chrome Extension 與 Go 後端的即時字幕翻譯系統。擷取 YouTube 影片/直播音訊，透過 Deepgram 進行語音辨識，再以 Google Translate / DeepL 輪流翻譯，以懸浮字幕顯示於影片上。

## 系統架構

```
YouTube 頁面 (Content Script)
  ├── 攔截 <video> 音訊
  ├── WebSocket 傳送至後端
  └── 接收翻譯結果 → 懸浮字幕
         ↕
Go Backend (WebSocket Server)
  ├── Deepgram API (語音轉文字)
  └── Google / DeepL (翻譯，Round-Robin)
```

## 快速開始

### 1. 後端

```bash
cd backend
cp .env.example .env
# 編輯 .env 填入 API Keys
go run main.go
```

### 2. Chrome Extension

1. 開啟 `chrome://extensions/`
2. 啟用「開發者模式」
3. 點擊「載入未封裝擴充功能」→ 選擇 `extension/` 資料夾
4. 前往任意 YouTube 影片頁面

### 3. 使用

- 影片播放器控制列會出現字幕按鈕（CC 圖標）
- 點擊旁邊的 ▾ 可設定語言與伺服器位址
- 點擊按鈕開始/停止即時字幕
- 點擊擴充功能圖標可查看歷史紀錄

## 環境變數

| 變數名稱                   | 說明                    | 必填 |
| -------------------------- | ----------------------- | ---- |
| `DEEPGRAM_API_KEY`         | Deepgram 語音轉文字     | ✅   |
| `GOOGLE_TRANSLATE_API_KEY` | Google Translate        | ⬜   |
| `DEEPL_API_KEY`            | DeepL 翻譯              | ⬜   |
| `SERVER_PORT`              | 伺服器埠號（預設 8080） | ⬜   |

> Google Translate 與 DeepL 至少需提供一個。系統以 Round-Robin 方式輪流使用兩個翻譯服務。

## 技術堆疊

- **前端**：Chrome Extension (Manifest V3), Vanilla JS/CSS
- **後端**：Go 1.21+, gorilla/websocket
- **STT**：Deepgram Nova-2 Streaming API
- **翻譯**：Google Cloud Translation API, DeepL API
