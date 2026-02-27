# 02 · 環境建置與使用指南 (Getting Started)

本篇指南將帶領你一步步在本地環境中架設 **YT 即時翻譯字幕** 的後端伺服器，並安裝 Chrome 擴充功能展開測試。

## 前置需求

在開始之前，請確保你的開發機已安裝以下工具：

- [Go](https://go.dev/doc/install) (版本 1.20 或以上)
- [Google Chrome](https://www.google.com/chrome/) (或任何基於 Chromium 的瀏覽器，如 Edge, Brave)
- 一個有效的 [Deepgram](https://deepgram.com/) 帳號與 API Key（取得長時語音辨識服務）
- (可選) [Google Cloud Console](https://console.cloud.google.com/) 專案及 Cloud Translation API Key
- (可選) [DeepL API](https://www.deepl.com/pro-api) Key

## 步驟 1：啟動 Go 後端伺服器

後端伺服器負責接收瀏覽器傳來的音訊串流，並轉發給 Deepgram 與翻譯 API。

1. **進入後端目錄：**

   ```bash
   cd yt-video-subtitles/backend
   ```

2. **設定環境變數：**
   複製一份環境變數範例檔：

   ```bash
   cp .env.example .env
   ```

   使用文字編輯器打開 `.env` 檔案，填入你的 API Key：

   ```env
   # 必填！Deepgram 語音辨識 API Key
   DEEPGRAM_API_KEY=your_deepgram_api_key_here

   # 選填 (至少擇一)：
   GOOGLE_TRANSLATE_API_KEY=your_google_key_here
   DEEPL_API_KEY=your_deepl_key_here

   # 伺服器綁定埠號 (預設 8080)
   SERVER_PORT=8080
   ```

3. **安裝依賴包：**

   ```bash
   go mod tidy
   ```

4. **執行伺服器：**
   你可以直接執行 `go run`，或透過 [air](https://github.com/cosmtrek/air) 進行熱重載：
   ```bash
   go run main.go
   # 或者安裝 air 後執行： air
   ```
   看到 `伺服器啟動於 :8080` 與 `已註冊翻譯服務` 的 Log 即可。

## 步驟 2：載入 Chrome 擴充功能

1. 開啟 Google Chrome。
2. 在網址列輸入 `chrome://extensions/` 並按下 Enter。
3. 確保右上角的 **開發人員模式 (Developer mode)** 開啟。
4. 點選左上角的 **載入未封裝項目 (Load unpacked)**。
5. 選擇專案資料夾下的 `yt-video-subtitles/extension` 目錄。
6. 確認擴充功能已成功載入且已啟用。

## 步驟 3：在 YouTube 上測試

1. 打開 YouTube，隨意找一部有人聲的影片或直播。
2. 影片開始播放後，請看播放器**右下角的控制列**（設定齒輪圖示旁邊）。
3. 你會看到一個新的 **語言切換 (▾) 按鈕** 以及一個 **[CC] 啟動按鈕**。
   - 點擊 (▾) 選單，設定來源語言 (例如 `en`) 與目標語言 (例如 `zh-TW`)。
   - 點選左側的主要按鈕啟動字幕。
4. 字幕將疊加在畫面上。
   - 上方以半透明小字顯示「原文即時辨識」。
   - 下方以實心大字顯示「最終翻譯」。
5. **拖曳調整位置：** 從字幕上方區塊按住滑鼠左鍵，可以隨意拖曳字幕層。
6. **歷史紀錄：** 點擊瀏覽器右上角的擴充功能圖示，可開啟實用工具面板查看剛才翻譯的歷史紀錄。
