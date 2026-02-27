# 06 · 面試 Q&A 教戰手冊 (Interview QA)

這份文件為你準備了在展示或面試本專案時，面試官可能針對系統架構、前端、後端各個層面提出的刁鑽問題，以及專業的回答策略。

---

## 🌟 宏觀與架構題

### Q1. 這個系統的架構為什麼是「瀏覽器 -> Go 後端 -> 第三方 API」而不是讓擴充功能直接打 Deepgram 或 Google API？

**A（回答要點）：**
這是一個關鍵的「安全性」與「職責分離」考量。

1. **API Key 安全性**：如果讓前端擴充功能直接打 Deepgram 和 Google，所有 API Keys 都必須寫死（硬編碼）在前端 JS 裡。任何懂點技術的駭客只要把你的 `.crx` 解開或打開 DevTools，就能把大把的 API 額度偷走。把呼叫搬到後端，可以把 Key 藏在 `.env` 中，前端只對我們自己的 Server 負責。
2. **減輕前端負擔 (Thin Client)**：瀏覽器在播放 4K 影片時原本就要耗費大量 CPU 資源。如果前端還要處理 Interim 字幕跳動邏輯、甚至實作 Round-Robin 負載平衡切換不同翻譯引擎，程式碼會變得異常肥大且容易造成網頁卡頓。
3. **更強的擴充性**：後端實作了 WebSocket，如果未來想升級翻譯邏輯（例如加入自家訓練的 LLM），或者外接 Redis 做頻繁句子的快取，只需改動 Go 後端即可，前端（客戶端）完全不用更新版本。

### Q2. 整個系統的最大延遲 (Latency) 瓶頸在哪裡？你有做什麼優化？

**A（回答要點）：**
最大的瓶頸發生在「等待翻譯 API 返回」的這段時間。
整個管線的時間差包括：

1. **音訊累積 (0.5s)**：前端每累積 0.5 秒才會發出一個封包。
2. **Deepgram 辨識 (約 300ms)**：Nova-2 模型的串流辨識速度極快。
3. **API 翻譯 (500ms ~ 1s 以上)**：呼叫 Google Translate 或 DeepL 是一個跨海的 HTTP POST Request，這是最耗時的一段。

**我們的優化策略：**

- **前端放棄顯示 Interim**：為了避免使用者看到一半的話卡在那邊，我們直接決定「整句話說完才顯示」，這犧牲了幾百毫秒的即時性，但換取了 100% 穩定的字幕體驗。
- **Go 的高併發**：Go 的 WebSocket 與 goroutine 確保在等翻譯 API (I/O Block) 時不會阻塞下一個封包的接收，翻譯一旦收到就會光速推給前端。

---

## 💻 前端深度技術題

### Q3. 你在攔截 YouTube 聲音的時候，是用 `getDisplayMedia` 還是什麼方法？為何選這個方法？

**A（回答要點）：**
我是使用 **Web Audio API (`AudioContext`)** 去抓取 DOM 裡面的 `<video>` tag，而不是使用 `getDisplayMedia` (分享螢幕與分頁)。

- `getDisplayMedia` 的致命缺點是它會跳出破壞體驗的系統要求對話框：「請選擇你要分享哪個分頁」。這對一個內建字體插件來說體驗極差。
- 透過 `AudioContext.createMediaElementSource(video)`，我的擴充功能可以直接藉由 DOM 操作「無感」地抽出音訊。
- 但這個方法有另一個門檻：抽出音訊後原本的聲音就不見了。為此我實作了「旁路分流 (Bypass Routing)」並利用 Gain=0 的靜音節點同時維持「取樣」與「正常播放」，確保使用者聽歌看片不受影響。

### Q4. 解釋一下你前端發送音訊的緩衝設計 (Buffer)，為何是每 0.5 秒發一次？

**A（回答要點）：**
Web Audio 提供的 `ScriptProcessorNode` 每次 Buffer Size 預設是 4096 frames。在 16kHz 取樣率下，每 0.25 秒就會觸發一次 `onaudioprocess`。
如果 0.25 秒就發一個 WebSocket packet，網路封包表頭 (TCP/WS Overhead) 的浪費比例會太高；但如果等到 2 秒才發一次，延遲又會太高。
經過測試，累積到 **8000 frames (約 0.5 秒)** 是一次合理的 Chunk 單位。既不會造成伺服器高頻拆包負載，也能維持良好的即時感。
此外，PCM data 原本是 Float32，我們必須在迴圈內手動將其映射為 Int16 (乘以 `32767`) 後再傳送，這也是深思熟慮後搭配 Deepgram `linear16` 格式的決定。

### Q5. 為什麼用 `yt-navigate-finish` 而不是傳統的 `MutationObserver` 處理換頁？

**A（回答要點）：**
YouTube 本質上是一個極度複雜的 SPA (Single Page Application)。點選側邊欄影片時，URL 會改變，整個播放器 DOM 的資料會刷新，但頁面*不會重新讀取 (No page reload)*。
如果使用 `MutationObserver` 監看 `<body>` 變化或者 URL 攔截，往往會被繁雜的廣告、UI loading 過程干擾，導致事件觸發好幾次或根本錯過。
而 `yt-navigate-finish` 是 YouTube 原生派發的 CustomEvent。它精準象徵了「影片與 DOM 切換流程已徹底完成」。監聽這個事件，讓我的 Extension 總能在最精確的時機發動按鈕重構。

---

## ⚙️ 後端 (Go) 深度技術題

### Q6. 為什麼後端選擇 Go 語言？Node.js 或 Python 做不到嗎？

**A（回答要點）：**
Node.js 與 Python 當然做得到，但 Go ใน這裡是最佳選擇。
本專案的後端本質上是高度密集的 **I/O Bound + Streaming (雙向串流橋接)**。

- **低延遲橋接**：Go 的 Goroutine 極其輕量。處理一條前端連線時，我直接 `go readResults()` 就分拆了另一條獨立線程去監聽 Deepgram 回傳結果。這讓音訊轉發與結果接收互不阻塞。
- **記憶體效能**：Go 在處理大量的 Byte Slice (無數的 PCM Binary Packets) 時，GC 的延遲和記憶體佔用遠遠優於 Python，也不會像 Node.js Event Loop 在大量 Binary 處理時偶爾引發微小的阻塞而影響延遲。
- 編譯後的單一執行檔部署非常方便，適合這種輕量級的微服務角色。

### Q7. 如果 Deepgram 持續沒收到聲音主動斷線，你的系統怎麼辦？

**A（回答要點）：**
這是串流 STT 常見的坑（比如影片靜音或暫停）。
我選擇在**前端**解決這件事。在前端的 `AudioStreamer` 中我實作了 **Heartbeat 保活機制**。
如果發現過去 3 秒內音量振幅始終小於 `0.001`，我們就不是等，而是主動建構一個含有 0.1 秒「靜音值 (0)」的 Int16 PCM 封包丟給 WebSocket。這對 Deepgram 來說，這不叫發呆，這叫「正常的無聲對話資料」，就能完美繞過 Timeout 斷線機制，直到影片恢復播放。

### Q8. 請說明你的 Round-Robin 翻譯器設計，它的 Failover 機制怎麼運作？

**A（回答要點）：**
我是實作一個 `RoundRobinTranslator` 介面，底下維護一個 `translators []Translator` 的 Array，裡面包含 Google 和 DeepL 實作。
我使用了 Go 的 `sync/atomic.Uint64` 這個 Lock-free 的計數器去實作無鎖自增：`int(rr.counter.Add(1)-1) % total` 來決定本回合由誰翻譯（做到 Load Balancing）。
如果在 `translator.Translate(text)` 時發生 HTTP 錯誤、Quota 爆掉或回傳錯誤程式碼，我會使用一個 For 迴圈（`for i := 0; i < total; i++`）自動推進至 Array 中的「下一個」翻譯器重試一次。
對最上層調用者來說，只要還有任何一家 API 活著，它就絕對拿得到字幕，這個 Failover 是完全透明且零阻斷的。
