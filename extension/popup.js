/**
 * popup.js - Popup 介面邏輯
 *
 * 功能：
 * 1. 歷史紀錄瀏覽（搜尋、詳情、匯出 JSON、清除）
 * 2. 語言與伺服器設定
 */

(() => {
  "use strict";

  // 支援的語言清單（與 content.js 保持一致）
  const LANGUAGES = [
    { code: "ja", name: "日本語" },
    { code: "en", name: "English" },
    { code: "ko", name: "한국어" },
    { code: "zh-TW", name: "繁體中文" },
    { code: "id", name: "Indonesian" },
    { code: "es", name: "Español" },
    { code: "fr", name: "Français" },
    { code: "de", name: "Deutsch" },
    { code: "ru", name: "Русский" },
    { code: "pt", name: "Português" },
  ];

  const DEFAULT_SERVER_URL = "ws://localhost:8080/ws";
  const WS_TOKEN =
    "JtfEDXi8ZAD3UYxuSXJgdkOq6u0Yhh6Z5IUVm6ZTWU9qvK8kZ3BDtoUTqP9pamOQeJEDzGUDvbjzu6RrmgRWGqsZGGvSSdRXfhgPfPHgEoxm4ThUru895c1f0oVZR7evU5qP";

  // ========== 初始化 ==========

  document.addEventListener("DOMContentLoaded", () => {
    initTabs();
    initLanguageSelects();
    loadSettings();
    loadHistory();
    bindEvents();
  });

  // ========== 分頁切換 ==========

  function initTabs() {
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        // 切換 active 狀態
        document
          .querySelectorAll(".tab-btn")
          .forEach((b) => b.classList.remove("active"));
        document
          .querySelectorAll(".tab-content")
          .forEach((c) => c.classList.remove("active"));

        btn.classList.add("active");
        const tabId = `tab-${btn.dataset.tab}`;
        document.getElementById(tabId).classList.add("active");
      });
    });
  }

  // ========== 語言選單初始化 ==========

  function initLanguageSelects() {
    const sourceSelect = document.getElementById("setting-source-lang");
    const targetSelect = document.getElementById("setting-target-lang");

    LANGUAGES.forEach((lang) => {
      const sourceOpt = document.createElement("option");
      sourceOpt.value = lang.code;
      sourceOpt.textContent = lang.name;
      sourceSelect.appendChild(sourceOpt);

      const targetOpt = document.createElement("option");
      targetOpt.value = lang.code;
      targetOpt.textContent = lang.name;
      targetSelect.appendChild(targetOpt);
    });
  }

  // ========== 設定管理 ==========

  function loadSettings() {
    chrome.storage.local.get(["subtitleSettings"], (result) => {
      const settings = result.subtitleSettings || {
        sourceLanguage: "ja",
        targetLanguage: "zh-TW",
        serverUrl: DEFAULT_SERVER_URL,
        authToken: WS_TOKEN,
        historyEnabled: true, // 預設啟用歷史紀錄
      };

      document.getElementById("setting-source-lang").value =
        settings.sourceLanguage;
      document.getElementById("setting-target-lang").value =
        settings.targetLanguage;
      document.getElementById("setting-server-url").value = settings.serverUrl;
      // document.getElementById("setting-auth-token").value =
      //   settings.authToken || "";
      document.getElementById("yt-subtitle-history-enabled").checked =
        settings.historyEnabled;
    });
  }

  function saveSettings() {
    const settings = {
      sourceLanguage: document.getElementById("setting-source-lang").value,
      targetLanguage: document.getElementById("setting-target-lang").value,
      serverUrl:
        document.getElementById("setting-server-url").value ||
        DEFAULT_SERVER_URL,
      // authToken: document.getElementById("setting-auth-token").value,
      historyEnabled: document.getElementById("yt-subtitle-history-enabled")
        .checked,
    };

    chrome.storage.local.set({ subtitleSettings: settings }, () => {
      const status = document.getElementById("settings-status");
      status.textContent = "✓ 設定已儲存";
      setTimeout(() => {
        status.textContent = "";
      }, 2000);

      // 通知 content 腳本更新設定 (同步套用最新的 URL 與語言設定)
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0] && tabs[0].url.includes("youtube.com")) {
          chrome.tabs
            .sendMessage(tabs[0].id, {
              action: "settingsUpdated",
              settings: settings,
            })
            .catch(() => {}); // 忽略錯誤（如果目前頁面尚無 content script）
        }
      });
    });
  }

  // ========== 歷史紀錄 ==========

  function loadHistory(searchQuery = "") {
    chrome.storage.local.get(["subtitleHistory"], (result) => {
      const history = result.subtitleHistory || [];
      renderHistoryList(history, searchQuery);
    });
  }

  function renderHistoryList(history, searchQuery = "") {
    const listEl = document.getElementById("history-list");

    // 過濾搜尋
    let filtered = history;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = history.filter(
        (item) =>
          item.videoTitle.toLowerCase().includes(query) ||
          item.videoId.toLowerCase().includes(query),
      );
    }

    if (filtered.length === 0) {
      listEl.innerHTML = `<div class="empty-state">${searchQuery ? "找不到符合的紀錄" : "尚無字幕紀錄"}</div>`;
      return;
    }

    listEl.innerHTML = filtered
      .map((item, index) => {
        const updateDate = new Date(item.lastUpdate || item.timestamp);
        const dateStr = `${updateDate.getMonth() + 1}/${updateDate.getDate()} ${updateDate.getHours()}:${String(updateDate.getMinutes()).padStart(2, "0")}`;
        const entryCount = item.entries?.length || 0;

        return `
        <div class="history-item" data-index="${index}">
          <div class="history-item-title">${escapeHtml(item.videoTitle)}</div>
          <div class="history-item-meta">
            <span>最後更新: ${dateStr}</span>
            <span>${entryCount} 條字幕</span>
            <span class="history-item-badge">${item.sourceLanguage} → ${item.targetLanguage}</span>
          </div>
          <div class="history-item-delete" data-index="${index}" title="刪除此紀錄">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6"/></svg>
          </div>
        </div>
      `;
      })
      .join("");

    // 點擊歷史項目詳情或刪除
    listEl.addEventListener("click", (e) => {
      const deleteBtn = e.target.closest(".history-item-delete");
      if (deleteBtn) {
        e.stopPropagation();
        const index = parseInt(deleteBtn.getAttribute("data-index"));
        deleteHistoryItem(index);
        return;
      }

      const item = e.target.closest(".history-item");
      if (item) {
        const index = parseInt(item.getAttribute("data-index"));
        showHistoryDetail(filtered[index]);
      }
    });
  }

  /**
   * 刪除單個歷史紀錄
   */
  function deleteHistoryItem(index) {
    chrome.storage.local.get(["subtitleHistory"], (result) => {
      const history = result.subtitleHistory || [];
      if (index >= 0 && index < history.length) {
        if (confirm(`確定要刪除「${history[index].videoTitle}」的紀錄嗎？`)) {
          history.splice(index, 1);
          chrome.storage.local.set({ subtitleHistory: history }, () => {
            loadHistory();
          });
        }
      }
    });
  }

  function showHistoryDetail(record) {
    const listEl = document.getElementById("history-list");

    let html = `
      <div class="history-detail">
        <div class="history-detail-header">
          <button class="back-btn" id="history-back-btn">← 返回</button>
          <span style="font-size: 12px; color: rgba(255,255,255,0.5);">${escapeHtml(record.videoTitle)}</span>
        </div>
    `;

    if (record.entries && record.entries.length > 0) {
      // 顯示最新的在上面
      const sortedEntries = [...record.entries].reverse();
      sortedEntries.forEach((entry) => {
        html += `
          <div class="history-entry">
            <div class="history-entry-meta">
              <span class="history-entry-time">${entry.time || ""}</span>
            </div>
            <div class="history-entry-original">${escapeHtml(entry.original || "")}</div>
            <div class="history-entry-translated">${escapeHtml(entry.translated)}</div>
          </div>
        `;
      });
    } else {
      html += '<div class="empty-state">此紀錄沒有字幕內容</div>';
    }

    html += "</div>";
    listEl.innerHTML = html;

    document
      .getElementById("history-back-btn")
      .addEventListener("click", () => {
        loadHistory(document.getElementById("history-search").value);
      });
  }

  // ========== 匯出與清除 ==========

  function exportHistory() {
    chrome.storage.local.get(["subtitleHistory"], (result) => {
      const history = result.subtitleHistory || [];
      if (history.length === 0) {
        return;
      }

      const blob = new Blob([JSON.stringify(history, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `yt-subtitles-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  function clearHistory() {
    if (!confirm("確定要清除所有歷史紀錄嗎？此操作無法復原。")) return;

    chrome.storage.local.set({ subtitleHistory: [] }, () => {
      loadHistory();
    });
  }

  // ========== 事件綁定 ==========

  function bindEvents() {
    // 搜尋
    document.getElementById("history-search").addEventListener("input", (e) => {
      loadHistory(e.target.value);
    });

    // 匯出
    document
      .getElementById("export-btn")
      .addEventListener("click", exportHistory);

    // 清除
    document
      .getElementById("clear-btn")
      .addEventListener("click", clearHistory);

    // 儲存設定
    document
      .getElementById("save-settings-btn")
      .addEventListener("click", saveSettings);
  }

  // ========== 工具函式 ==========

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }
})();
