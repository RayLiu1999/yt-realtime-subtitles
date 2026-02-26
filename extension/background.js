/**
 * background.js - Service Worker
 * 負責 Content Script 與 Popup 之間的訊息中繼
 */

// 儲存各分頁的連線狀態
const tabStates = {};

// 監聽來自 Content Script 或 Popup 的訊息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id || message.tabId;

  switch (message.action) {
    case "getState":
      // Popup 查詢當前分頁的字幕狀態
      sendResponse(tabStates[tabId] || { active: false });
      break;

    case "updateState":
      // Content Script 回報狀態變更
      tabStates[tabId] = {
        active: message.active,
        sourceLanguage: message.sourceLanguage,
        targetLanguage: message.targetLanguage,
      };
      sendResponse({ success: true });
      break;

    case "startSubtitle":
      // Popup 通知 Content Script 開始字幕
      chrome.tabs.sendMessage(tabId, {
        action: "startSubtitle",
        sourceLanguage: message.sourceLanguage,
        targetLanguage: message.targetLanguage,
        serverUrl: message.serverUrl,
      });
      sendResponse({ success: true });
      break;

    case "stopSubtitle":
      // Popup 通知 Content Script 停止字幕
      chrome.tabs.sendMessage(tabId, { action: "stopSubtitle" });
      sendResponse({ success: true });
      break;

    default:
      sendResponse({ error: "未知的動作" });
  }

  return true; // 非同步回應
});

// 分頁關閉時清理狀態
chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabStates[tabId];
});
