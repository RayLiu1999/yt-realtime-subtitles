# 05 · 音訊處理管線 (Audio Pipeline)

本專案將 YouTube 網頁的聲音傳送到後端 AI API 進行辨識，這是整個專案的技術核心。這段流程稱為**音訊處理管線 (Audio Pipeline)**。

此管線分為前端攔截與後端轉發兩個階段，需要解決：**音訊擷取、格式轉化、即時傳輸、防止中斷**等四個難題。

---

## 前端階段：攔截與格式化 (`content.js` > `AudioStreamer`)

### 1. 攔截音訊 (Audio Capture)

在瀏覽器中，我們要從 YouTube 原生的 `<video>` 標籤中「聽」到聲音。
我們使用 Web Audio API 的 `AudioContext.createMediaElementSource(videoElement)`，將 `<video>` 的聲音源導入我們自訂的音訊處理圖 (Audio Graph) 中。

**關鍵挑戰：如何在攔截聲音的同時，不讓播放器靜音，也不產生回音？**
為了解決這個問題，我們設計了「旁路分流 (Bypass Routing)」架構：

```
                    ┌─► 聲音輸出 (Destination) — 使用者正常聽到聲音
                    │
影片聲音 (Source) ──┤
                    │
                    └─► 處理器 (ScriptProcessorNode) ──► 靜音節點 (Gain=0) ──► 聲音輸出 (Destination)
                                │
                                ▼
                       (提取數據進行字節轉換)
```

**為什麼需要靜音節點 (Dummy Gain)？**
Web Audio 規範中，`ScriptProcessorNode` 必須連接到最終的聲音輸出 (`Destination`) 才會觸發 `onaudioprocess` 事件。但如果直接連上去，等於聲音被播放了「兩次」，會產生嚴重的回音。因此，我們在中間安插一個音量值 (Gain) 為 0 的假節點，滿足了 API 連接的要求，同時把第二層聲音消掉。

### 2. 轉換與封裝 (Format Conversion)

瀏覽器的 `ScriptProcessorNode` 給我們的音訊格式是 Float32Array（每個樣本值介於 -1.0 到 1.0 之間浮點數）。
但是，Deepgram 的 API（以及絕大多數 STT 系統）期望的格式是 16-bit PCM (Int16Array)。

在 `onaudioprocess` 函式中，我們手動將每個 Float32 樣本轉換為 Int16：

```javascript
// Float32 轉 Int16 演算法
const sample = Math.max(-1, Math.min(1, float32Data[i]));
int16Buffer[offset] = Math.floor(sample * 32767);
```

### 3. 緩衝與發送 (Buffering and Sending)

`ScriptProcessorNode` 每次給的緩衝區很小（例如 4096 個樣本），如果每次直接透過 WebSocket 發送，會造成過高的網路封包開銷與伺服器壓力。

為此，我們設計了一個 **緩衝區 (Buffer)**。
我們預設取樣率為 `16000Hz`，並設定累積 `0.5` 秒的資料量（即 8000 個樣本）才透過 `websocket.send()` 發送一次二進位資料。這在「文字即時性」與「網路效能」之間取得了完美平衡。

### 4. 心跳保活機制 (Heartbeat / Keep-Alive)

一個常見的坑是：當影片靜音、或者使用者按下暫停時，`onaudioprocess` 會傳送一堆完全是 0 的靜音封包，或乾脆不觸發。Deepgram 會因為長時間沒收到**有效音訊**而在 10-15 秒後自動斷線（回傳 `1011 internal server error`）。

**解法：**
我們設計了 `startHeartbeat()` 靜音包機制。
在處理器掃過 Float32Array 時，我們會檢查「是否包含有效聲音」（振幅 > 0.001）：
如果有，更新 `lastAudioTime`。
心跳計時器每秒檢查一次，如果發現距離上次有聲音已經超過 3 秒，說明影片可能暫停了。此時，我們就模擬一個 0.1 秒的靜音 PCM 封包（全 0 的 Int16Array）主動發給後端。它這不算是「沉默」，對 Deepgram 來說這是「有收到音訊串流」（只不過內容剛好是靜音），藉此把連線一直保活著！

---

## 後端階段：轉發與處理 (`Go Backend` > `websocket.go` & `deepgram.go`)

### 5. 接收與橋接 (WebSocket Relaying)

Go 後端同時建立兩條 WebSocket 連線：

- `Conn A`：面向前端 Chrome Extension (在 `:8080/ws`)
- `Conn B`：面向 Deepgram Streaming API (`wss://api.deepgram.com/v1/listen...`)

Go 後端在此刻扮演了**橋樑 (Bridge)** 的角色：
當前端傳來 `websocket.BinaryMessage`（純 PCM 音訊資料），Go 完全不解析內容，直接呼叫 `dgClient.Send(audioData)`，將 Byte array 原封不動地塞進面向 Deepgram 的連線中。

### 6. 非同步結果接收 (Async Result Handling)

由於傳送音訊（上行）與接收文字（下行）的速度完全不同步，我們在 Go 中使用 goroutine：

```go
go d.readResults()
```

這支 goroutine 負責死迴圈聽取 Deepgram 傳回來的任何 JSON 結果，並呼叫 `onResult` Callback。

Deepgram 會頻繁發送 `Interim (臨時)` 結果，最後發送一次 `Final (最終)` 結果。
為了避免前端字幕一直閃爍或瘋狂呼叫翻譯 API 浪費錢，我們在 `onResult` 中會判斷傳回來的 `isFinal` 布林值：

- 如果 `isFinal == false`：只在 Go 紀錄 Log，**不傳給前端**。
- 如果 `isFinal == true`：觸發 Round-Robin 翻譯器，等待翻譯完成後，將 `{ original, translated }` 打包成 JSON，發往 `Conn A` 交給前端渲染。

透過這樣的設計，保證了前端收到的每一句話都是穩定、不會跳動且已翻譯完成的純粹文字，徹底解放前端負擔。
