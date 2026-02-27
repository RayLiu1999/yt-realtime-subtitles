# 04 · 前端架構詳解 (Frontend Guide)

本專案的前端是一個 Manifest V3 規格的 Chrome Extension，包含 `content.js`（直接在 YouTube 網頁環境內執行）以及 `popup`（右上角歷史紀錄介面）。

核心難點在於：**如何在不分享螢幕分頁 (No getDisplayMedia)、不改動 YouTube 原生播放邏輯的前提下，攔截其音訊封包？**

## Web Audio API 攔截原理 (Audio Routing)

在 `content.js` 中有著精心設計的 `AudioStreamer` 類別，它利用瀏覽器的 Web Audio API 建立了一套「旁路分流 (Bypass Routing)」系統：

1. **尋找原生元件**：定位 YouTube 的 `<video>` 標籤元件。
2. **建立媒體來源 (Source)**：
   `audioContext.createMediaElementSource(videoElement)` 將原生影像的聲音「拔離」預設喇叭。
3. **設計分流網路 (Audio Graph)**：
   - 路線 A (正常播放)：`Source -> Destination`。確保看片的人依舊聽得到聲音。
   - 路線 B (取樣攔截)：`Source -> ScriptProcessorNode -> DummyGain (靜音) -> Destination`

### 為何需要 Dummy Gain？

`ScriptProcessorNode` (或 AudioWorklet) 必須連向 `Destination` (終點) 才會被底層引擎觸發取樣。如果我們只擷取卻不連向終點，處理器就罷工了。但是如果直接連向終點，使用者的喇叭就會播「兩次」同樣的聲音（產生強烈回音 / 爆音）。
所以，我們在中途插入一個音量被設為 `0` 的 `GainNode`。這樣既滿足了連結，又不會發聲。

### PCM 資料轉型

Deepgram API 需要 `linear16`。但瀏覽器的 AudioBuffer 都是 `Float32Array`（範圍 -1.0 到 1.0）。
在 `onaudioprocess` 事件中，我們將 Float32 手動乘上 32767，打包進自訂的 `Int16Array` Buffer 中。累積 0.5 秒就傳到 WebSocket 一次。

## 無縫 UI 整合

我們希望 Extension 看起來像是 YouTube 內建的功能，因此需要在動態的 YouTube DOM 中尋找下錨點。

1. **注入錨點**：擴充功能偵測右下角的 `.ytp-right-controls`，創建按鈕與設定選單注入其中。
2. **SPA 問題與 yt-navigate-finish**：
   YouTube 是個 Single-Page Application。點擊推薦影片不會重新整理，所以 `content.js` 的 `onload` 事件不會再次觸發，原本注入的按鈕會消失。
   我們藉由監聽 YouTube 自訂拋出的 **`yt-navigate-finish`** 事件，能在每次換頁的瞬間，可靠地清理舊資源並重新注入 UI。

## 字幕渲染與穩定機制

傳統的文字替換會導致畫面閃爍（Flickering）。我們進行了以下優化：

- **雙語分離與 DOM 隔離**：使用 Flex 佈局。上方的小字 `yt-subtitle-original` 與下方的 `yt-subtitle-final` 分離。
- **防止跳動**：後端回傳 Interim 資料被遮蔽。只有從後端收到 Final 結果的 JSON 時，才插入新字幕，徹底杜絕單句閃爍。
- **自動清理 (Auto-clear)**：每產生一行字幕，都會並發推入一個獨立的 `setTimeout(..., 3000)`。不管講者是否沉默，字幕行在保留 3 秒後一定會被切掉，讓畫面常保乾淨。
