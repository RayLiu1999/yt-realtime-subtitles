/**
 * content.js - YouTube 即時翻譯字幕 Content Script
 *
 * 負責：
 * 1. 在 YouTube 播放器控制列注入啟動/停止按鈕
 * 2. 攔截 <video> 標籤音訊並透過 WebSocket 傳送至後端
 * 3. 接收翻譯結果並渲染懸浮字幕
 * 4. 自動儲存字幕歷史紀錄
 */

(() => {
  "use strict";

  // ========== 常數定義 ==========
  const DEFAULT_SERVER_URL = "ws://localhost:8080/ws";
  const AUDIO_SAMPLE_RATE = 16000;
  const BUFFER_SIZE = 4096;
  const MAX_SUBTITLE_LINES = 1; // 一次只顯示一行，避免字幕堆疊
  const SUBTITLE_DISPLAY_MS = 3000; // 字幕顯示 3 秒

  // 支援的語言清單
  const LANGUAGES = [
    { code: "ja", name: "日本語" },
    { code: "en", name: "English" },
    { code: "ko", name: "한국어" },
    { code: "zh-TW", name: "繁體中文" },
    { code: "zh-CN", name: "简体中文" },
    { code: "es", name: "Español" },
    { code: "fr", name: "Français" },
    { code: "de", name: "Deutsch" },
    { code: "ru", name: "Русский" },
    { code: "pt", name: "Português" },
  ];

  // ========== 狀態管理 ==========
  let isActive = false;
  let websocket = null;
  let audioStreamer = null;
  let subtitleContainer = null;
  let subtitleLines = []; // [已確認翻譯行]
  let subtitleTimers = []; // 對應每行的自動清除計時器
  let currentInterimText = "";
  let historyEntries = [];
  let serverUrl = DEFAULT_SERVER_URL;

  // ========== 控制按鈕注入 ==========

  /**
   * 在 YouTube 播放器控制列注入翻譯字幕按鈕
   */
  function injectControlButton() {
    // 避免重複注入
    if (document.getElementById("yt-subtitle-btn")) return;

    const rightControls = document.querySelector(".ytp-right-controls");
    if (!rightControls) {
      // YouTube 播放器尚未載入，稍後重試
      setTimeout(injectControlButton, 1000);
      return;
    }

    // 建立按鈕容器
    const btnContainer = document.createElement("div");
    btnContainer.id = "yt-subtitle-btn-container";
    btnContainer.className = "yt-subtitle-control";

    // 主按鈕
    const btn = document.createElement("button");
    btn.id = "yt-subtitle-btn";
    btn.className = "ytp-button yt-subtitle-toggle-btn";
    btn.title = "即時翻譯字幕";
    btn.innerHTML = getSvgIcon(false);
    btn.addEventListener("click", toggleSubtitle);

    // 語言選擇面板按鈕
    const settingsBtn = document.createElement("button");
    settingsBtn.id = "yt-subtitle-settings-btn";
    settingsBtn.className = "ytp-button yt-subtitle-settings-btn";
    settingsBtn.title = "字幕設定";
    settingsBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="20" height="20" fill="#ffffff" style="opacity: 0.9;">
        <path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/>
      </svg>
    `;
    settingsBtn.addEventListener("click", toggleSettingsPanel);

    // 設定面板
    const panel = createSettingsPanel();

    btnContainer.appendChild(btn);
    btnContainer.appendChild(settingsBtn);
    btnContainer.appendChild(panel);

    // 插入到控制列的最前面
    rightControls.insertBefore(btnContainer, rightControls.firstChild);
  }

  /**
   * 建立語言設定面板
   */
  function createSettingsPanel() {
    const panel = document.createElement("div");
    panel.id = "yt-subtitle-settings-panel";
    panel.className = "yt-subtitle-settings-panel";
    panel.style.display = "none";

    // 來源語言
    const sourceGroup = document.createElement("div");
    sourceGroup.className = "yt-subtitle-setting-group";
    const sourceLabel = document.createElement("label");
    sourceLabel.textContent = "來源語言";
    sourceLabel.style.marginBottom = "2px";
    sourceLabel.style.padding = "0";
    sourceLabel.style.lineHeight = "1";
    sourceGroup.appendChild(sourceLabel);
    const sourceSelect = document.createElement("select");
    sourceSelect.id = "yt-subtitle-source-lang";
    LANGUAGES.forEach((lang) => {
      const opt = document.createElement("option");
      opt.value = lang.code;
      opt.textContent = lang.name;
      if (lang.code === "ja") opt.selected = true;
      sourceSelect.appendChild(opt);
    });
    sourceGroup.appendChild(sourceSelect);

    // 目標語言
    const targetGroup = document.createElement("div");
    targetGroup.className = "yt-subtitle-setting-group";
    const targetLabel = document.createElement("label");
    targetLabel.textContent = "目標語言";
    targetLabel.style.marginBottom = "2px";
    targetLabel.style.padding = "0";
    targetLabel.style.lineHeight = "1";
    targetGroup.appendChild(targetLabel);
    const targetSelect = document.createElement("select");
    targetSelect.id = "yt-subtitle-target-lang";
    LANGUAGES.forEach((lang) => {
      const opt = document.createElement("option");
      opt.value = lang.code;
      opt.textContent = lang.name;
      if (lang.code === "zh-TW") opt.selected = true;
      targetSelect.appendChild(opt);
    });
    targetGroup.appendChild(targetSelect);

    panel.appendChild(sourceGroup);
    panel.appendChild(targetGroup);

    // 點擊面板外部時關閉
    document.addEventListener("click", (e) => {
      if (
        !panel.contains(e.target) &&
        e.target.id !== "yt-subtitle-settings-btn"
      ) {
        panel.style.display = "none";
      }
    });

    return panel;
  }

  /**
   * 切換設定面板顯示
   */
  function toggleSettingsPanel(e) {
    e.stopPropagation();
    const panel = document.getElementById("yt-subtitle-settings-panel");
    if (panel) {
      panel.style.display = panel.style.display === "none" ? "flex" : "none";
    }
  }

  /**
   * 取得按鈕 SVG 圖標（字幕圖標）
   */
  function getSvgIcon(active) {
    const color = active ? "#ff4444" : "#ffffff";
    // 麥克風圖示，代表即時語音辨識，和旁邊的 Translate 設定按鈕做明顯區隔
    return `
      <svg viewBox="0 0 24 24" width="24" height="24" fill="${color}">
        <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
      </svg>
    `;
  }

  // ========== 字幕核心邏輯 ==========

  /**
   * 切換字幕開啟/關閉
   */
  async function toggleSubtitle() {
    if (isActive) {
      stopSubtitle();
    } else {
      await startSubtitle();
    }
  }

  /**
   * 開始即時字幕翻譯
   */
  async function startSubtitle() {
    const sourceLang =
      document.getElementById("yt-subtitle-source-lang")?.value || "en";
    const targetLang =
      document.getElementById("yt-subtitle-target-lang")?.value || "zh-TW";

    // 從 Popup 儲存取得最新的伺服器位址
    const result = await chrome.storage.local.get(["subtitleSettings"]);
    serverUrl = result.subtitleSettings?.serverUrl || DEFAULT_SERVER_URL;

    try {
      // 1. 初始化 AudioContext 以獲取原生取樣率，避免強制 16kHz 導致藍牙耳機降質
      const tempAudioCtx = new (
        window.AudioContext || window.webkitAudioContext
      )();
      const nativeSampleRate = tempAudioCtx.sampleRate;

      // 2. 初始化字幕顯示區
      createSubtitleOverlay();

      // 3. 連線 WebSocket（帶上取樣率）
      connectWebSocket(sourceLang, targetLang, nativeSampleRate);

      const video = document.querySelector("video");
      if (!video) throw new Error("找不到影片元素");

      if (!audioStreamer) {
        audioStreamer = new AudioStreamer(video, websocket, nativeSampleRate);
      } else {
        audioStreamer.websocket = websocket;
      }
      await audioStreamer.setupAudioCapture();

      isActive = true;
      historyEntries = [];
      updateButtonState(true);

      // 通知 Background 更新狀態
      chrome.runtime.sendMessage({
        action: "updateState",
        active: true,
        sourceLanguage: sourceLang,
        targetLanguage: targetLang,
      });
    } catch (err) {
      console.error("[YT字幕] 啟動失敗:", err);
      stopSubtitle();
      showError("啟動失敗: " + err.message);
    }
  }

  /**
   * 停止字幕翻譯
   */
  function stopSubtitle() {
    isActive = false;

    // 關閉音訊處理
    if (audioStreamer) {
      audioStreamer.stopCapture();
    }

    // 關閉 WebSocket
    if (websocket) {
      websocket.close();
      websocket = null;
    }

    // 儲存歷史紀錄
    saveHistory();

    // 清除字幕顯示
    removeSubtitleOverlay();
    updateButtonState(false);

    // 通知 Background 更新狀態
    chrome.runtime.sendMessage({
      action: "updateState",
      active: false,
    });
  }

  /**
   * 更新按鈕外觀
   */
  function updateButtonState(active) {
    const btn = document.getElementById("yt-subtitle-btn");
    if (btn) {
      btn.innerHTML = getSvgIcon(active);
      btn.classList.toggle("yt-subtitle-active", active);
    }
  }

  // ========== 音訊擷取 (AudioStreamer) ==========

  class AudioStreamer {
    constructor(videoElement, websocket, nativeSampleRate) {
      this.videoElement = videoElement;
      this.websocket = websocket;
      this.isActive = false;

      // Web Audio API 相關節點
      this.audioContext = null;
      this.mediaElementSource = null;
      this.processor = null;
      this.dummyGain = null;

      // 緩衝區設計 (動態適應原生取樣率)
      this.targetSampleRate = nativeSampleRate || AUDIO_SAMPLE_RATE;
      this.bufferSize = Math.round(this.targetSampleRate * 0.5); // 0.5 秒發送一次
      this.audioBuffer = new Int16Array(this.bufferSize);
      this.bufferOffset = 0;

      this.lastAudioTime = Date.now();
      this.heartbeatTimer = null;
    }

    async setupAudioCapture() {
      this.isActive = true;

      // 1. 初始化 AudioContext (不設定 sampleRate，隨 OS 原生設定以避免耳機切換模式)
      if (!this.audioContext) {
        this.audioContext = new (
          window.AudioContext || window.webkitAudioContext
        )();
      }

      if (this.audioContext.state === "suspended") {
        await this.audioContext.resume();
      }

      // 2. 建立媒體源 (防呆機制：確保一個 video 只綁定一次)
      if (!this.mediaElementSource) {
        try {
          this.mediaElementSource = this.audioContext.createMediaElementSource(
            this.videoElement,
          );
          console.log(
            "[YT字幕] createMediaElementSource 成功，音源節點建立完成",
          );
        } catch (e) {
          console.error(
            "[YT字幕] createMediaElementSource 失敗:",
            e.name,
            e.message,
          );
        }
      } else {
        // console.log("[YT字幕] 重復使用現有媒體源節點");
      }

      // 如果先前已經存在節點，為了安全重置連接
      if (this.mediaElementSource) {
        try {
          this.mediaElementSource.disconnect();
        } catch (e) {}
      }
      if (this.processor) {
        try {
          this.processor.disconnect();
        } catch (e) {}
      }
      if (this.dummyGain) {
        try {
          this.dummyGain.disconnect();
        } catch (e) {}
      }

      // 3. 建立音訊處理節點 (BufferSize 4096)
      if (!this.processor) {
        this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
      }

      // 4. 建立靜音節點 (避免回音與爆音的關鍵)
      if (!this.dummyGain) {
        this.dummyGain = this.audioContext.createGain();
        this.dummyGain.gain.value = 0; // 音量設為 0
      }

      // === 音訊路由設計 (Audio Routing) ===
      if (this.mediaElementSource) {
        // A. 將原始聲音傳送到揚聲器 (使用者正常聽影片)
        this.mediaElementSource.connect(this.audioContext.destination);

        // B. 將聲音分流到我們的處理器 (擷取音訊)
        this.mediaElementSource.connect(this.processor);

        // C. 處理器必須連接到 destination 才會運作，但為了不發出聲音，中間過濾一層靜音節點
        this.processor.connect(this.dummyGain);
        this.dummyGain.connect(this.audioContext.destination);
        // console.log(`[YT字幕] 音訊路由連接完成...`);
      } else {
        console.error("[YT字幕] 媒體源節點為 null！音訊路由建立失敗");
      }

      // === 音訊處理邏輯 ===
      let _processCallCount = 0;
      let _sentPacketCount = 0;
      this.processor.onaudioprocess = (event) => {
        _processCallCount++;

        // 前 5 次就輸出狀態，方便確認 each frame 是否正常觸發
        if (_processCallCount <= 5) {
          const wsState = this.websocket?.readyState ?? "null";
          const stateMap = {
            0: "CONNECTING",
            1: "OPEN",
            2: "CLOSING",
            3: "CLOSED",
          };
          console.log(
            `[YT字幕] onaudioprocess #${_processCallCount}, isActive=${this.isActive}, WS=${stateMap[wsState] ?? wsState}`,
          );
        }

        if (
          !this.isActive ||
          !this.websocket ||
          this.websocket.readyState !== WebSocket.OPEN
        ) {
          return;
        }

        const inputData = event.inputBuffer.getChannelData(0);
        let hasAudio = false;

        // 遍歷當下這批 Float32 音訊資料
        for (let i = 0; i < inputData.length; i++) {
          // 檢查是否有聲音 (振幅 > 0.001)
          if (Math.abs(inputData[i]) > 0.001) {
            hasAudio = true;
          }

          // Float32 轉 Int16
          const sample = Math.max(-1, Math.min(1, inputData[i]));
          this.audioBuffer[this.bufferOffset] = Math.floor(sample * 32767);
          this.bufferOffset++;

          // 當緩衝區滿了 (0.5秒)，就送出並重置指標
          if (this.bufferOffset >= this.bufferSize) {
            // 必須複製一份再送出，避免底層覆寫問題
            const chunkToSend = new Int16Array(this.audioBuffer);
            this.websocket.send(chunkToSend.buffer);
            _sentPacketCount++;
            if (_sentPacketCount <= 3 || _sentPacketCount % 100 === 0) {
              // console.log(`[YT字幕] 已傳送音訊封包 #${_sentPacketCount}`);
            }

            this.bufferOffset = 0; // 重置指標
          }
        }

        if (hasAudio) {
          this.lastAudioTime = Date.now();
        }
      };

      // 5. 啟動靜音心跳機制 (防斷線)
      this.startHeartbeat();

      console.log("[YT字幕] 音訊捕獲設置完成，準備傳送串流至後端");
    }

    startHeartbeat() {
      this.stopHeartbeat(); // 確保不重複啟動
      this.heartbeatTimer = setInterval(() => {
        if (!this.isActive) return;

        const now = Date.now();
        // 如果 2 秒內沒有音訊，送出一小段靜音 (0.1秒)
        if (now - this.lastAudioTime > 2000) {
          const silenceChunk = new Int16Array(this.targetSampleRate * 0.1); // 全為 0 的陣列
          if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            this.websocket.send(silenceChunk.buffer);
          }
          this.lastAudioTime = now;
        }
      }, 1000);
    }

    stopCapture() {
      this.isActive = false;
      this.stopHeartbeat();

      // 安全地斷開連接，避免資源洩漏
      if (this.processor) {
        this.processor.onaudioprocess = null;
      }

      this.bufferOffset = 0;
      console.log("[YT字幕] 音訊捕獲已暫停");
    }

    stopHeartbeat() {
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
    }
  }

  // ========== WebSocket 通訊 ==========

  /**
   * 建立 WebSocket 連線至後端
   */
  function connectWebSocket(sourceLang, targetLang, sampleRate) {
    websocket = new WebSocket(serverUrl);

    websocket.onopen = () => {
      console.log("[YT字幕] WebSocket 已連線");

      // 傳送設定訊息
      websocket.send(
        JSON.stringify({
          type: "config",
          sourceLanguage: sourceLang,
          targetLanguage: targetLang,
          sampleRate: Math.round(sampleRate),
        }),
      );
    };

    websocket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleServerMessage(data);
      } catch (err) {
        console.error("[YT字幕] 解析訊息失敗:", err);
      }
    };

    websocket.onerror = (err) => {
      console.error("[YT字幕] WebSocket 錯誤:", err);
      showError("連線錯誤，請確認後端伺服器是否已啟動");
    };

    websocket.onclose = () => {
      console.log("[YT字幕] WebSocket 已關閉");
      if (isActive) {
        // 非預期斷線，嘗試重連
        showError("連線中斷，3 秒後重試...");
        setTimeout(() => {
          if (isActive) {
            connectWebSocket(sourceLang, targetLang);
          }
        }, 3000);
      }
    };
  }

  /**
   * 處理後端回傳的訊息
   */
  function handleServerMessage(data) {
    switch (data.type) {
      case "transcript":
        // 只更新內部暫存，不觸發畫面更新（避免 interim 頻繁閃爍）
        currentInterimText = data.text;
        break;

      case "translation":
        // 最終翻譯結果
        // console.log(`[YT字幕] 翻譯: "${data.original}" → "${data.text}"`);
        addSubtitleLine({
          original: data.original || "",
          translated: data.text,
        });
        currentInterimText = "";

        // 加入歷史紀錄
        historyEntries.push({
          original: data.original || "",
          translated: data.text,
          time: new Date().toISOString(),
        });
        // console.log(
        //   `[YT字幕] 歷史紀錄新增，目前共 ${historyEntries.length} 筆`,
        // );
        break;

      case "error":
        console.error("[YT字幕] 伺服器錯誤:", data.message);
        showError(data.message);
        break;
    }
  }

  // ========== 字幕渲染 ==========

  /**
   * 建立懸浮字幕覆蓋層
   */
  function createSubtitleOverlay() {
    removeSubtitleOverlay();

    const player = document.getElementById("movie_player");
    if (!player) return;

    subtitleContainer = document.createElement("div");
    subtitleContainer.id = "yt-subtitle-overlay";
    subtitleContainer.className = "yt-subtitle-overlay";

    // 字幕寬度跟隨播放器（取 80% 但限制最寬 900px）
    const playerWidth = player.clientWidth;
    subtitleContainer.style.maxWidth = Math.min(playerWidth * 0.8, 900) + "px";

    // 使字幕可拖曳
    makeDraggable(subtitleContainer);

    player.appendChild(subtitleContainer);
    subtitleLines = [];
    subtitleTimers = [];
  }

  /**
   * 移除字幕覆蓋層
   */
  function removeSubtitleOverlay() {
    // 清除所有字幕計時器
    subtitleTimers.forEach((t) => clearTimeout(t));
    subtitleTimers = [];

    const existing = document.getElementById("yt-subtitle-overlay");
    if (existing) {
      existing.remove();
    }
    subtitleContainer = null;
    subtitleLines = [];
  }

  /**
   * 新增一行字幕（接受 { original, translated } 物件），并設定自動清除計時器
   */
  function addSubtitleLine(entry) {
    subtitleLines.push(entry);
    subtitleTimers.push(null);

    const index = subtitleLines.length - 1;
    const timer = setTimeout(() => {
      const pos = subtitleLines.indexOf(entry);
      if (pos !== -1) {
        subtitleLines.splice(pos, 1);
        subtitleTimers.splice(pos, 1);
        updateSubtitleDisplay();
      }
    }, SUBTITLE_DISPLAY_MS);

    subtitleTimers[index] = timer;

    // 防守上限
    if (subtitleLines.length > MAX_SUBTITLE_LINES) {
      clearTimeout(subtitleTimers[0]);
      subtitleLines.shift();
      subtitleTimers.shift();
    }

    updateSubtitleDisplay();
  }

  /**
   * 更新字幕顯示內容
   */
  function updateSubtitleDisplay() {
    if (!subtitleContainer) return;

    let html = "";

    // 只顯示已確認的翻譯行（不顯示 interim）
    subtitleLines.forEach((entry) => {
      html += `
        <div class="yt-subtitle-entry">
          ${entry.original ? `<div class="yt-subtitle-original">${escapeHtml(entry.original)}</div>` : ""}
          <div class="yt-subtitle-line yt-subtitle-final">${escapeHtml(entry.translated)}</div>
        </div>
      `;
    });

    subtitleContainer.innerHTML = html;
  }

  /**
   * 顯示錯誤提示
   */
  function showError(message) {
    if (!subtitleContainer) {
      createSubtitleOverlay();
    }
    if (subtitleContainer) {
      const errorDiv = document.createElement("div");
      errorDiv.className = "yt-subtitle-line yt-subtitle-error";
      errorDiv.textContent = message;
      subtitleContainer.appendChild(errorDiv);

      // 3 秒後自動移除
      setTimeout(() => errorDiv.remove(), 3000);
    }
  }

  /**
   * 使元素可拖曳
   */
  function makeDraggable(element) {
    let isDragging = false;
    let offsetX, offsetY;

    element.addEventListener("mousedown", (e) => {
      isDragging = true;
      offsetX = e.clientX - element.getBoundingClientRect().left;
      offsetY = e.clientY - element.getBoundingClientRect().top;
      element.style.cursor = "grabbing";
    });

    document.addEventListener("mousemove", (e) => {
      if (!isDragging) return;

      const player = document.getElementById("movie_player");
      if (!player) return;

      const playerRect = player.getBoundingClientRect();
      let newX = e.clientX - playerRect.left - offsetX;
      let newY = e.clientY - playerRect.top - offsetY;

      // 限制在播放器範圍內
      newX = Math.max(
        0,
        Math.min(newX, playerRect.width - element.offsetWidth),
      );
      newY = Math.max(
        0,
        Math.min(newY, playerRect.height - element.offsetHeight),
      );

      element.style.left = newX + "px";
      element.style.top = newY + "px";
      element.style.bottom = "auto";
    });

    document.addEventListener("mouseup", () => {
      isDragging = false;
      element.style.cursor = "grab";
    });
  }

  /**
   * HTML 跳脫處理，防止 XSS
   */
  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  // ========== 歷史紀錄 ==========

  /**
   * 儲存字幕歷史紀錄至 chrome.storage.local
   */
  function saveHistory() {
    if (historyEntries.length === 0) {
      console.log("[YT字幕] 无字幕內容可儲存");
      return;
    }

    const videoId =
      new URLSearchParams(window.location.search).get("v") || "unknown";
    const videoTitle = document.title.replace(" - YouTube", "").trim();

    const record = {
      videoId,
      videoTitle,
      timestamp: new Date().toISOString(),
      sourceLanguage:
        document.getElementById("yt-subtitle-source-lang")?.value || "en",
      targetLanguage:
        document.getElementById("yt-subtitle-target-lang")?.value || "zh-TW",
      entries: historyEntries,
    };

    // console.log(`[YT字幕] 儲存歷史紀錄： ${videoTitle}`, record);

    chrome.storage.local.get(["subtitleHistory"], (result) => {
      const history = result.subtitleHistory || [];
      history.unshift(record);

      // 最多保留 100 筆紀錄
      if (history.length > 100) {
        history.length = 100;
      }

      chrome.storage.local.set({ subtitleHistory: history }, () => {
        console.log(`[YT字幕] 歷史儲存完成，目前共 ${history.length} 筆`);
      });
    });
  }

  // ========== 監聽 Background 訊息 ==========

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
      case "startSubtitle":
        // 從 Popup 觸發的啟動
        if (!isActive) {
          const sourceSelect = document.getElementById(
            "yt-subtitle-source-lang",
          );
          const targetSelect = document.getElementById(
            "yt-subtitle-target-lang",
          );
          const serverInput = document.getElementById("yt-subtitle-server-url");

          if (sourceSelect) sourceSelect.value = message.sourceLanguage || "en";
          if (targetSelect)
            targetSelect.value = message.targetLanguage || "zh-TW";
          if (serverInput && message.serverUrl)
            serverInput.value = message.serverUrl;

          startSubtitle();
        }
        sendResponse({ success: true });
        break;

      case "stopSubtitle":
        if (isActive) {
          stopSubtitle();
        }
        sendResponse({ success: true });
        break;

      case "getStatus":
        sendResponse({ active: isActive });
        break;
    }
    return true;
  });

  // ========== 初始化 ==========

  /**
   * 等待 YouTube 播放器載入後注入按鈕
   */
  function init() {
    // 方法 1：監聽 YouTube 的 yt-navigate-finish 事件（SPA 導航最對的方式）
    document.addEventListener("yt-navigate-finish", () => {
      console.log("[YT字幕] yt-navigate-finish 事件觸發，重新注入按鈕");
      if (isActive) {
        stopSubtitle();
      }
      // 等待播放器 DOM 渲染
      setTimeout(() => injectControlButton(), 800);
    });

    // 方法 2： MutationObserver 作為備援（首次載入 / 事件未觸發時）
    const initialObserver = new MutationObserver(() => {
      if (document.querySelector(".ytp-right-controls")) {
        injectControlButton();
        initialObserver.disconnect();
      }
    });
    initialObserver.observe(document.body, { childList: true, subtree: true });

    // 立即嘗試一次（如果播放器已載入）
    injectControlButton();
  }

  init();
})();
