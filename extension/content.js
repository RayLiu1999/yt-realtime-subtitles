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
  const MAX_SUBTITLE_LINES = 3;
  const SUBTITLE_FADE_DURATION = 500; // 毫秒

  // 支援的語言清單
  const LANGUAGES = [
    { code: "en", name: "English" },
    { code: "ja", name: "日本語" },
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
  let audioContext = null;
  let mediaSource = null;
  let scriptProcessor = null;
  let subtitleContainer = null;
  let subtitleLines = [];
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
    sourceGroup.innerHTML = "<label>來源語言</label>";
    const sourceSelect = document.createElement("select");
    sourceSelect.id = "yt-subtitle-source-lang";
    LANGUAGES.forEach((lang) => {
      const opt = document.createElement("option");
      opt.value = lang.code;
      opt.textContent = lang.name;
      if (lang.code === "en") opt.selected = true;
      sourceSelect.appendChild(opt);
    });
    sourceGroup.appendChild(sourceSelect);

    // 目標語言
    const targetGroup = document.createElement("div");
    targetGroup.className = "yt-subtitle-setting-group";
    targetGroup.innerHTML = "<label>目標語言</label>";
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

    // 伺服器位址
    const serverGroup = document.createElement("div");
    serverGroup.className = "yt-subtitle-setting-group";
    serverGroup.innerHTML = "<label>伺服器</label>";
    const serverInput = document.createElement("input");
    serverInput.id = "yt-subtitle-server-url";
    serverInput.type = "text";
    serverInput.value = DEFAULT_SERVER_URL;
    serverInput.placeholder = "ws://localhost:8080/ws";
    serverGroup.appendChild(serverInput);

    panel.appendChild(sourceGroup);
    panel.appendChild(targetGroup);
    panel.appendChild(serverGroup);

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
    return `
      <svg viewBox="0 0 24 24" width="24" height="24" fill="${color}">
        <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V6h16v12z"/>
        <path d="M6 10h2v2H6zm0 4h8v2H6zm10-4h2v2h-2zm-6 0h4v2h-4zm6 4h2v2h-2z"/>
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
    serverUrl =
      document.getElementById("yt-subtitle-server-url")?.value ||
      DEFAULT_SERVER_URL;

    try {
      // 初始化字幕顯示區
      createSubtitleOverlay();

      // 連線 WebSocket
      connectWebSocket(sourceLang, targetLang);

      // 擷取音訊
      await captureAudio();

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

    // 關閉 WebSocket
    if (websocket) {
      websocket.close();
      websocket = null;
    }

    // 關閉音訊處理
    if (scriptProcessor) {
      scriptProcessor.disconnect();
      scriptProcessor = null;
    }
    if (mediaSource) {
      mediaSource.disconnect();
      mediaSource = null;
    }
    if (audioContext) {
      audioContext.close();
      audioContext = null;
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

  // ========== 音訊擷取 ==========

  /**
   * 擷取 YouTube <video> 標籤的音訊
   * 使用 AudioContext.createMediaElementSource 取得音訊串流
   */
  async function captureAudio() {
    const video = document.querySelector("video");
    if (!video) {
      throw new Error("找不到影片元素");
    }

    audioContext = new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE });

    // 從 video 元素建立音源節點
    mediaSource = audioContext.createMediaElementSource(video);

    // 建立 ScriptProcessor 節點用於取得 PCM 音訊資料
    scriptProcessor = audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);

    scriptProcessor.onaudioprocess = (event) => {
      if (!isActive || !websocket || websocket.readyState !== WebSocket.OPEN)
        return;

      // 取得單聲道 PCM 資料（Float32Array）
      const inputData = event.inputBuffer.getChannelData(0);

      // 轉換為 16-bit Linear PCM（Deepgram 要求的格式）
      const pcm16 = float32ToInt16(inputData);

      // 傳送至後端
      websocket.send(pcm16.buffer);
    };

    // 連接音訊處理鏈：video → scriptProcessor → destination
    // 必須連接到 destination 才能讓使用者聽到聲音
    mediaSource.connect(scriptProcessor);
    scriptProcessor.connect(audioContext.destination);
  }

  /**
   * 將 Float32 PCM 轉換為 Int16 PCM
   */
  function float32ToInt16(float32Array) {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return int16Array;
  }

  // ========== WebSocket 通訊 ==========

  /**
   * 建立 WebSocket 連線至後端
   */
  function connectWebSocket(sourceLang, targetLang) {
    websocket = new WebSocket(serverUrl);

    websocket.onopen = () => {
      console.log("[YT字幕] WebSocket 已連線");

      // 傳送設定訊息
      websocket.send(
        JSON.stringify({
          type: "config",
          sourceLanguage: sourceLang,
          targetLanguage: targetLang,
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
        // 即時辨識結果（中間結果）
        currentInterimText = data.text;
        updateSubtitleDisplay();
        break;

      case "translation":
        // 最終翻譯結果
        addSubtitleLine(data.text);
        currentInterimText = "";

        // 加入歷史紀錄
        historyEntries.push({
          original: data.original || "",
          translated: data.text,
          time: new Date().toISOString(),
        });
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

    // 使字幕可拖曳
    makeDraggable(subtitleContainer);

    player.appendChild(subtitleContainer);
    subtitleLines = [];
  }

  /**
   * 移除字幕覆蓋層
   */
  function removeSubtitleOverlay() {
    const existing = document.getElementById("yt-subtitle-overlay");
    if (existing) {
      existing.remove();
    }
    subtitleContainer = null;
    subtitleLines = [];
  }

  /**
   * 新增一行字幕
   */
  function addSubtitleLine(text) {
    subtitleLines.push(text);

    // 保留最新的 N 行
    if (subtitleLines.length > MAX_SUBTITLE_LINES) {
      subtitleLines.shift();
    }

    updateSubtitleDisplay();
  }

  /**
   * 更新字幕顯示內容
   */
  function updateSubtitleDisplay() {
    if (!subtitleContainer) return;

    let html = "";

    // 已確認的翻譯行
    subtitleLines.forEach((line) => {
      html += `<div class="yt-subtitle-line yt-subtitle-final">${escapeHtml(line)}</div>`;
    });

    // 中間辨識結果（半透明顯示）
    if (currentInterimText) {
      html += `<div class="yt-subtitle-line yt-subtitle-interim">${escapeHtml(currentInterimText)}</div>`;
    }

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
    if (historyEntries.length === 0) return;

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

    chrome.storage.local.get(["subtitleHistory"], (result) => {
      const history = result.subtitleHistory || [];
      history.unshift(record);

      // 最多保留 100 筆紀錄
      if (history.length > 100) {
        history.length = 100;
      }

      chrome.storage.local.set({ subtitleHistory: history });
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
    // 使用 MutationObserver 偵測播放器載入
    const observer = new MutationObserver(() => {
      if (document.querySelector(".ytp-right-controls")) {
        injectControlButton();
        observer.disconnect();
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // 以防已經載入，立即嘗試一次
    injectControlButton();

    // YouTube 使用 SPA 導航，監聽網址變更
    let lastUrl = location.href;
    const urlObserver = new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        // 頁面切換時停止字幕並重新注入按鈕
        if (isActive) {
          stopSubtitle();
        }
        setTimeout(injectControlButton, 1500);
      }
    });

    urlObserver.observe(document.body, { childList: true, subtree: true });
  }

  init();
})();
