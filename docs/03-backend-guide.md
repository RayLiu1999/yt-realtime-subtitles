# 03 · 後端架構詳解 (Backend Guide)

本專案使用 Go (Golang) 開發輕量級、高併發的 WebSocket 伺服器，負責橋接前端瀏覽器的音訊串流以及第三方 AI API。此設計可大幅降低前端 Extension 的權限要求，並保護 API Secret Key 不被外洩。

## 架構設計

後端的核心是一個 HTTP Mux，它提供 `/health` 健康檢查端點，以及最為重要的 `/ws` WebSocket 端點。

- **入口**：`main.go` 負責環境載入、CORS 中介層設定，與啟動 HTTP Server。
- **路由 (Handlers)**：`handler/websocket.go` 是控制連線的核心，處理 WebSocket 升級與生命週期。
- **服務層 (Services)**：
  - `DeepgramClient`：管理與 Deepgram Streaming API 的長連線並實作雙向串流。
  - `RoundRobinTranslator`：管理翻譯 API 並自動實作失效備援 (Failover)。

## /ws WebSocket 生命週期

1. **連線升級 (Handshake)**：
   前端連線至 `/ws`。伺服器配置 `websocket.Upgrader` 將 HTTP 請求升級為 WS。由於 Chrome Extension 需要跨域連線，這裡的 `CheckOrigin` 統一回傳 `true` 允許連線。

2. **初始設定 (Config)**：
   前端送來第一則 JSON 文字訊息：

   ```json
   { "type": "config", "sourceLanguage": "en", "targetLanguage": "zh-TW" }
   ```

   伺服器會依據語言初始化 `DeepgramClient`，並將連線語言綁定上去。

3. **啟動 Deepgram 雙向橋接**：
   - **音訊接收 (Client -> Go -> Deepgram)**：伺服器啟動 `for` 迴圈持續 `ReadMessage()`。只要收到 Binary frame，就立刻將 16kHz PCM 音訊轉發至 Deepgram 的 WebSocket。
   - **結果回傳 (Deepgram -> Go -> Client)**：Deepgram 辨識到人聲後，非同步送回 JSON。Go 服務層觸發 `onResult` Callback。

4. **處理辨識與翻譯**：
   `onResult` callback 會判斷 Deepgram 給的結果是「中間值 (Interim)」還是「最終結果 (Final)」。
   - **Interim**：不發送前端（避免畫面閃爍），只留在 Log 供除錯。
   - **Final**：
     - 將最終原始辨識結果呼叫 `Translator`。
     - 取得翻譯後，打包成完整的 JSON response 回傳給前端。

5. **連線結束**：
   當前端使用者關閉字幕，或離開頁面時，WebSocket 中斷。Go 利用迴圈退出機制、`defer conn.Close()` 與 `defer dgClient.Close()` 優雅釋放所有資源與 Deepgram 連線。

## Round-Robin 翻譯器設計

由於各種 API (Google, DeepL) 可能會有限流、臨時網路異常或憑證過期的情況，專案採用 `RoundRobinTranslator` 作為高可用性設計：

```go
type RoundRobinTranslator struct {
	translators []Translator // registered target adapters
	counter     atomic.Uint64 // monotonic incrementer
}
```

1. 在啟動時根據環境變數將 `GoogleTranslator` 或 `DeepLTranslator` 加入可用清單中。
2. 每次需要翻譯時，將 atomic counter `+1` 取餘數，決定這次要使用哪個 Provider。
3. 若該 Provider 回傳錯誤，For 迴圈會攔截該 `err` 並自動推進到清單中「下一個」Provider。
4. 這實現了 **零延遲 Load Balancing**，同時兼顧了失效備援 (Failover)，讓使用者不會因為其中一個服務瞬斷而失去字幕。
