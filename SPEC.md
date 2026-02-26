# YouTube 影片或直播即時翻譯字幕系統規格書

## 1. 專案簡介 (Project Overview)

本專案為一個結合 Chrome 擴充功能 (Browser Extension) 與 Go 後端服務的即時字幕翻譯系統。主要解決使用者在觀看 YouTube 外語影片或直播時的語言障礙，透過擷取影片或直播音訊，進行即時的語音辨識 (Speech-to-Text) 並翻譯為目標語言，最後以懸浮字幕的形式顯示於影片上方。

## 2. 系統架構 (System Architecture)

系統採用前後端分離架構，透過 WebSocket 進行低延遲的雙向通訊。

```mermaid
graph LR
    A[YouTube 影片或直播頁面\n(Chrome Extension)] -->|WebSocket (音訊串流)| B(Go Backend)
    B -->|API 請求| C[Deepgram API\n(語音轉文字)]
    C -->|文字結果| B
    B -->|API 請求| D[Google Translate / DeepL\n(文字翻譯)]
    D -->|翻譯結果| B
    B -->|WebSocket (字幕資料)| A
    A -->|自動儲存| E[(本機歷史紀錄區)]
```

## 3. 功能規格 (Functional Specifications)

### 3.1 核心功能 (Core Features)

- **即時語音辨識**：支援接收 YouTube 影片或直播音訊，並即時轉換為文字。
- **多國語言翻譯**：支援將辨識後的文字翻譯為使用者指定的目標語言（預設使用 Google Translate，可依賴 DeepL 作為備援）。
- **可配置的語言選項**：使用者可自由選擇「來源語言 (Source Language)」與「目標語言 (Target Language)」。支援中、英、日、韓、西、法等多種主要語言。

### 3.2 前端擴充功能 (Chrome Extension)

- **進入點**：只能在 YouTube 影片或影片或直播頁面中啟動。
- **UI 控制面板 (`popup.html`, `popup.js`)**：
  - 提供來源與目標語言的下拉式選單。
  - 「開始字幕 / 停止字幕」控制按鈕。
- **懸浮字幕渲染 (`content.js`, `style.css`)**：
  - 在 YouTube 播放器上方疊加透明字幕層。
  - 動態渲染 WebSocket 傳來的翻譯文字。
- **字幕歷史紀錄 (`history.html`, `history.js`, `history.css`)**：
  - 自動儲存所有翻譯過的字幕紀錄。
  - 提供獨立的管理介面，支援依影片或語言進行搜尋與過濾。
  - 支援將歷史紀錄匯出為 JSON 格式。

### 3.3 後端服務 (Backend Service)

- **音訊接收與處理 (`/ws` 端點)**：
  - 接受來自前端的 WebSocket 連線。
  - 解析前端傳送的設定檔 (包含語系配置)。
  - 接收二進位音訊串流並轉發至語音辨識 API。
- **狀態檢查 (`/health` 端點)**：
  - 提供簡單的 HTTP GET API 以確認伺服器健康狀態。

## 4. 技術堆疊 (Tech Stack)

### 4.1 前端 (Frontend)

- **核心**：HTML5, CSS3 (Vanilla CSS), JavaScript (Vanilla JS)。
- **運行環境**：Google Chrome Extension (Manifest V3 規範)。
- **通訊方式**：原生 WebSocket API。

### 4.2 後端 (Backend)

- **程式語言**：Go 1.21+。
- **架構設計**：內建 `net/http` 與 WebSocket 處理 (預期使用 `gorilla/websocket` 或標準庫)。
- **環境變數管理**：使用 `.env` 檔案管理敏感之 API Keys。

## 5. 通訊協定 (Communication Protocols)

### 5.1 WebSocket 資料格式 (JSON)

**1. Client → Server (初始化設定):**

```json
{
  "type": "config",
  "sourceLanguage": "en",
  "targetLanguage": "zh-TW"
}
```

**2. Server → Client (回傳辨識與翻譯結果):**

```json
{
  "type": "transcript|translation|error",
  "text": "翻譯後的文字內容",
  "message": "（若為 error 時的錯誤描述）"
}
```

## 6. 第三方服務整合 (Third-party Integrations)

本系統高度依賴以下外部 API，後端需負責 API 金鑰的調用與錯誤處理。

1. **Deepgram API (必填)**：
   - 用途：語音轉文字 (Speech-to-Text)。
   - 特性：低延遲、高精準度的串流語音辨識。
2. **Google Translate API (選填 / 主要翻譯)**：
   - 用途：文字翻譯。
3. **DeepL API (選填 / 備援翻譯)**：
   - 用途：文字翻譯，提供更自然與高質量的語句翻譯。

## 7. 未來擴充規劃 (Future Enhancements)

- **效能優化**：前端導入 AudioWorklet 取代傳統 ScriptProcessor 以提升音訊採樣效能。
- **快取機制**：後端加入 Redis 快取常見翻譯，減少 API 呼叫成本與延遲。
- **離線支援**：探索本地端離線語音辨識模型整合的可能性。
- **實用工具**：支援 SRT/VTT 字幕格式匯出。
