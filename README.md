# YouTube Real-time Subtitles (YT 即時翻譯字幕系統)

[English](#english) | [繁體中文](#繁體中文)

---

<h2 id="english">English</h2>

A real-time bilingual subtitle translation system integrating a Chrome Extension and a Go backend. It captures audio directly from YouTube videos or livestreams, utilizes Deepgram for low-latency Speech-to-Text (STT), and employs a Round-Robin strategy between Google Translate and DeepL API to seamlessly overlay dual-language subtitles on the video player.

### System Architecture

```text
YouTube Page (Content Script)
  ├── Audio Capture (Web Audio API bypass routing)
  ├── WebSocket streaming to backend
  └── Receive translations → Render draggable subtitles
         ↕
Go Backend (WebSocket Server)
  ├── Deepgram API (STT streaming)
  └── Google / DeepL (Round-Robin Translation Failover)
```

### Documentation

For deep dives into the technical details and setup guides, please refer to the `docs/` directory:

- [01 · Project Overview](./docs/01-project-overview.md)
- [02 · Getting Started](./docs/02-getting-started.md)
- [03 · Backend architecture](./docs/03-backend-guide.md)
- [04 · Frontend Architecture](./docs/04-frontend-guide.md)
- [05 · Audio Pipeline Deep Dive](./docs/05-audio-pipeline.md)
- [06 · Interview QA & System Design](./docs/06-interview-qa.md)

### Quick Start

#### 1. Backend

**Option A: Using Go (Local)**

```bash
cd backend
cp .env.example .env
# Edit .env with your API Keys
go run main.go
```

**Option B: Using Docker Compose**

```bash
cp backend/.env.example .env
# Edit .env in the root directory with your API Keys
docker-compose up -d
```

#### 2. Chrome Extension

1. Open `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" → select the `extension/` folder
4. Go to any YouTube video page

#### 3. Usage

- A new `CC` toggle button will appear in the YouTube player controls.
- Click the `▾` icon next to it to configure Source/Target languages.
- Click the `CC` button to start processing and displaying the real-time translated subtitles.
- Check the extension popup for translation history.

### Environment Variables

| Variable                   | Description                   | Required |
| -------------------------- | ----------------------------- | -------- |
| `DEEPGRAM_API_KEY`         | Deepgram Nova-2 Streaming API | ✅       |
| `GOOGLE_TRANSLATE_API_KEY` | Google Translate API          | ⬜       |
| `DEEPL_API_KEY`            | DeepL Pro/Free API            | ⬜       |
| `SERVER_PORT`              | Backend port (default 8080)   | ⬜       |

> Either Google Translate or DeepL is required. The system will load balance and failover seamlessly between configured translation providers.

---

<h2 id="繁體中文">繁體中文</h2>

結合 Chrome Extension 與 Go 後端的即時字幕翻譯系統。以無感的方式擷取 YouTube 影片或直播音訊，透過 Deepgram 進行超低延遲的語音辨識，再以 Google Translate / DeepL 輪流備援翻譯，將即時生成的雙語字幕（原文+翻譯）懸浮顯示於播放器上方。

### 系統架構

```text
YouTube 頁面 (Content Script)
  ├── Web Audio 旁路攔截 <video> 音訊
  ├── WebSocket 動態緩衝傳送至後端
  └── 接收翻譯結果 → 渲染可拖曳、防閃爍的懸浮字幕
         ↕
Go Backend (WebSocket Server)
  ├── Deepgram API (Nova-2 即時語音轉文字)
  └── Google / DeepL (Round-Robin 負載平衡與失效備援)
```

### 完整技術文件

若要深入了解本系統的設計原理、本地架設步驟或面試考題準備，請參閱詳細文件（位於 `docs/` 目錄）：

- [01 · 專案概覽與系統架構](./docs/01-project-overview.md)
- [02 · 環境建置與使用指南](./docs/02-getting-started.md)
- [03 · 後端架構詳解](./docs/03-backend-guide.md)
- [04 · 前端架構詳解](./docs/04-frontend-guide.md)
- [05 · 解析難題：音訊處理管線](./docs/05-audio-pipeline.md)
- [06 · 面試 Q&A 教戰手冊](./docs/06-interview-qa.md)

### 快速開始

#### 1. 後端

**選項 A: 使用 Go (本地開發)**

```bash
cd backend
cp .env.example .env
# 編輯 .env 填入你的 API Keys
go run main.go
```

**選項 B: 使用 Docker Compose (推薦)**

```bash
cp backend/.env.example .env
# 在根目錄編輯 .env 填入你的 API Keys
docker-compose up -d
```

#### 2. Chrome Extension

1. 開啟 `chrome://extensions/`
2. 啟用「開發者模式」
3. 點擊「載入未封裝擴充功能」→ 選擇專案下的 `extension/` 資料夾
4. 前往任意 YouTube 影片頁面開始測試

#### 3. 使用

- 影片播放器控制列會原生地出現新的 `CC` 字幕按鈕。
- 點擊旁邊的 `▾` 可自由設定來源語言、目標語言。
- 點擊按鈕主體即可開始 / 停止即時字幕，畫面會同時疊加小字原文與大字翻譯。
- 點擊瀏覽器右上角的擴充功能圖標，可查詢、備份剛才翻譯交流的歷史紀錄。

### 環境變數配置 (.env)

| 變數名稱                   | 說明                        | 必填 |
| -------------------------- | --------------------------- | ---- |
| `DEEPGRAM_API_KEY`         | 用於長時語音辨識            | ✅   |
| `GOOGLE_TRANSLATE_API_KEY` | 主要翻譯服務                | ⬜   |
| `DEEPL_API_KEY`            | 翻譯服務                    | ⬜   |
| `SERVER_PORT`              | 伺服器綁定埠號（預設 8080） | ⬜   |

> 💡 系統以 Round-Robin (輪詢) 方式設計，翻譯服務需至少提供一家（Google / DeepL擇一）。當皆提供時可享有完美的負載平衡與自動 Failure 救援機制。
